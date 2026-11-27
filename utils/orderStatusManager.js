const Order = require("../models/Order");
const Server = require("../models/Server");
const providerApi = require("./providerApi");
const { emitToUser } = require("./realtimeEmitter");
const { recordOrderSms } = require("./orderSms");
const { refundOrder, hasOtp } = require("./wallet");
const { acquireLock, releaseLock } = require("./orderLocks");

function announce(order) {
  emitToUser(String(order.user_id), "order", {
    orderId: order.order_id, status: order.status, otp: order.otp, all_otps: order.all_otps,
  });
}

async function syncOrder(orderIdOrDoc) {
  const id = String(orderIdOrDoc?._id || orderIdOrDoc?.id || orderIdOrDoc);
  if (!acquireLock(id)) return null;
  try {
    // Supplied watcher/route documents may predate a concurrent cancellation.
    let order = await Order.findById(id);
    if (!order || order.status !== "active") return order;
    const server = await Server.findOne({ name: order.server_name });
    const now = new Date();
    const expired = order.expires_at && new Date(order.expires_at) <= now;
    const interval = Math.max(3000, Number(order.check_interval || server?.check_interval || 3) * 1000);
    let response;
    if (order.external_order_id && server?.api_check_status_url &&
        (expired || now - new Date(order.last_check_at || 0) >= interval)) {
      response = await providerApi.checkStatus(server, order.external_order_id);
      if (!response.error && response.otp?.trim()) {
        const saved = await recordOrderSms(order, response.otp, {
          complete: response.status === "completed" && !order.multi_otp_enabled, checkedAt: now,
        });
        if (saved?.multi_otp_enabled && response.status === "completed") {
          providerApi.retryOrder(server, order.external_order_id).catch(() => {});
        }
      }
      // Only bookkeeping fields are updated. Never save a pre-network document.
      order = await Order.findOneAndUpdate({ _id: id, status: "active" }, {
        $set: { last_check_at: now, ...(response.status === "waiting" ? { verification_count: 0 } : {}) },
        ...(!response.error && response.status !== "waiting" && !response.otp?.trim()
          ? { $inc: { verification_count: 1 } } : {}),
      }, { new: true });
      if (!order) return Order.findById(id);
    }
    order = await Order.findById(id);
    if (!order || order.status !== "active") return order;
    if (expired && hasOtp(order)) {
      const completed = await Order.findOneAndUpdate({ _id: id, status: "active" }, {
        $set: { status: "completed", refund_issued: true },
      }, { new: true });
      if (completed) announce(completed);
      return completed;
    }
    const providerEnded = !response?.error && ["cancelled", "expired", "refunded"].includes(response?.status) && order.verification_count >= 3;
    if (!hasOtp(order) && (expired || providerEnded)) {
      if (expired && server?.api_cancel_url && order.external_order_id) {
        const cancelled = await providerApi.cancelOrder(server, order.external_order_id, { requireConfirmation: true, allowMissing: true }).catch(() => null);
        if (cancelled?.otp) {
          const completed = await recordOrderSms(order, cancelled.otp, { complete: true, checkedAt: now });
          return completed || Order.findById(id);
        }
        if (!cancelled?.success) return Order.findById(id);
      }
      const result = await refundOrder(id, expired ? "expired" : response.status,
        `${expired ? "Expired" : "Provider ended"} order ${order.order_id} (no OTP)`);
      if (result.refunded) {
        emitToUser(String(order.user_id), "balance", { balance: result.newBalance });
        announce(result.order);
      }
      return result.order;
    }
    return order;
  } finally { releaseLock(id); }
}

module.exports = { syncOrder };
