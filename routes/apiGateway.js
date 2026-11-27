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
const { rebuyCancelledOrder, cancelCompletedOrderForRebuy } = require("../utils/rebuy");

// Both allocation actions use the same legacy SMS API success response.
function numberResponse(order) {
  return `ACCESS_NUMBER:${order.order_id}:${String(order.phone).replace(/\D/g, "")}`;
}

router.all("/", async (req, res) => {
  try {
    const query = req.method === "POST" ? req.body : req.query;
    const { action } = query;
    const api_key = query.api_key || query.apikey;

    if (!api_key) return res.send("BAD_KEY");

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
              providerApi.cancelOrder(serverConf, providerRes.api_order_id).catch(() => {});
            }
          }
          return res.send("NO_NUMBERS");
        }
      }

      case "getStatus": {
        const { id } = query;
        if (!id) return res.send("BAD_REQUEST");

        let order = await Order.findOne({ order_id: id, user_id: String(user._id) });
        if (!order) return res.send("NO_ACTIVATION");

        // ── Check 1: Already has OTP — return OTP but DO NOT force completion ──
        if (order.otp || (order.all_otps && order.all_otps.length > 0)) {
          return res.send(`STATUS_OK:${order.otp || order.all_otps[0]}`);
        }

        // ── Check 2: Already terminal (cancelled/expired/refunded) ──
        if (order.status === "cancelled" || order.status === "expired" || order.status === "refunded") {
          return res.send("STATUS_CANCEL");
        }

        // ── Check 3: Completed but somehow missing OTP ──
        if (order.status === "completed") {
          return res.send(`STATUS_OK:${order.otp || ""}`);
        }

        // ── Check 4: Poll provider for live status ──
        const serverConf = await Server.findOne({ name: order.server_name });
        if (serverConf && serverConf.api_check_status_url && order.external_order_id) {
          const { acquireLock, releaseLock } = require("../utils/orderLocks");
          const orderIdStr = String(order._id || order.id);
          if (!acquireLock(orderIdStr)) {
            return res.send("STATUS_WAIT_CODE"); // Skip concurrent poll and return wait code safely
          }

          try {
            const checkRes = await providerApi.checkStatus(serverConf, order.external_order_id);

            if (!checkRes.error && checkRes.status !== "waiting") {
              if (checkRes.otp) {
                const saved = await recordOrderSms(order, checkRes.otp);
                if (saved) {
                  if (saved.multi_otp_enabled && checkRes.status === "completed") {
                    providerApi.retryOrder(serverConf, order.external_order_id).catch(() => {});
                  }
                  return res.send(`STATUS_OK:${saved.otp}`);
                }
                const current = await Order.findById(order._id);
                if (current?.otp) return res.send(`STATUS_OK:${current.otp}`);
                if (!current || ["cancelled", "expired", "refunded"].includes(current.status)) {
                  return res.send("STATUS_CANCEL");
                }
                return res.send("STATUS_WAIT_CODE");
              }

              if (checkRes.status === "cancelled" || checkRes.status === "refunded" || checkRes.status === "expired") {
                // Provider cancelled with no OTP — issue refund atomically in transaction
                const result = await wallet.refundOrder(order._id, "cancelled", `Provider cancelled order ${order.order_id} (no OTP)`);
                if (result.refunded) notifyAdminChange();
                if (wallet.hasOtp(result.order)) return res.send(`STATUS_OK:${result.order.otp || result.order.all_otps[0]}`);

                return res.send("STATUS_CANCEL");
              }
            }
          } finally {
            releaseLock(orderIdStr);
          }
        }
        return res.send("STATUS_WAIT_CODE");
      }

      case "reBuy":
      case "rebuy": {
        const { id } = query;
        if (!id) return res.send("BAD_REQUEST");
        try {
          const rebuy = await rebuyCancelledOrder({ orderId: id, userId: String(user._id) });
          return res.send(numberResponse(rebuy.order));
        } catch (err) {
          if (err.message === "INSUFFICIENT_BALANCE") return res.send("NO_BALANCE");
          if (["ORDER_NOT_FOUND", "ORDER_NOT_REBUYABLE", "REBUY_ALREADY_USED", "REBUY_NOT_CONFIGURED", "ORIGINAL_REFUND_UNVERIFIED"].includes(err.message)) return res.send("BAD_STATUS");
          return res.send("NO_NUMBERS");
        }
      }

      case "cancelForRebuy":
      case "cancel_for_rebuy": {
        const { id } = query;
        if (!id) return res.send("BAD_REQUEST");
        try {
          await cancelCompletedOrderForRebuy({ orderId: id, userId: String(user._id) });
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
        // For performance, we only return the DB state in V2 bulk checks
        const orders = await Order.find({ order_id: { $in: ids }, user_id: user._id });
        
        const result = {};
        for (const order of orders) {
           if (order.status === "completed" || order.otp) {
              result[order.order_id] = `STATUS_OK:${order.otp}`;
           } else if (order.status === "cancelled" || order.status === "expired" || order.status === "refunded") {
              result[order.order_id] = "STATUS_CANCEL";
           } else {
              result[order.order_id] = "STATUS_WAIT_CODE";
           }
        }
        return res.json(result);
      }

      case "setStatus": {
        const { id, status } = query;
        if (!id) return res.send("BAD_REQUEST");
        
        let order = await Order.findOne({ order_id: id, user_id: String(user._id) });
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

              const result = await wallet.refundOrder(order._id, "cancelled", `API cancelled order ${order.order_id}`);
              if (result.refunded) {
                const serverConf = await Server.findOne({ name: order.server_name });
                if (serverConf?.api_cancel_url && order.external_order_id) {
                  providerApi.cancelOrder(serverConf, order.external_order_id).catch(() => {});
                }
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
