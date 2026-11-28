const wallet = require("../utils/wallet");
const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Service = require("../models/Service");
const Server = require("../models/Server");
const Order = require("../models/Order");
const Transaction = require("../models/Transaction");
const Country = require("../models/Country");
const providerApi = require("../utils/providerApi");
const { calculateUserPrice, parseDiscounts } = require("../utils/pricing");
const { nanoid } = require("nanoid");
const { withTransaction } = require("../utils/db");
const { notifyAdminChange } = require("../utils/adminRealtime");
const { recordOrderSms } = require("../utils/orderSms");
const { emitToUser } = require("../utils/realtimeEmitter");
const { rebuyCancelledOrder, cancelCompletedOrderForRebuy } = require("../utils/rebuy");

// Both allocation actions use the same legacy SMS API success response.
function numberResponse(order) {
  return `ACCESS_NUMBER:${order.external_order_id || order.order_id}:${String(order.phone).replace(/\D/g, "")}`;
}

async function findUserOrdersByIds(userId, ids) {
  const requestedIds = [...new Set(ids.map(id => String(id).trim()).filter(Boolean))];
  if (!requestedIds.length) return new Map();
  const orders = await Order.find({
    user_id: String(userId),
    $or: [{ order_id: { $in: requestedIds } }, { external_order_id: { $in: requestedIds } }],
  }).sort({ createdAt: -1, _id: -1 });
  const result = new Map();
  for (const id of requestedIds) {
    const matching = orders.filter(order => order.order_id === id || order.external_order_id === id);
    result.set(id, matching.find(order => order.order_id === id) ||
      matching.find(order => order.external_order_id === id && order.status === "active") ||
      matching.find(order => order.external_order_id === id) || null);
  }
  return result;
}

async function findUserOrder(userId, id) {
  return (await findUserOrdersByIds(userId, [id])).get(String(id).trim()) || null;
}

