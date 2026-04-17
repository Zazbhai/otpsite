const Order = require("../models/Order");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Server = require("../models/Server");
const providerApi = require("./providerApi");
const mongoose = require("mongoose");
const { emitToUser } = require("./realtimeEmitter");


/**
 * Synchronizes a single order with its provider and handles expiration/refunds.
 * Used by both User routes and the Background Watcher.
 */
async function syncOrder(orderIdOrDoc) {
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
      // No OTP: Mark as expired and refund
      order.status = "expired";
      const user = await User.findById(order.user_id);
      if (user) {
        user.balance = parseFloat((user.balance + order.cost).toFixed(4));
        await user.save();
        await Transaction.create({
          user_id: user._id, type: "refund", amount: order.cost,
          balance_after: user.balance, description: `Refund expired order ${order.order_id} (no OTP)`, order_id: order.order_id
        });
        emitToUser(String(order.user_id), "balance", { balance: user.balance });
      }
      await order.save();
      emitToUser(String(order.user_id), "order", { orderId: order.order_id, status: "expired" });
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
      
      if (!checkRes.error && checkRes.status !== "waiting") {
        if (order.multi_otp_enabled && checkRes.status === "completed") {
          // Multi-OTP: Stay active
          order.status = "active";
          if (checkRes.otp) {
            const cleanOtp = checkRes.otp.trim();
            if (!order.all_otps.includes(cleanOtp)) {
              order.otp = cleanOtp;
              order.all_otps.push(cleanOtp);
              // Request next OTP automatically
              providerApi.retryOrder(serverConf, order.external_order_id).catch(() => {});
              await order.save();
              // Push OTP update to user instantly
              emitToUser(String(order.user_id), "order", { orderId: order.order_id, status: order.status, otp: order.otp, all_otps: order.all_otps });
            }
          }
        } else {
          // Standard: Complete or Cancel
          order.status = checkRes.status;
          if (checkRes.otp) {
            const cleanOtp = checkRes.otp.trim();
            order.otp = cleanOtp;
            if (!order.all_otps.includes(cleanOtp)) {
              order.all_otps.push(cleanOtp);
            }
          }
           
          // ── Key business rule: OTP already received = order is COMPLETE ──
          const hasOtp = !!(order.otp || (order.all_otps && order.all_otps.length > 0));

          if (hasOtp && (order.status === "cancelled" || order.status === "refunded" || order.status === "expired")) {
             // Change status to completed and DO NOT refund
             order.status = "completed";
          } else if (order.status === "cancelled" || order.status === "refunded" || order.status === "expired") {
             // No OTP received, proceed with refund
             const user = await User.findById(order.user_id);
             if (user) {
                user.balance = parseFloat((user.balance + order.cost).toFixed(4));
                await user.save();
                await Transaction.create({
                  user_id: user._id, type: "refund", amount: order.cost,
                  balance_after: user.balance, description: `Provider cancelled order ${order.order_id} (no OTP)`, order_id: order.order_id
                });
                emitToUser(String(order.user_id), "balance", { balance: user.balance });
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
}

module.exports = { syncOrder };
