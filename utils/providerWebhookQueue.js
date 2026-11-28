const crypto = require("node:crypto");
const Callback = require("../models/ProviderWebhookCallback");
const Order = require("../models/Order");
const { recordOrderSms } = require("./orderSms");

function serverId(server) { return String(server?._id || server?.id || ""); }
function databaseReady() {
  // Mongoose buffers queries while disconnected for up to 10 seconds. Queue
  // replay is best effort (the periodic sweep will retry), so avoid blocking
  // an allocation or shutdown on that buffer.
  if (Callback?.db && typeof Callback.db.readyState === "number") return Callback.db.readyState === 1;
  return true;
}
function key(server, externalOrderId, otp) {
  return crypto.createHash("sha256").update(`${serverId(server)}\0${externalOrderId}\0${otp}`).digest("hex");
}

async function saveUnmatchedCallback(server, externalOrderId, otp, body = {}) {
  const dedupe_key = key(server, externalOrderId, otp);
  const data = {
    dedupe_key, server_id: serverId(server), server_name: String(server?.name || ""),
    external_order_id: externalOrderId, otp, status: String(body.status || body.state || "").slice(0, 80),
    payload: JSON.stringify({ status: body.status, state: body.state }), state: "pending",
  };
  try {
    const existing = await Callback.findOne({ dedupe_key });
    if (existing) {
      await Callback.findOneAndUpdate({ dedupe_key }, { $inc: { attempts: 1 } }, { new: true });
    } else await Callback.create(data);
  } catch (error) {
    if (!(error?.code === 11000 || error?.name === "SequelizeUniqueConstraintError")) throw error;
  }
  console.info("[Provider webhook]", "OTP_QUEUED_UNMATCHED", { server: serverId(server), external_order_id: externalOrderId });
  return { dedupe_key };
}

async function retryForOrder(order) {
  if (!order) return 0;
  if (!databaseReady()) return 0;
  const ids = [...new Set([order.external_order_id, order.provider_order_id, order.order_id].map(String).filter(Boolean))];
  if (!ids.length || typeof Callback.find !== "function") return 0;
  const serverFilter = order.server_id
    ? { $or: [{ server_id: String(order.server_id) }, { server_name: String(order.server_name || "") }] }
    : { server_name: String(order.server_name || "") };
  const filter = { ...serverFilter, state: "pending", external_order_id: { $in: ids } };
  const rows = await Callback.find(filter).limit(100);
  let matched = 0;
  for (const callback of rows) {
    const currentOrder = await Order.findById(order._id || order.id);
    if (!currentOrder) continue;
    const waiting = ["waiting", "pending", "processing"].includes(String(callback.status || "").toLowerCase());
    const saved = await recordOrderSms(currentOrder, callback.otp, { complete: !currentOrder.multi_otp_enabled && !waiting });
    const current = saved || await Order.findById(currentOrder._id || currentOrder.id);
    if (saved || current.otp === callback.otp || current.all_otps?.includes(callback.otp)) {
      await Callback.findOneAndUpdate({ _id: callback._id, state: "pending" }, {
        $set: { state: "matched", matched_order_id: String(order.order_id), matched_at: new Date() },
      });
      matched++;
    }
  }
  return matched;
}

async function retryPendingCallbacks(limit = 100) {
  if (typeof Callback.find !== "function") return 0;
  if (!databaseReady()) return 0;
  const pending = await Callback.find({ state: "pending" }).sort({ createdAt: 1 }).limit(Math.max(1, Math.min(500, limit)));
  let matched = 0;
  for (const callback of pending) {
    const serverFilter = callback.server_id
      ? { $or: [{ server_id: callback.server_id }, { server_name: callback.server_name }] }
      : { server_name: callback.server_name };
    const order = await Order.findOne({ $and: [serverFilter, { $or: [
      { external_order_id: callback.external_order_id },
      { provider_order_id: callback.external_order_id },
      { order_id: callback.external_order_id },
    ] }] });
    if (order) matched += await retryForOrder(order);
  }
  return matched;
}

module.exports = { saveUnmatchedCallback, retryForOrder, retryPendingCallbacks };
