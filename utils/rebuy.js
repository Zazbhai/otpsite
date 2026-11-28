const Order = require("../models/Order");
const Server = require("../models/Server");
const Service = require("../models/Service");
const Transaction = require("../models/Transaction");
const wallet = require("./wallet");
const providerApi = require("./providerApi");
const providerOrderId = order => String(order?.provider_order_id || order?.external_order_id || "").trim();
const { nanoid } = require("nanoid");
const { acquireLockWithTimeout, releaseLock } = require("./orderLocks");
const { money } = require("./money");

const hasOtp = order => wallet.hasOtp(order);
const digits = value => String(value || "").replace(/\D/g, "");

async function cancelCompletedOrderForRebuy({ orderId, userId }) {
  let order = await Order.findOne({ order_id: String(orderId), user_id: String(userId) });
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (order.status !== "completed" || !hasOtp(order) || order.rebuy_cancelled || order.rebuy_order_id) {
    throw new Error("ORDER_NOT_CANCELLABLE_FOR_REBUY");
  }
  const lockId = String(order._id || order.id);
  if (!(await acquireLockWithTimeout(lockId, 6000))) throw new Error("REBUY_IN_PROGRESS");
  try {
    order = await Order.findOne({ order_id: String(orderId), user_id: String(userId) });
    if (!order || order.status !== "completed" || !hasOtp(order) || order.rebuy_cancelled || order.rebuy_order_id) {
      throw new Error("ORDER_NOT_CANCELLABLE_FOR_REBUY");
    }
    const server = await Server.findOne({ name: order.server_name });
    if (!server?.is_active || !server.api_cancel_url || !server.api_rebuy_url || !order.external_order_id) {
      throw new Error("REBUY_CANCEL_NOT_CONFIGURED");
    }
    const result = await providerApi.cancelOrder(server, providerOrderId(order), { requireConfirmation: true, allowMissing: true });
    if (!result?.success) throw new Error("PROVIDER_CANCEL_FAILED");
    const updated = await Order.findOneAndUpdate({
      _id: order._id || order.id, user_id: String(userId), status: "completed",
      rebuy_cancelled: { $ne: true }, $or: [{ rebuy_order_id: "" }, { rebuy_order_id: null }],
    }, { $set: { rebuy_cancelled: true, refund_issued: true } }, { new: true });
    if (!updated) throw new Error("ORDER_STATE_CHANGED");
    return updated;
  } finally {
    releaseLock(lockId);
  }
}

