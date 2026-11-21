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

router.all("/", async (req, res) => {
  try {
    const query = req.method === "POST" ? req.body : req.query;
    const { api_key, action } = query;

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

        if (user.balance < finalPrice) return res.send("NO_BALANCE");
        if (maxPrice && finalPrice > parseFloat(maxPrice)) return res.send("NO_NUMBERS");

        const serverConf = await Server.findById(svc.server_id);
        if (!serverConf || !serverConf.is_active) return res.send("NO_NUMBERS");

        // 1. Pre-check and deduct balance atomically
        let balanceDeducted = false;
        let orderSaved = false;
        let balanceResult;
        try {
          balanceResult = await withTransaction(async (session) => {
            const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };

            const freshUser = await User.findOneAndUpdate(
              { _id: user._id, balance: { $gte: finalPrice } },
              { $inc: { balance: -finalPrice, total_spent: finalPrice, total_orders: 1 } },
              { ...queryOptions, new: true }
            );

            if (!freshUser) throw new Error("NO_BALANCE");

            return { userBalance: freshUser.balance };
          });
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

          if (providerRes.error) {
            throw new Error("PROVIDER_REJECTION");
          }

          // 4. Create Order and Transaction atomically
          const orderResult = await withTransaction(async (session) => {
            const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };

            if (providerRes.api_order_id) {
              const existingOrder = await Order.findOne({ external_order_id: providerRes.api_order_id }, null, queryOptions);
              if (existingOrder) throw new Error("DUPLICATE_EXTERNAL_ORDER");
            }

            const orderId = "ORD-" + nanoid(10).toUpperCase();
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

            let order;
            if (process.env.DB_TYPE === "mysql") {
              order = await Order.create(orderData, queryOptions);
            } else {
              const createdOrders = await Order.create([orderData], queryOptions);
              order = createdOrders[0];
            }

            const txData = {
              user_id: user._id,
              type: "purchase",
              amount: -finalPrice,
              balance_after: balanceResult.userBalance,
              description: `API: Purchased ${svc.name} (${country})`,
              order_id: orderId,
            };

            if (process.env.DB_TYPE === "mysql") {
              await Transaction.create(txData, queryOptions);
            } else {
              await Transaction.create([txData], queryOptions);
            }

            return { orderId, phone: providerRes.phone };
          });

          orderSaved = true;
          return res.send(`ACCESS_NUMBER:${orderResult.orderId}:${orderResult.phone.replace(/\D/g, '')}`);
        } catch (err) {
          if (balanceDeducted && !orderSaved) {
            console.log(`[API/Order/Rollback] Rollback refunding user ${user._id} amount ${finalPrice}`);
            await withTransaction(async (session) => {
              const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };
              await User.updateOne(
                { _id: user._id },
                { $inc: { balance: finalPrice, total_spent: -finalPrice, total_orders: -1 } },
                queryOptions
              );
            }).catch(refundErr => {
              console.error("[API/Order/Rollback] Critical Error: Rollback refund failed!", refundErr.message);
            });

            if (providerRes && providerRes.api_order_id) {
              providerApi.cancelOrder(serverConf, providerRes.api_order_id).catch(() => {});
            }
          }
          return res.send("NO_NUMBERS");
        }
      }

      case "getStatus": {
        const { id } = query;
        if (!id) return res.send("BAD_REQUEST");

        const order = await Order.findOne({ order_id: id, user_id: String(user._id) });
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
              // Attach OTP if received
              if (checkRes.otp) {
                const cleanOtp = checkRes.otp.trim();
                order.otp = cleanOtp;
                if (!order.all_otps.includes(cleanOtp)) {
                  order.all_otps = [...order.all_otps, cleanOtp];
                }
              }

              const hasOtp = !!(order.otp || (order.all_otps && order.all_otps.length > 0));

              if (hasOtp) {
                // Mark as non-refundable immediately
                if (!order.refund_issued) {
                  await Order.updateOne({ _id: order._id }, { $set: { refund_issued: true } });
                  order.refund_issued = true;
                }
                
                // NEVER auto-complete here. Stay active so user can get more OTPs.
                if (order.status !== "active") {
                  order.status = "active";
                  await order.save();
                }
                return res.send(`STATUS_OK:${order.otp}`);
              }

              if (checkRes.status === "cancelled" || checkRes.status === "refunded" || checkRes.status === "expired") {
                // Provider cancelled with no OTP — issue refund atomically in transaction
                await withTransaction(async (session) => {
                  const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };
                  
                  // Double Check Layer 1: Verify no refund transaction exists yet
                  const existingTx = await Transaction.findOne({ order_id: order.order_id, type: "refund" }, null, queryOptions);
                  if (existingTx) throw new Error("ALREADY_REFUNDED_TX");

                  // Double Check Layer 2: Atomic update with refund_issued check
                  const refundable = await Order.findOneAndUpdate(
                    { _id: order._id, refund_issued: { $ne: true } },
                    { $set: { status: "cancelled", refund_issued: true } },
                    { ...queryOptions, new: true }
                  );

                  if (refundable) {
                    const userAfterRefund = await User.findOneAndUpdate(
                      { _id: order.user_id },
                      { $inc: { balance: order.cost } },
                      { ...queryOptions, new: true }
                    );
                    
                    if (userAfterRefund) {
                      await Transaction.create([{
                        user_id: userAfterRefund._id || userAfterRefund.id, 
                        type: "refund", 
                        amount: order.cost,
                        balance_after: userAfterRefund.balance, 
                        description: `Provider cancelled order ${order.order_id} (no OTP)`, 
                        order_id: order.order_id
                      }], queryOptions);
                    }
                  }
                }).then(notifyAdminChange).catch(err => console.error("[getStatus] Refund transaction failed:", err.message));

                return res.send("STATUS_CANCEL");
              }
            }
          } finally {
            releaseLock(orderIdStr);
          }
        }
        return res.send("STATUS_WAIT_CODE");
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
        
        const order = await Order.findOne({ order_id: id, user_id: String(user._id) });
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
              // ── Condition 1: Manual Cancel + OTP exists = mark completed ──
              const hasOtp = !!(order.otp || (order.all_otps && order.all_otps.length > 0));
              if (hasOtp) {
                order.status = "completed";
                order.refund_issued = true; // Also ensure refund is locked
                await order.save();
                return res.send("ACCESS_CANCEL");
              }

              // Enforce min_cancel_at (allow cancel after 2 mins only)
              if (order.min_cancel_at && Date.now() < new Date(order.min_cancel_at).getTime()) {
                 return res.send(`BAD_STATUS`);
              }

              const serverConf = await Server.findOne({ name: order.server_name });
              if (serverConf && serverConf.api_cancel_url && order.external_order_id) {
                 await providerApi.cancelOrder(serverConf, order.external_order_id).catch(() => {});
              }

              // Atomic refund lock + balance update in ONE transaction
              const cancelResult = await withTransaction(async (session) => {
                const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };
                
                // Double Check Layer 1: Verify no refund transaction exists yet
                const existingTx = await Transaction.findOne({ order_id: order.order_id, type: "refund" }, null, queryOptions);
                if (existingTx) throw new Error("ALREADY_REFUNDED_TX");

                // Double Check Layer 2: Atomic update with refund_issued check
                const refundable = await Order.findOneAndUpdate(
                  { _id: order._id, refund_issued: { $ne: true } },
                  { $set: { refund_issued: true, status: "cancelled" } },
                  { ...queryOptions, new: true }
                );
                
                if (!refundable) return "ALREADY_REFUNDED";

                const userAfterRefund = await User.findOneAndUpdate(
                  { _id: user._id },
                  { $inc: { balance: order.cost } },
                  { ...queryOptions, new: true }
                );

                if (userAfterRefund) {
                  await Transaction.create([{
                     user_id: userAfterRefund._id || userAfterRefund.id, 
                     type: "refund", 
                     amount: order.cost,
                     balance_after: userAfterRefund.balance, 
                     description: `API Cancelled order ${order.order_id}`, 
                     order_id: order.order_id
                  }], queryOptions);
                }
                return "SUCCESS";
              }).catch(err => {
                console.error("[setStatus] Cancel transaction failed:", err.message);
                return "ERROR";
              });
              return res.send("ACCESS_CANCEL");
           } finally {
              releaseLock(orderIdStr);
           }
        }

        // status=3 -> Request another SMS (retry)
        if (status == "3") {
           const hasOtp = !!(order.otp || (order.all_otps && order.all_otps.length > 0));
           // Allow if completed OR if active with an OTP
           if (order.status !== "completed" && !(order.status === "active" && hasOtp)) {
             return res.send("BAD_STATUS");
           }
           
           order.status = "active";
           order.otp = null;
           order.expires_at = new Date(Date.now() + 20 * 60 * 1000);
           
           // Call provider retry
           const serverConf = await Server.findOne({ name: order.server_name });
           if (serverConf && order.external_order_id) {
             await providerApi.retryOrder(serverConf, order.external_order_id).catch(() => {});
           }

           await order.save();
           return res.send("ACCESS_RETRY_GET");
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
