const User = require("../models/User");
const Order = require("../models/Order");
const Transaction = require("../models/Transaction");
const { DB_TYPE, withTransaction } = require("./db");
const { positiveMoney, money } = require("./money");

const optionsFor = session => DB_TYPE === "mysql" ? { transaction: session, lock: true } : { session };
const createTransaction = async (data, options) => DB_TYPE === "mysql"
  ? Transaction.create(data, options)
  : (await Transaction.create([data], options))[0];
const hasOtp = order => !!(order.otp || order.all_otps?.length);
function assertVerifiedPurchase(purchase, cost) {
  if (!purchase || money(purchase.amount) >= 0) throw new Error("PURCHASE_LEDGER_MISSING");
  if (positiveMoney(-Number(purchase.amount)) !== money(cost)) throw new Error("ORDER_COST_MISMATCH");
  // Old MySQL ledger entries were written even when Sequelize silently omitted
  // the balance debit. Their presence alone cannot authorize a new credit.
  if (DB_TYPE === "mysql" && !String(purchase.reference || "").startsWith("PROVIDER-ORDER:")) {
    throw new Error("PURCHASE_DEBIT_UNVERIFIED");
  }
}
function publishDeposit(result) {
  const { emitToUser } = require("./realtimeEmitter");
  // Events describe committed data only. A failed SSE client never changes
  // whether a payment/referral transaction commits.
  try {
    emitToUser(String(result.user._id), "balance", { balance: result.user.balance });
    emitToUser(String(result.user._id), "wallet_update", { balance: result.user.balance });
    if (result.referrer?._id) emitToUser(String(result.referrer._id), "balance", { balance: result.referrer.balance });
  } catch (err) { console.error("[Wallet notification]", err.message); }
  return result;
}

// The database claim, credit and ledger entry commit together. Memory locks
// reduce redundant work but are never part of the financial safety guarantee.
async function refundOrder(orderId, status, description) {
  if (!["cancelled", "expired", "refunded"].includes(status)) throw new Error("INVALID_STATUS");
  return withTransaction(async session => {
    const options = optionsFor(session);
    const current = await Order.findById(orderId, null, options);
    if (!current) throw new Error("ORDER_NOT_FOUND");
    if (current.refund_issued || hasOtp(current) || current.status !== "active") {
      return { refunded: false, order: current };
    }
    if (await Transaction.findOne({ order_id: current.order_id, type: "refund" }, null, options)) {
      return { refunded: false, order: current };
    }
    // Refund only money that was actually charged, to its original owner.
    const purchase = await Transaction.findOne({ order_id: current.order_id, user_id: String(current.user_id), type: "purchase", status: "completed" }, null, options);
    assertVerifiedPurchase(purchase, current.cost);
    const amount = positiveMoney(-Number(purchase.amount));
    const claimed = await Order.findOneAndUpdate(
      { _id: current._id, status: "active", refund_issued: { $ne: true }, otp: { $in: ["", null] } },
      { $set: { status, refund_issued: true } }, { ...options, new: true });
    if (!claimed) return { refunded: false, order: current };
    const user = await User.findOneAndUpdate({ _id: current.user_id }, { $inc: { balance: amount } }, { ...options, new: true });
    if (!user) throw new Error("USER_NOT_FOUND");
    await createTransaction({
      user_id: String(current.user_id), type: "refund", amount,
      balance_after: user.balance, order_id: current.order_id,
      reference: `ORDER-REFUND:${current.order_id}`, description,
    }, options);
    return { refunded: true, order: claimed, newBalance: user.balance };
  });
}

// Claim an existing payment using its primary key and owner, not an untrusted
// caller's account. Failed notifications may later become confirmed payments.
async function creditDeposit({ transactionId, userId, config, description, amount }) {
  return withTransaction(async session => {
    const options = optionsFor(session);
    const claimed = await Transaction.findOneAndUpdate(
      { _id: transactionId, user_id: String(userId), type: "deposit", status: { $in: ["pending", "failed"] } },
      { $set: { status: "completed" } }, { ...options, new: true });
    if (!claimed) throw new Error("ALREADY_CREDITED");
    const base = positiveMoney(amount === undefined ? claimed.amount : amount);
    const { calculateDepositBonus } = require("./paymentBonus");
    const bonus = calculateDepositBonus(base, config);
    const totalCredit = positiveMoney(bonus.totalCredit);
    // Return the state from the atomic credit itself, so simultaneous deposits
    // cannot both claim the first-deposit referral reward.
    const before = await User.findOneAndUpdate({ _id: userId }, {
      $inc: { balance: totalCredit }, $set: { has_deposited: true },
    }, { ...options, new: false });
    if (!before) throw new Error("USER_NOT_FOUND");
    const hadDeposited = before.has_deposited;
    const user = await User.findById(userId, null, options);
    if (!user) throw new Error("USER_NOT_FOUND");
    claimed.amount = totalCredit;
    claimed.balance_after = user.balance;
    claimed.description = description + bonus.bonusDesc;
    await claimed.save(options);
    const { processReferralBonus } = require("./referralBonus");
    const referrer = await processReferralBonus(user, base, hadDeposited, options);
    return { user, referrer, ...bonus, base_amount: base };
  }).then(publishDeposit);
}

