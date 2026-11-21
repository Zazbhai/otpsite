const Order = require("../models/Order");
const User = require("../models/User");
const Country = require("../models/Country");
const UserWebhook = require("../models/UserWebhook");
const { DB_TYPE, withTransaction } = require("./db");
const { buildSmsPayload, deliverWebhook } = require("./customerWebhook");
const { emitToUser } = require("./realtimeEmitter");

const pending = [];
let sending = 0;

function queueWebhook(order, message) {
  if (pending.length >= 500) {
    console.warn("[Customer webhook] Queue full for order", order.order_id);
    return;
  }
  const { order_id, user_id, service_name, country, phone, cost } = order;
  pending.push({ order: { order_id, user_id, service_name, country, phone, cost }, message });
  drain();
}

function drain() {
  while (sending < 16 && pending.length) {
    const { order, message } = pending.shift();
    sending++;
    notifyCustomer(order, message).catch(() => {
      console.warn("[Customer webhook] Could not prepare callback for order", order.order_id);
    }).finally(() => {
      sending--;
      drain();
    });
  }
}

async function notifyCustomer(order, message) {
  const filter = { user_id: String(order.user_id) };
  const prefs = await UserWebhook.findOne(DB_TYPE === "mysql" ? { where: filter } : filter);
  if (!prefs?.url) return;
  const user = await User.findById(order.user_id).select("api_key is_banned");
  if (!user?.api_key || user.is_banned) return;
  const country = order.country ? await Country.findOne({ code: order.country }).select("name") : null;
  const result = await deliverWebhook(prefs.url, user.api_key, buildSmsPayload(order, message, country?.name));
  if (!result.ok) console.warn("[Customer webhook] Callback failed for order", order.order_id, result.status || result.error);
}

// Persist a previously unseen message once per order before announcing it.
async function recordOrderSms(order, rawMessage, { complete = false, checkedAt } = {}) {
  if (typeof rawMessage !== "string") return null;
  const message = rawMessage.trim();
  if (!message) return null;
  const fields = { otp: message, refund_issued: true, verification_count: 0 };
  if (complete) fields.status = "completed";
  if (checkedAt) fields.last_check_at = checkedAt;

  let saved;
  if (DB_TYPE === "mysql") {
    saved = await withTransaction(async transaction => {
      const current = await Order.findById(order._id, { transaction, lock: true });
      if (!current || current.status !== "active" || current.otp === message) return null;
      const history = Array.isArray(current.all_otps) ? current.all_otps : [];
      if (history.includes(message)) return null;
      current.set({ ...fields, all_otps: [...history, message] });
      return current.save({ transaction });
    });
  } else {
    saved = await Order.findOneAndUpdate(
      { _id: order._id, status: "active", otp: { $ne: message }, all_otps: { $ne: message } },
      { $set: fields, $addToSet: { all_otps: message } },
      { new: true }
    );
  }
  if (!saved) return null;
  emitToUser(String(saved.user_id), "order", {
    orderId: saved.order_id, status: saved.status, otp: saved.otp, all_otps: saved.all_otps,
  });
  queueWebhook(saved, message);
  return saved;
}

module.exports = { recordOrderSms };
