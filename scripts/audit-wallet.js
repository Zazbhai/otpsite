// Read-only historical audit. Deliberately avoids connectDB(), sync(), migrations
// and provider calls; never attempts to reconstruct or change existing balances.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { sequelize, DB_TYPE } = require("../utils/db");
const Order = require("../models/Order");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const { money } = require("../utils/money");

async function main() {
  if (DB_TYPE === "mysql") await sequelize.authenticate();
  else await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false });
  const limit = Math.min(100000, Math.max(1, Number(process.env.WALLET_AUDIT_LIMIT) || 10000));
  const userId = String(process.env.WALLET_AUDIT_USER_ID || "").trim();
  const user = userId ? await User.findById(userId).select("balance") : null;
  if (userId && !user) throw new Error("AUDIT_USER_NOT_FOUND");
  const scope = userId ? { user_id: userId } : {};
  const orders = await Order.find(scope).sort({ createdAt: -1 }).limit(limit);
  const findings = [];
  for (const order of orders) {
    const transactions = await Transaction.find({ order_id: order.order_id });
    const purchases = transactions.filter(tx => tx.type === "purchase" && Number(tx.amount) < 0);
    const refunds = transactions.filter(tx => tx.type === "refund" && tx.status === "completed");
    const charged = money(purchases.reduce((sum, tx) => sum - Number(tx.amount), 0));
    const refunded = money(refunds.reduce((sum, tx) => sum + Number(tx.amount), 0));
    const issues = [];
    if (!purchases.length) issues.push("missing_purchase_ledger");
    if (DB_TYPE === "mysql" && purchases.some(tx => !String(tx.reference || "").startsWith("PROVIDER-ORDER:"))) issues.push("legacy_debit_requires_verification");
    if (purchases.length > 1) issues.push("multiple_purchase_entries");
    if (refunds.length > 1) issues.push("multiple_refund_entries");
    if (refunded > charged) issues.push("refund_exceeds_recorded_charge");
    if (charged && charged !== money(order.cost)) issues.push("order_cost_mismatch");
    if (refunds.length && (order.otp || order.all_otps?.length)) issues.push("refund_with_otp");
    if (refunds.length && !order.refund_issued) issues.push("refund_flag_missing");
    if (issues.length) findings.push({ order_id: order.order_id, user_id: String(order.user_id), charged, refunded, issues });
  }
  const negativeUsers = userId ? (Number(user.balance) < 0 ? [user] : []) : await User.find({ balance: { $lt: 0 } }).select("_id balance").limit(limit);
  const pendingPurchases = await Transaction.find({ ...scope, type: "purchase", status: "pending", createdAt: { $lt: new Date(Date.now() - 15 * 60000) } }).limit(limit);
  const refundRows = await Transaction.find({ ...scope, type: "refund", status: "completed" }).sort({ createdAt: -1 }).limit(limit);
  const purchaseRows = await Transaction.find({ ...scope, type: "purchase", status: "completed", amount: { $lt: 0 } }).limit(limit);
  const refundsTotal = money(refundRows.reduce((sum, tx) => sum + Number(tx.amount), 0));
  const chargesTotal = money(purchaseRows.reduce((sum, tx) => sum - Number(tx.amount), 0));
  const report = { generated_at: new Date().toISOString(), user_id: userId || null,
    current_balance: user ? money(user.balance) : null, orders_checked: orders.length, limit,
    totals: { completed_purchase_rows: purchaseRows.length, completed_purchase_amount: chargesTotal,
      completed_refund_rows: refundRows.length, completed_refund_amount: refundsTotal },
    recent_refunds: refundRows.map(tx => ({ order_id: tx.order_id, amount: money(tx.amount), createdAt: tx.createdAt })),
    findings, negative_balances: negativeUsers.map(user => ({ user_id: String(user._id), balance: user.balance })),
    pending_purchases: pendingPurchases.map(tx => ({ order_id: tx.order_id, user_id: String(tx.user_id), amount: tx.amount })) };
  const output = path.join(__dirname, "..", "scratch", "wallet-audit.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ user_id: userId || null, current_balance: user ? money(user.balance) : null,
    orders_checked: orders.length, orders_with_issues: findings.length,
    completed_purchase_amount: chargesTotal, completed_refund_amount: refundsTotal,
    refund_rows: refundRows.length,
    negative_balances: negativeUsers.length, stale_reservations: pendingPurchases.length, report: output }));
}
main().catch(err => {
  // Don't print connection strings or credentials from driver error objects.
  console.error("Wallet audit failed:", err.code || err.name);
  process.exitCode = 1;
}).finally(async () => {
  if (sequelize) await sequelize.close();
  else await mongoose.disconnect();
});