// UTR uniqueness is enforced by the existing reference unique index. The
// reservation is written BEFORE credit; two users cannot redeem one receipt.
async function creditReceipt({ reference, userId, amount, config, description, orderNo }) {
  return withTransaction(async session => {
    const options = optionsFor(session);
    const existing = await Transaction.findOne({ reference }, null, options);
    if (existing && (String(existing.user_id) !== String(userId) || existing.status === "completed" || existing.type !== "deposit")) throw new Error("ALREADY_REDEEMED");
    let tx = existing;
    if (!tx && orderNo) {
      tx = await Transaction.findOne({ reference: orderNo, user_id: String(userId), type: "deposit", status: "pending" }, null, options);
      if (!tx) throw new Error("PAYMENT_ORDER_NOT_FOUND");
    }
    if (tx) {
      tx = await Transaction.findOneAndUpdate({ _id: tx._id, status: { $in: ["pending", "failed"] } }, {
        $set: { status: "completed", reference },
      }, { ...options, new: true });
      if (!tx) throw new Error("ALREADY_REDEEMED");
    } else {
      tx = await createTransaction({ user_id: String(userId), type: "deposit", amount: positiveMoney(amount), reference, status: "completed" }, options);
    }
    const base = positiveMoney(amount);
    const bonus = require("./paymentBonus").calculateDepositBonus(base, config);
    const totalCredit = positiveMoney(bonus.totalCredit);
    const before = await User.findOneAndUpdate({ _id: userId }, { $inc: { balance: totalCredit }, $set: { has_deposited: true } }, { ...options, new: false });
    if (!before) throw new Error("USER_NOT_FOUND");
    const hadDeposited = before.has_deposited;
    const user = await User.findById(userId, null, options);
    if (!user) throw new Error("USER_NOT_FOUND");
    tx.amount = totalCredit;
    tx.balance_after = user.balance;
    tx.description = description + bonus.bonusDesc;
    await tx.save(options);
    const referrer = await require("./referralBonus").processReferralBonus(user, base, hadDeposited, options);
    return { user, referrer, ...bonus, base_amount: base };
  }).then(publishDeposit);
}

async function reservePurchase({ userId, orderId, amount, description }) {
  const price = positiveMoney(amount);
  return withTransaction(async session => {
    const options = optionsFor(session);
    const user = await User.findOneAndUpdate({ _id: userId, is_banned: { $ne: true }, balance: { $gte: price } }, {
      $inc: { balance: -price, total_spent: price, total_orders: 1 },
    }, { ...options, new: true });
    if (!user) throw new Error("INSUFFICIENT_BALANCE");
    await createTransaction({ user_id: String(userId), type: "purchase", amount: -price, balance_after: user.balance,
      order_id: orderId, reference: `ORDER-PURCHASE:${orderId}`, status: "pending", description }, options);
    return user;
  });
}

