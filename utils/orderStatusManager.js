const Order = require("../models/Order");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Server = require("../models/Server");
const providerApi = require("./providerApi");
const mongoose = require("mongoose");

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

  // 1. Handle Expiration (Auto-Refund)
  if (order.status === "active" && order.expires_at && order.expires_at < new Date()) {
    order.status = "expired";
    const user = await User.findById(order.user_id);
    if (user) {
      user.balance = parseFloat((user.balance + order.cost).toFixed(4));
      await user.save();
      await Transaction.create({
        user_id: user._id, type: "refund", amount: order.cost,
        balance_after: user.balance, description: `Refund expired order ${order.order_id}`, order_id: order.order_id
      });
    }
    await order.save();
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
          if (checkRes.otp && !order.all_otps.includes(checkRes.otp)) {
            order.otp = checkRes.otp;
            order.all_otps.push(checkRes.otp);
            // Request next OTP automatically
            providerApi.retryOrder(serverConf, order.external_order_id).catch(() => {});
          }
        } else {
          // Standard: Complete or Cancel
          order.status = checkRes.status;
          if (checkRes.otp) {
            order.otp = checkRes.otp;
            if (!order.all_otps.includes(checkRes.otp)) order.all_otps.push(checkRes.otp);
          }
           
          // If Provider cancelled it, refund it
          if (order.status === "cancelled" || order.status === "refunded") {
             const user = await User.findById(order.user_id);
             if (user) {
                user.balance = parseFloat((user.balance + order.cost).toFixed(4));
                await user.save();
                await Transaction.create({
                  user_id: user._id, type: "refund", amount: order.cost,
                  balance_after: user.balance, description: `Provider cancelled order ${order.order_id}`, order_id: order.order_id
                });
             }
          }
        }
        await order.save();
      }
    }
  }

  return order;
}

module.exports = { syncOrder };