router.all("/", async (req, res) => {
  try {
    const query = req.method === "POST" ? req.body : req.query;
    if (!query || typeof query !== "object" || Array.isArray(query)) return res.send("BAD_REQUEST");
    const { action } = query;
    const api_key = query.api_key || query.apikey;

    if (typeof api_key !== "string" || !api_key.trim()) return res.send("BAD_KEY");
    if (typeof action !== "string") return res.send("BAD_ACTION");
    if (query.id !== undefined && (typeof query.id !== "string" || !query.id.trim())) return res.send("BAD_REQUEST");

    const user = await User.findOne({ api_key });
    if (!user) return res.send("BAD_KEY");
    if (user.is_banned) return res.send("USER_BANNED");

    switch (action) {
      case "getBalance":
        return res.send(`ACCESS_BALANCE:${user.balance.toFixed(4)}`);

      case "getOperators": {
        // Return active server slugs as operators
        const servers = await Server.find({ is_active: true });
        const ops = {};
        for (const s of servers) {
          ops[s.name] = s.slug;
        }
        ops["Any"] = "any";
        return res.json(ops);
      }

      case "getCountries": {
        const countries = await Country.find({ is_active: true }).sort({ name: 1 });
        const countriesMap = {};
        countries.forEach(c => {
          countriesMap[c.code] = c.name;
        });
        return res.json(countriesMap);
      }

      case "getServices": {
        const services = await Service.find({ is_active: true });
        const sMap = {};
        services.forEach(s => {
          // Use service_code as the primary key for the API
          sMap[s.service_code] = s.name;
        });
        return res.json(sMap);
      }

      case "getPrices": {
        const { country } = query;
        const services = await Service.find({ is_active: true });
        const prices = {};
        const isIndia = (c) => ["22", "91", "in"].includes(String(c).toLowerCase());

        services.forEach(svc => {
          if (country && svc.country_code !== country && !(isIndia(country) && isIndia(svc.country_code))) return;
          
          if (!prices[svc.country_code]) prices[svc.country_code] = {};
          if (!prices[svc.country_code][svc.service_code]) prices[svc.country_code][svc.service_code] = {};
          
          const userDiscounts = parseDiscounts(user.discounts);
          const finalPrice = calculateUserPrice(svc.price, svc.name, userDiscounts, String(svc.server_id?._id || svc.server_id || ''));
          if (!Number.isFinite(finalPrice) || finalPrice <= 0) return;
          const priceKey = finalPrice.toFixed(2);
          // Standard stub format: { "PRICE": "COUNT" }
          prices[svc.country_code][svc.service_code][priceKey] = 100;
        });
        
        return res.json(prices);
      }

      case "getNumber": {
        let { service, country, operator, maxPrice } = query;
        if (!service) return res.send("BAD_SERVICE");
        if (!country) return res.send("BAD_COUNTRY");

        let countryFilter = country;
        if (["22", "91", "in"].includes(String(country).toLowerCase())) {
          countryFilter = { $in: ["22", "91", "in", "IN"] };
        }
        const filter = { service_code: service, country_code: countryFilter, is_active: true };
        
        // Filter by operator (Server slug) if provided
        if (operator && operator !== "any") {
          const targetServer = await Server.findOne({ slug: operator });
          if (targetServer) {
            filter.server_id = targetServer._id;
          }
        }

        // Find matching services and pick the cheapest one
        const services = await Service.find(filter).sort({ price: 1 });
        if (!services || services.length === 0) return res.send("BAD_SERVICE");

        const svc = services[0];
        
        const userDiscounts = parseDiscounts(user.discounts);
        const finalPrice = calculateUserPrice(svc.price, svc.name, userDiscounts, String(svc.server_id?._id || svc.server_id || ''));

        if (!Number.isFinite(finalPrice) || finalPrice <= 0) return res.send("NO_NUMBERS");

        if (user.balance < finalPrice) return res.send("NO_BALANCE");
        if (maxPrice && finalPrice > parseFloat(maxPrice)) return res.send("NO_NUMBERS");

        const serverConf = await Server.findById(svc.server_id);
        if (!serverConf || !serverConf.is_active) return res.send("NO_NUMBERS");

        // 1. Pre-check and deduct balance atomically
        let balanceDeducted = false;
        const reservedOrderId = "ORD-" + nanoid(16).toUpperCase();
        let orderSaved = false;
        try {
          await wallet.reservePurchase({ userId: user._id, orderId: reservedOrderId,
            amount: finalPrice, description: `API: Purchased ${svc.name} (${country})` });
          balanceDeducted = true;
        } catch (err) {
          return res.send("NO_BALANCE");
        }

        // 2. Call provider API (outside transaction)
        let providerRes = null;
        try {
          try {
            providerRes = await providerApi.getNumber(serverConf, svc.service_code, svc.country_code || country);
          } catch (apiErr) {
            providerRes = { error: apiErr.message || "Provider API Failure" };
          }

          if (!providerRes || providerRes.error || !providerRes.api_order_id || !providerRes.phone) {
            throw new Error("PROVIDER_REJECTION");
          }

          // 4. Create Order and Transaction atomically
          const orderId = reservedOrderId;
          const minCancelMins = serverConf.min_cancel_minutes != null ? serverConf.min_cancel_minutes : 0;

          const orderData = {
            order_id: orderId,
            user_id: user._id,
            service_id: svc._id || svc.id,
            service_name: svc.name,
            server_name: serverConf.name,
            country,
            phone: providerRes.phone,
            external_order_id: providerRes.api_order_id,
            cost: finalPrice,
            status: "active",
            expires_at: new Date(Date.now() + (serverConf.auto_cancel_minutes || 20) * 60 * 1000),
            min_cancel_at: new Date(Date.now() + minCancelMins * 60 * 1000),
            service_image: svc.image_url || "",
            service_color: svc.icon_color || "",
            check_interval: serverConf.check_interval || 3,
            multi_otp_enabled: serverConf.multi_otp_supported || false
          };

          const savedOrder = await wallet.finalizePurchase(orderData);
          orderSaved = true;
          return res.send(numberResponse(savedOrder));
        } catch (err) {
          if (balanceDeducted && !orderSaved) {
            console.log(`[API/Order/Rollback] Rollback refunding user ${user._id} amount ${finalPrice}`);
            const reversed = await wallet.reversePurchase(reservedOrderId).catch(refundErr => {
              console.error("[API/Order/Rollback]", reservedOrderId, refundErr.message);
              return false;
            });

            if (reversed && err.message !== "DUPLICATE_EXTERNAL_ORDER" && providerRes?.api_order_id) {
              await providerApi.cancelOrder(serverConf, providerRes.api_order_id).catch(() => {});
            }
          }
          return res.send("NO_NUMBERS");
        }
      }

      case "getStatus": {
        const { id } = query;
        if (!id) return res.send("BAD_REQUEST");

        let order = await findUserOrder(user._id, id);
        if (!order) return res.send("NO_ACTIVATION");
        const getPublicStatus = current => {
          const history = wallet.otpHistory(current);
          const otp = current.otp || history[history.length - 1];
          if (otp) return `STATUS_OK:${otp}`;
          if (["cancelled", "expired", "refunded"].includes(current.status)) return "STATUS_CANCEL";
          if (current.status === "completed") return "STATUS_OK:";
          return "STATUS_WAIT_CODE";
        };
        if (order.status !== "active") return res.send(getPublicStatus(order));
        const interval = Math.max(3000, Number(order.check_interval || 3) * 1000);
        const nextCheckAt = order.next_check_at ? new Date(order.next_check_at) :
          (order.last_check_at ? new Date(new Date(order.last_check_at).getTime() + interval) : null);
        if (nextCheckAt && Date.now() < nextCheckAt.getTime() &&
            (!order.expires_at || Date.now() < new Date(order.expires_at).getTime())) {
          return res.send(getPublicStatus(order));
        }
        const { syncOrder } = require("../utils/orderStatusManager");
        order = await syncOrder(order) || await Order.findById(order._id);
        if (!order) return res.send("NO_ACTIVATION");
        return res.send(getPublicStatus(order));
      }

      case "reBuy":
      case "rebuy": {
        const { id } = query;
        if (!id) return res.send("BAD_REQUEST");
        try {
          const original = await findUserOrder(user._id, id);
          const rebuy = await rebuyCancelledOrder({ orderId: original?.order_id || id, userId: String(user._id) });
          return res.send(numberResponse(rebuy.order));
        } catch (err) {
          if (err.message === "INSUFFICIENT_BALANCE") return res.send("NO_BALANCE");
          if (err.message === "PROVIDER_CANCEL_FAILED") return res.send("BAD_STATUS");
          if (["ORDER_NOT_FOUND", "ORDER_NOT_REBUYABLE", "REBUY_ALREADY_USED", "REBUY_NOT_CONFIGURED", "ORIGINAL_REFUND_UNVERIFIED"].includes(err.message)) return res.send("BAD_STATUS");
          return res.send("NO_NUMBERS");
        }
      }

      case "cancelForRebuy":
      case "cancel_for_rebuy": {
        const { id } = query;
        if (!id) return res.send("BAD_REQUEST");
        try {
          const original = await findUserOrder(user._id, id);
          await cancelCompletedOrderForRebuy({ orderId: original?.order_id || id, userId: String(user._id) });
          return res.send("ACCESS_CANCEL_FOR_REBUY");
        } catch (err) {
          if (err.message === "ORDER_NOT_FOUND") return res.send("NO_ACTIVATION");
          if (["ORDER_NOT_CANCELLABLE_FOR_REBUY", "REBUY_CANCEL_NOT_CONFIGURED", "ORDER_STATE_CHANGED"].includes(err.message)) return res.send("BAD_STATUS");
          return res.send("ERROR");
        }
      }

      case "getStatusV2": {
        const { id } = query;
        if (!id) return res.send("BAD_REQUEST");
        const ids = id.split(",").map(i => i.trim());
        const orders = await findUserOrdersByIds(user._id, ids);
        const result = {};
        for (const id of ids) {
           const order = orders.get(id);
           if (!order) continue;
           if (order.status === "completed" || order.otp) {
              result[id] = `STATUS_OK:${order.otp}`;
           } else if (order.status === "cancelled" || order.status === "expired" || order.status === "refunded") {
              result[id] = "STATUS_CANCEL";
           } else {
              result[id] = "STATUS_WAIT_CODE";
           }
        }
        return res.json(result);
      }

      case "setStatus": {
        const { id, status } = query;
        if (!id) return res.send("BAD_REQUEST");
        
        let order = await findUserOrder(user._id, id);
        if (!order) return res.send("NO_ACTIVATION");

        const API_STATUS_CANCEL = process.env.API_STATUS_CANCEL || "8";
        if (String(status) === API_STATUS_CANCEL) {
           if (order.status !== "active") {
              return res.send(order.status === "cancelled" ? "ACCESS_CANCEL_ALREADY" : "ACCESS_CANCEL");
           }

           const { acquireLockWithTimeout, releaseLock } = require("../utils/orderLocks");
           const orderIdStr = String(order._id || order.id);
           if (!(await acquireLockWithTimeout(orderIdStr, 6000))) {
              return res.send("ACCESS_CANCEL"); // Lock is already held (sync/cancellation in progress)
           }

           try {
              order = await Order.findById(order._id);
              if (!order || order.status !== "active") return res.send("ACCESS_CANCEL_ALREADY");
              // ── Condition 1: Manual Cancel + OTP exists = mark completed ──
              const hasOtp = !!(order.otp || (order.all_otps && order.all_otps.length > 0));
              if (hasOtp) {
                order.status = "completed";
                order.refund_issued = true; // Also ensure refund is locked
                await Order.findOneAndUpdate({ _id: order._id, status: "active" }, { $set: { status: "completed", refund_issued: true } });
                return res.send("ACCESS_CANCEL");
              }

              // Enforce min_cancel_at (allow cancel after 2 mins only)
              if (order.min_cancel_at && Date.now() < new Date(order.min_cancel_at).getTime()) {
                 return res.send(`BAD_STATUS`);
              }

              const serverConf = await Server.findOne({ name: order.server_name });
              if (!serverConf?.api_cancel_url || !order.external_order_id) return res.send("BAD_STATUS");
              if (serverConf?.api_cancel_url && order.external_order_id) {
                const cancelled = await providerApi.cancelOrder(serverConf, order.external_order_id, { requireConfirmation: true, allowMissing: true });
                if (cancelled?.otp) {
                  await recordOrderSms(order, cancelled.otp, { complete: true });
                  return res.send("ACCESS_CANCEL");
                }
                if (!cancelled?.success) return res.send("BAD_STATUS");
              }
              const result = await wallet.refundOrder(order._id, "cancelled", `API cancelled order ${order.order_id}`);
              if (result.refunded) {
                emitToUser(String(user._id), "balance", { balance: result.newBalance });
                emitToUser(String(user._id), "order", { orderId: order.order_id, status: "cancelled" });
              }
              return res.send("ACCESS_CANCEL");
           } finally {
              releaseLock(orderIdStr);
           }
        }

        // status=3 -> Request another SMS (retry)
        if (status == "3") {
           const { acquireLockWithTimeout, releaseLock } = require("../utils/orderLocks");
           const retryLockId = String(order._id || order.id);
           if (!(await acquireLockWithTimeout(retryLockId, 6000))) return res.send("BAD_STATUS");
           try {
           order = await Order.findOne({ order_id: id, user_id: String(user._id) });
           if (!order || order.rebuy_cancelled || order.rebuy_order_id) return res.send("BAD_STATUS");
           const hasOtp = !!(order.otp || (order.all_otps && order.all_otps.length > 0));
           // Allow if completed OR if active with an OTP
           if (!hasOtp || !["active", "completed"].includes(order.status)) {
             return res.send("BAD_STATUS");
           }
           
           order.status = "active";
           order.otp = null;
           order.expires_at = new Date(Date.now() + 20 * 60 * 1000);
           
           // Call provider retry
           const serverConf = await Server.findOne({ name: order.server_name });
           if (serverConf && order.external_order_id) {
             const result = await providerApi.retryOrder(serverConf, order.external_order_id);
             if (result.error) return res.send("NO_NUMBERS");
           }

           const retried = await Order.findOneAndUpdate({ _id: order._id, status: { $in: ["active", "completed"] }, rebuy_cancelled: { $ne: true }, $or: [{ rebuy_order_id: "" }, { rebuy_order_id: null }], refund_issued: true }, {
             $set: { status: "active", otp: "", refund_issued: true, expires_at: order.expires_at },
           }, { new: true });
           if (!retried) return res.send("BAD_STATUS");
           return res.send("ACCESS_RETRY_GET");
           } finally { releaseLock(retryLockId); }
        }

        return res.send("BAD_STATUS");
      }

      default:
        return res.send("BAD_ACTION");
    }

  } catch (err) {
    console.error("API Gateway Error", err);
    return res.send("ERROR");
  }
});

module.exports = router;
