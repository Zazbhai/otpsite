const Order = require("../models/Order");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Server = require("../models/Server");
const providerApi = require("./providerApi");
const mongoose = require("mongoose");
const { emitToUser } = require("./realtimeEmitter");
const { DB_TYPE, withTransaction } = require("./db");
const { recordOrderSms } = require("./orderSms");

// Retain the existing protection against providers recycling a response
// across different orders while multiple polls are running in this process.
const processingMessages = new Set();

const { acquireLock, releaseLock } = require("./orderLocks");


/**
 * Synchronizes a single order with its provider and handles expiration/refunds.
 * Used by both User routes and the Background Watcher.
 */
async function syncOrder(orderIdOrDoc) {
  let orderId;
  if (typeof orderIdOrDoc === 'string' || orderIdOrDoc instanceof mongoose.Types.ObjectId) {
    orderId = String(orderIdOrDoc);
  } else {
    orderId = String(orderIdOrDoc._id || orderIdOrDoc.id);
  }

  if (!acquireLock(orderId)) {
    // Return early to prevent overlapping concurrent updates on the same order
    return null;
  }

  try {
    let order;
    if (typeof orderIdOrDoc === 'string' || orderIdOrDoc instanceof mongoose.Types.ObjectId) {
      order = await Order.findById(orderIdOrDoc);
    } else {
      order = orderIdOrDoc;
    }

    if (!order) return null;

    const serverConf = await Server.findOne({ name: order.server_name });

    // 1. Handle Expiration
    if (order.status === "active" && order.expires_at && order.expires_at < new Date()) {
      const hasOtp = !!(order.otp || (order.all_otps && order.all_otps.length > 0));
      
      if (hasOtp) {
        // Has OTP: Mark as completed, no refund
        order.status = "completed";
        await order.save();
        emitToUser(String(order.user_id), "order", { orderId: order.order_id, status: "completed", otp: order.otp, all_otps: order.all_otps });
      } else {
        // Double-check: Group order status and user balance update in a single transaction
        let refundSuccess = false;
        await withTransaction(async (session) => {
          const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };

          // 1. Verify NO refund transaction exists yet (Double Check Layer 1)
          const existingTx = await Transaction.findOne({ order_id: order.order_id, type: "refund" }, null, queryOptions);
          if (existingTx) throw new Error("ALREADY_REFUNDED_TX");

          // Double Check Layer 2: Verify fresh order state in DB
          const freshOrder = process.env.DB_TYPE === "mysql"
            ? await Order.findById(order._id, queryOptions)
            : await Order.findById(order._id, null, queryOptions);
          
          if (!freshOrder || freshOrder.refund_issued || ["cancelled", "expired", "refunded"].includes(freshOrder.status)) {
            throw new Error("ALREADY_REFUNDED_FLAG");
          }

          // 2. Atomic Order Update (Double Check Layer 3)
          const updatedOrder = await Order.findOneAndUpdate(
            { _id: order._id, refund_issued: { $ne: true }, status: { $nin: ["cancelled", "expired", "refunded"] } },
            { $set: { status: "expired", refund_issued: true } },
            { ...queryOptions, new: true }
          );
          if (!updatedOrder) throw new Error("ALREADY_REFUNDED_FLAG");

          // 3. Atomic User Balance Update
          const updatedUser = await User.findOneAndUpdate(
            { _id: order.user_id },
            { $inc: { balance: order.cost } },
            { ...queryOptions, new: true }
          );
          
          if (updatedUser) {
            await Transaction.create([{
              user_id: updatedUser._id, type: "refund", amount: order.cost,
              balance_after: updatedUser.balance, description: `Refund expired order ${order.order_id} (no OTP)`, order_id: order.order_id
            }], queryOptions);
            emitToUser(String(order.user_id), "balance", { balance: updatedUser.balance });
          }
          refundSuccess = true;
        }).catch(err => {
          if (err.message !== "ALREADY_REFUNDED_TX" && err.message !== "ALREADY_REFUNDED_FLAG") {
            console.error("[syncOrder/Expiry] Refund Error:", err.message);
          }
        });

        if (refundSuccess) {
          // Cancel on provider to release the phone number (UX + provider costs defense)
          if (serverConf && serverConf.api_cancel_url && order.external_order_id) {
             providerApi.cancelOrder(serverConf, order.external_order_id).catch(() => {});
          }
          emitToUser(String(order.user_id), "order", { orderId: order.order_id, status: "expired" });
        }
      }
      return order;
    }

    // 2. Poll Provider for Updates
    if (order.status === "active" && order.external_order_id && serverConf?.api_check_status_url) {
      const now = new Date();
      const lastCheck = order.last_check_at || new Date(0);
      
      if (now - lastCheck >= 2000) {
        order.last_check_at = now;
        const checkRes = await providerApi.checkStatus(serverConf, order.external_order_id);
        
        if (!checkRes.error) {
          if (checkRes.otp?.trim()) {
            const message = checkRes.otp.trim();
            if (order.all_otps?.includes(message) || processingMessages.has(message)) return order;
            processingMessages.add(message);
            try {
              if (DB_TYPE !== "mysql" && await Order.exists({
                all_otps: message,
                order_id: { $ne: order.order_id },
                createdAt: { $gte: new Date(Date.now() - 86400000) },
              })) return order;

              const saved = await recordOrderSms(order, message, {
                complete: checkRes.status === "completed" && !order.multi_otp_enabled,
                checkedAt: now,
              });
              if (saved?.multi_otp_enabled && checkRes.status === "completed") {
                providerApi.retryOrder(serverConf, order.external_order_id).catch(() => {});
              }
              return saved || order;
            } finally {
              processingMessages.delete(message);
            }
          }

          if (checkRes.status === "waiting") {
            // Reset verification count when the provider returns to waiting.
            if (order.verification_count > 0) {
              order.verification_count = 0;
              await order.save();
            }
          } else {
            // Increment verification count for non-waiting status
            order.verification_count = (order.verification_count || 0) + 1;
            console.log(`[SyncOrder] Triple-Check: ${order.order_id} verification ${order.verification_count}/3 (Status: ${checkRes.status})`);

            if (order.verification_count >= 3) {
              // PROCEED with final status update after 3 confirmations
              if (order.multi_otp_enabled && checkRes.status === "completed") {
                // Multi-OTP: Stay active for the next message.
                order.status = "active";
                order.verification_count = 0; // Reset for next possible event
              } else {
                const hasOtp = !!(order.otp || (order.all_otps && order.all_otps.length > 0));
                if (hasOtp && !order.refund_issued) {
                  order.refund_issued = true;
                }

                if (hasOtp) {
                  order.status = "active"; // Keep active until expiry or manual cancel
                  order.verification_count = 0; // Reset
                } else if (checkRes.status === "cancelled" || checkRes.status === "refunded" || checkRes.status === "expired") {
                  // Triple-Verified DEAD status with no OTP — ISSUE REFUND
                  await withTransaction(async (session) => {
                    const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };
                    
                    // Double Check Layer 1: Verify no refund transaction exists yet
                    const existingTx = await Transaction.findOne({ order_id: order.order_id, type: "refund" }, null, queryOptions);
                    if (existingTx) throw new Error("ALREADY_REFUNDED_TX");

                    // Double Check Layer 2: Verify fresh order state in DB
                    const freshOrder = process.env.DB_TYPE === "mysql"
                      ? await Order.findById(order._id, queryOptions)
                      : await Order.findById(order._id, null, queryOptions);
                    
                    if (!freshOrder || freshOrder.refund_issued || ["cancelled", "expired", "refunded"].includes(freshOrder.status)) {
                      throw new Error("ALREADY_REFUNDED_FLAG");
                    }

                    // Double Check Layer 3: Atomic Lock & Mark Cancelled
                    const refundable = await Order.findOneAndUpdate(
                      { _id: order._id, refund_issued: { $ne: true }, status: { $nin: ["cancelled", "expired", "refunded"] } },
                      { $set: { status: checkRes.status, refund_issued: true } },
                      { ...queryOptions, new: true }
                    );

                    if (refundable) {
                      const updatedUser = await User.findOneAndUpdate(
                        { _id: order.user_id },
                        { $inc: { balance: order.cost } },
                        { ...queryOptions, new: true }
                      );
                      
                      if (updatedUser) {
                        await Transaction.create([{
                          user_id: updatedUser._id, type: "refund", amount: order.cost,
                          balance_after: updatedUser.balance, description: `Refund: Order ${order.order_id} confirmed ${checkRes.status} after 3 checks`, order_id: order.order_id
                        }], queryOptions);
                        emitToUser(String(order.user_id), "balance", { balance: updatedUser.balance });
                      }
                    }
                  }).catch(err => console.error("[TripleCheck] Refund failed:", err.message));
                }
              }
            }
            
            await order.save();
            // Push status + OTP update to user instantly
            emitToUser(String(order.user_id), "order", { orderId: order.order_id, status: order.status, otp: order.otp, all_otps: order.all_otps });
          }
        }
      }
    }

    return order;
  } finally {
    releaseLock(orderId);
  }
}

module.exports = { syncOrder };