async function rebuyCancelledOrder({ orderId, userId }) {
  let original = await Order.findOne({ order_id: String(orderId), user_id: String(userId) });
  if (!original) throw new Error("ORDER_NOT_FOUND");
  const eligibleAfterOtpCancel = original.status === "completed" && original.rebuy_cancelled && hasOtp(original);
  const eligibleRefunded = ["cancelled", "expired", "refunded"].includes(original.status) && original.refund_issued && !hasOtp(original);
  if (!eligibleAfterOtpCancel && !eligibleRefunded) throw new Error("ORDER_NOT_REBUYABLE");
  if (original.rebuy_order_id) throw new Error("REBUY_ALREADY_USED");

  const lockId = String(original._id || original.id);
  if (!(await acquireLockWithTimeout(lockId, 6000))) throw new Error("REBUY_IN_PROGRESS");
  try {
    original = await Order.findOne({ order_id: String(orderId), user_id: String(userId) });
    const otpCancelled = original?.status === "completed" && original.rebuy_cancelled && hasOtp(original);
    const refunded = ["cancelled", "expired", "refunded"].includes(original?.status) && original?.refund_issued && !hasOtp(original);
    if (!otpCancelled && !refunded) throw new Error("ORDER_NOT_REBUYABLE");
    if (original.rebuy_order_id) throw new Error("REBUY_ALREADY_USED");

    const purchase = await Transaction.findOne({ order_id: original.order_id, user_id: String(userId), type: "purchase", status: "completed" });
    const refund = refunded
      ? await Transaction.findOne({ order_id: original.order_id, user_id: String(userId), type: "refund", status: "completed" })
      : null;
    if (!purchase || money(purchase.amount) >= 0 || money(-Number(purchase.amount)) !== money(original.cost) ||
        (refunded && (!refund || money(refund.amount) !== money(original.cost)))) {
      throw new Error("ORIGINAL_REFUND_UNVERIFIED");
    }

    const server = await Server.findOne({ name: original.server_name });
    if (!server?.is_active || !server.api_rebuy_url || !original.external_order_id || !digits(original.phone)) throw new Error("REBUY_NOT_CONFIGURED");
    const service = original.service_id ? await Service.findById(original.service_id) : null;
    const rebuyOrderId = "ORD-" + nanoid(16).toUpperCase();
    const amount = money(original.cost);
    let providerResult;
    let reserved = false;
    let claimed = false;
    let rebuyAttempted = false;
    let reservedUser;
    try {
      reservedUser = await wallet.reservePurchase({ userId, orderId: rebuyOrderId, amount,
        description: `Rebought ${original.service_name} on ${original.phone}` });
      reserved = true;
      const orderClaim = await Order.findOneAndUpdate({ _id: original._id || original.id,
        user_id: String(userId), status: otpCancelled ? "completed" : { $in: ["cancelled", "expired", "refunded"] },
        refund_issued: true,
        ...(otpCancelled ? { rebuy_cancelled: true } : { $and: [{ $or: [{ otp: "" }, { otp: null }] }] }),
        $or: [{ rebuy_order_id: "" }, { rebuy_order_id: null }],
      }, { $set: { rebuy_order_id: rebuyOrderId } }, { new: true });
      if (!orderClaim) throw new Error("REBUY_ALREADY_USED");
      claimed = true;
      // Terminal local status alone does not prove that a provider activation
      // was cancelled, particularly for old admin refunds or failed cleanup.
      if (refunded) {
        const cancelled = await providerApi.cancelOrder(server, providerOrderId(original), { requireConfirmation: true, allowMissing: true });
        if (!cancelled?.success) throw new Error("PROVIDER_CANCEL_FAILED");
      }
      rebuyAttempted = true;
      providerResult = await providerApi.rebuyOrder(server, {
        external_order_id: providerOrderId(original),
        service_code: service?.service_code || original.service_id,
        service_id: original.service_id,
        country: original.country,
        phone: original.phone,
      });
      if (providerResult?.error || !providerResult?.api_order_id || !providerResult?.phone) {
        throw new Error("PROVIDER_REBUY_FAILED");
      }
      if (digits(providerResult.phone) !== digits(original.phone)) throw new Error("PROVIDER_NUMBER_MISMATCH");

      const now = Date.now();
      const order = await wallet.finalizePurchase({
        order_id: rebuyOrderId,
        user_id: String(userId),
        service_id: original.service_id,
        service_name: original.service_name,
        server_name: original.server_name,
        country: original.country,
        phone: original.phone,
        external_order_id: providerResult.api_order_id,
        provider_order_id: providerResult.api_order_id,
        server_id: String(server._id || server.id || ""),
        rebuy_of: original.order_id,
        rebuy_ignored_otps: [...new Set([
          ...wallet.otpHistory(original), String(original.otp || "").trim(),
          ...wallet.otpHistory({ all_otps: original.rebuy_ignored_otps }),
        ].filter(Boolean))],
        cost: amount,
        status: "active",
        otp: "",
        all_otps: [],
        refund_issued: false,
        expires_at: new Date(now + (Number(server.auto_cancel_minutes) || 20) * 60000),
        min_cancel_at: new Date(now + (Number(server.min_cancel_minutes) || 0) * 60000),
        service_image: original.service_image || "",
        service_color: original.service_color || "",
        check_interval: server.check_interval || 3,
        multi_otp_enabled: server.multi_otp_supported || false,
      });
      Promise.resolve().then(() => require("./providerWebhookQueue").retryForOrder(order))
        .catch(error => console.error("[Provider webhook queue] Retry failed:", error.code || error.name));
      return { order, balance: reservedUser.balance };
    } catch (err) {
      const reversed = reserved ? await wallet.reversePurchase(rebuyOrderId).catch(() => false) : true;
      let safeToReleaseClaim = !rebuyAttempted || providerResult?.no_allocation === true || err.message === "DUPLICATE_EXTERNAL_ORDER";
      if (reversed && providerResult?.api_order_id && err.message !== "DUPLICATE_EXTERNAL_ORDER") {
        const cleanup = await providerApi.cancelOrder(server, providerResult.api_order_id,
          { requireConfirmation: true, allowMissing: true }).catch(() => null);
        safeToReleaseClaim = cleanup?.success === true;
      }
      if (claimed && reversed && safeToReleaseClaim) {
        await Order.findOneAndUpdate({ _id: original._id || original.id, rebuy_order_id: rebuyOrderId }, {
          $set: { rebuy_order_id: "" },
        });
      }
      throw err;
    }
  } finally {
    releaseLock(lockId);
  }
}

module.exports = { rebuyCancelledOrder, cancelCompletedOrderForRebuy };