async function finalizePurchase(orderData) {
  try { return await withTransaction(async session => {
    const options = optionsFor(session);
    const providerIdentity = [orderData.server_name, String(orderData.external_order_id)];
    if (orderData.rebuy_of) providerIdentity.push(String(orderData.order_id));
    const providerReference = "PROVIDER-ORDER:" + require("crypto").createHash("sha256")
      .update(JSON.stringify(providerIdentity)).digest("hex");
    const claimed = await Transaction.findOneAndUpdate({ order_id: orderData.order_id, user_id: String(orderData.user_id), type: "purchase", status: "pending" }, {
      $set: { status: "completed", reference: providerReference },
    }, { ...options, new: true });
    if (!claimed) throw new Error("PURCHASE_NOT_RESERVED");
    if (money(orderData.cost) !== -money(claimed.amount)) throw new Error("ORDER_COST_MISMATCH");
    // External IDs are scoped to the provider, not globally across servers.
    const identity = { server_name: orderData.server_name, external_order_id: orderData.external_order_id };
    if (orderData.rebuy_of) {
      const parent = await Order.findOne({ order_id: orderData.rebuy_of, user_id: String(orderData.user_id),
        rebuy_order_id: orderData.order_id }, null, options);
      if (!parent || parent.phone !== orderData.phone || parent.server_name !== orderData.server_name ||
          !(["cancelled", "expired", "refunded"].includes(parent.status) ||
            (parent.status === "completed" && parent.rebuy_cancelled))) throw new Error("ORDER_NOT_REBUYABLE");
      // Retired activations may share a provider ID across a chain of rebuys.
      // Inspect every conflicting activation, rather than only the oldest one.
      const conflict = await Order.findOne({ ...identity, $or: [
        { user_id: { $ne: String(orderData.user_id) } }, { phone: { $ne: orderData.phone } },
        { $and: [{ status: { $nin: ["cancelled", "expired", "refunded"] } }, { rebuy_cancelled: { $ne: true } }] },
      ] }, null, options);
      if (conflict) throw new Error("DUPLICATE_EXTERNAL_ORDER");
    } else if (await Order.findOne(identity, null, options)) throw new Error("DUPLICATE_EXTERNAL_ORDER");
    return DB_TYPE === "mysql" ? Order.create(orderData, options) : (await Order.create([orderData], options))[0];
  }); } catch (err) {
    if (err.code === 11000 || err.name === "SequelizeUniqueConstraintError") throw new Error("DUPLICATE_EXTERNAL_ORDER");
    throw err;
  }
}

async function reversePurchase(orderId) {
  return withTransaction(async session => {
    const options = optionsFor(session);
    const claimed = await Transaction.findOneAndUpdate({ order_id: orderId, type: "purchase", status: "pending" }, {
      $set: { status: "failed" },
    }, { ...options, new: true });
    if (!claimed) return false; // already completed/reversed, including an uncertain commit
    if (await Order.findOne({ order_id: orderId }, null, options)) throw new Error("PURCHASE_ALREADY_FULFILLED");
    const amount = positiveMoney(-Number(claimed.amount));
    const user = await User.findOneAndUpdate({ _id: claimed.user_id }, { $inc: { balance: amount, total_spent: -amount, total_orders: -1 } }, { ...options, new: true });
    if (!user) throw new Error("USER_NOT_FOUND");
    await createTransaction({ user_id: claimed.user_id, type: "refund", amount, balance_after: user.balance,
      order_id: orderId, reference: `ORDER-REFUND:${orderId}`, description: `Reversed failed purchase ${orderId}` }, options);
    return true;
  });
}

async function recoverPendingPurchases() {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000);
  const pending = await Transaction.find({ type: "purchase", status: "pending", createdAt: { $lt: cutoff } }).limit(100);
  for (const tx of pending) {
    try {
      const reversed = await reversePurchase(tx.order_id);
      if (reversed) {
        await Order.findOneAndUpdate({ rebuy_order_id: tx.order_id }, { $set: { rebuy_order_id: "" } });
      }
    }
    catch (err) { console.error("[Purchase recovery]", tx.order_id, err.message); }
  }
}

async function adjustBalance({ userId, amount, description }) {
  const delta = money(amount);
  if (!delta) throw new Error("INVALID_AMOUNT");
  return withTransaction(async session => {
    const options = optionsFor(session);
    const filter = { _id: userId };
    if (delta < 0) filter.balance = { $gte: -delta };
    const user = await User.findOneAndUpdate(filter, {
      $inc: { balance: delta }, ...(delta > 0 ? { $set: { has_deposited: true } } : {}),
    }, { ...options, new: true });
    if (!user) throw new Error(delta < 0 ? "INSUFFICIENT_BALANCE" : "USER_NOT_FOUND");
    await createTransaction({ user_id: String(userId), type: delta > 0 ? "deposit" : "deduction",
      amount: delta, balance_after: user.balance, status: "completed", description }, options);
    return user;
  });
}

async function setBalance(userId, target) {
  const value = money(target);
  if (value < 0) throw new Error("INVALID_AMOUNT");
  return withTransaction(async session => {
    const options = optionsFor(session);
    const previous = await User.findOneAndUpdate({ _id: userId }, { $set: { balance: value } }, { ...options, new: false });
    if (!previous) throw new Error("USER_NOT_FOUND");
    const delta = money(value - Number(previous.balance));
    if (delta) await createTransaction({ user_id: String(userId), type: delta > 0 ? "deposit" : "deduction",
      amount: delta, balance_after: value, description: "Admin set wallet balance", status: "completed" }, options);
    return value;
  });
}

module.exports = { optionsFor, createTransaction, hasOtp, refundOrder, creditDeposit, creditReceipt,
  reservePurchase, finalizePurchase, reversePurchase, recoverPendingPurchases, adjustBalance, setBalance, assertVerifiedPurchase };
