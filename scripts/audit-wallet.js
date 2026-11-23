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
  const orders = await Order.find({}).sort({ createdAt: -1 }).limit(limit);
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
  const negativeUsers = await User.find({ balance: { $lt: 0 } }).select("_id balance").limit(limit);
  const pendingPurchases = await Transaction.find({ type: "purchase", status: "pending", createdAt: { $lt: new Date(Date.now() - 15 * 60000) } }).limit(limit);
  const report = { generated_at: new Date().toISOString(), orders_checked: orders.length, limit,
    findings, negative_balances: negativeUsers.map(user => ({ user_id: String(user._id), balance: user.balance })),
    pending_purchases: pendingPurchases.map(tx => ({ order_id: tx.order_id, user_id: String(tx.user_id), amount: tx.amount })) };
  const output = path.join(__dirname, "..", "scratch", "wallet-audit.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ orders_checked: orders.length, orders_with_issues: findings.length,
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
