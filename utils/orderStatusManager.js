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
    const now = new Date();
    const expired = order.expires_at && new Date(order.expires_at) <= now;
    const interval = Math.max(3000, Number(order.check_interval) * 1000 || 3000);
    let response;
    const nextCheckAt = order.next_check_at ? new Date(order.next_check_at) :
      (order.last_check_at ? new Date(new Date(order.last_check_at).getTime() + interval) : null);
    const checkDue = !nextCheckAt || now >= nextCheckAt;
    if (nextCheckAt && now < nextCheckAt) {
      if (!order.next_check_at) {
        return await Order.findOneAndUpdate({ _id: id, status: "active", next_check_at: null }, {
          $set: { next_check_at: nextCheckAt },
        }, { new: true }) || order;
      }
      return order;
    }
    const leaseUntil = new Date(now.getTime() + Math.max(interval, 70000));
    const claimed = await Order.findOneAndUpdate({
      _id: id, status: "active", $or: [{ next_check_at: null }, { next_check_at: { $lte: now } }],
    }, { $set: { next_check_at: leaseUntil } }, { new: true });
    if (!claimed) return Order.findById(id);
    order = claimed;
    const server = await Server.findOne({ name: order.server_name });
    if (order.external_order_id && server?.api_check_status_url) {
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
      const checkedAt = new Date();
      const scheduledAt = response.retry_at ? new Date(response.retry_at) : new Date(checkedAt.getTime() + interval);
      order = await Order.findOneAndUpdate({ _id: id, status: "active" }, {
        $set: { last_check_at: checkedAt, next_check_at: scheduledAt, ...(response.status === "waiting" ? { verification_count: 0 } : {}) },
        ...(!response.error && response.status !== "waiting" && !response.otp?.trim()
          ? { $inc: { verification_count: 1 } } : {}),
      }, { new: true });
      if (!order) return Order.findById(id);
    } else {
      const checkedAt = new Date();
      order = await Order.findOneAndUpdate({ _id: id, status: "active" }, {
        $set: { last_check_at: checkedAt, next_check_at: new Date(checkedAt.getTime() + interval) },
      }, { new: true });
      if (!order) return Order.findById(id);
    }
    order = await Order.findById(id);
    if (!order || order.status !== "active") return order;
    if (!order.multi_otp_enabled && order.otp) {
      const completed = await Order.findOneAndUpdate({ _id: id, status: "active", otp: order.otp }, {
        $set: { status: "completed", refund_issued: true },
      }, { new: true });
      if (completed) announce(completed);
      return completed || Order.findById(id);
    }
    if (expired && hasOtp(order)) {
      const completed = await Order.findOneAndUpdate({ _id: id, status: "active" }, {
        $set: { status: "completed", refund_issued: true },
      }, { new: true });
      if (completed) announce(completed);
      return completed;
    }
    const providerEnded = !response?.error && ["cancelled", "expired", "refunded"].includes(response?.status) && order.verification_count >= 3;
    if (!hasOtp(order) && (providerEnded || (expired && checkDue))) {
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
