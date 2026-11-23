const { resolveAnalyticsPeriod, DEFAULT_TIMEZONE } = require("./analyticsPeriod");
const { money } = require("./money");

const PAGE_SIZE = 6;
const TABS = {
  all: {},
  success_deposits: { type: "deposit", status: "completed" },
  pending_deposits: { type: "deposit", status: "pending" },
  purchases: { type: { $in: ["purchase", "deduction"] } },
  refunds: { type: "refund" },
};

function userPeriod(query = {}) {
  const range = String(query.range || "all");
  if (range === "all") return { key: "all", label: "All time", timezone: DEFAULT_TIMEZONE };
  if (!["today", "yesterday", "date"].includes(range) || (range === "date" && !query.date)) {
    throw new Error("Invalid analytics date");
  }
  return resolveAnalyticsPeriod({ range, ...(range === "date" ? { date: query.date } : {}) });
}

function userScope(userId, period) {
  return { user_id: String(userId), ...(period.start ? { createdAt: { $gte: period.start, $lt: period.end } } : {}) };
}

async function historyPage(Model, scope, query = {}, kind = "transactions") {
  const offset = Number(query.offset || 0);
  const tab = String(query.tab || "all");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000 || !Object.hasOwn(TABS, tab)) {
    throw new Error("Invalid history page");
  }
  const fields = kind === "orders"
    ? "_id service_name phone cost status createdAt"
    : "_id type status amount balance_after reference order_id description createdAt";
  const rows = await Model.find({ ...scope, ...(kind === "transactions" ? TABS[tab] : {}) })
    .select(fields).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(PAGE_SIZE + 1);
  const items = rows.slice(0, PAGE_SIZE);
  return { items, offset, next_offset: offset + items.length, has_more: rows.length > PAGE_SIZE, page_size: PAGE_SIZE, tab };
}

async function userSummary({ Order, Transaction, DB_TYPE }, scope) {
  let orders, transactions;
  if (DB_TYPE === "mysql") {
    const { Op, fn, col } = require("sequelize");
    const where = { user_id: scope.user_id, ...(scope.createdAt ? {
      createdAt: { [Op.gte]: scope.createdAt.$gte, [Op.lt]: scope.createdAt.$lt },
    } : {}) };
    [orders, transactions] = await Promise.all([
      Order.findAll({ where, attributes: ["status", [fn("COUNT", col("id")), "count"], [fn("SUM", col("cost")), "amount"]], group: ["status"], raw: true }),
      Transaction.findAll({ where, attributes: ["type", "status", [fn("COUNT", col("id")), "count"], [fn("SUM", col("amount")), "amount"]], group: ["type", "status"], raw: true }),
    ]);
  } else {
    [orders, transactions] = await Promise.all([
      Order.aggregate([
        { $match: scope },
        { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$cost" } } },
        { $project: { _id: 0, status: "$_id", count: 1, amount: 1 } },
      ]),
      Transaction.aggregate([
        { $match: scope },
        { $group: { _id: { type: "$type", status: "$status" }, count: { $sum: 1 }, amount: { $sum: "$amount" } } },
        { $project: { _id: 0, type: "$_id.type", status: "$_id.status", count: 1, amount: 1 } },
      ]),
    ]);
  }
  const order_stats = { total_orders: 0, successful_orders: 0, total_revenue: 0 };
  for (const row of orders) {
    order_stats.total_orders += Number(row.count);
    if (row.status === "completed") {
      order_stats.successful_orders += Number(row.count);
      order_stats.total_revenue = money(order_stats.total_revenue + Number(row.amount || 0));
    }
  }
  const deposit_stats = {
    successful_deposits: 0, successful_deposits_count: 0,
    pending_deposits: 0, pending_deposits_count: 0,
    failed_deposits: 0, failed_deposits_count: 0,
    total_spent: 0, total_refunded: 0, total_bonuses: 0,
  };
  const transaction_counts = Object.fromEntries(Object.keys(TABS).map(tab => [tab, 0]));
  for (const row of transactions) {
    const count = Number(row.count), amount = Number(row.amount || 0);
    transaction_counts.all += count;
    if (row.type === "deposit") {
      const key = row.status === "completed" ? "successful" : row.status === "pending" ? "pending" : "failed";
      deposit_stats[`${key}_deposits`] = money(deposit_stats[`${key}_deposits`] + amount);
      deposit_stats[`${key}_deposits_count`] += count;
      if (key === "successful") transaction_counts.success_deposits += count;
      if (key === "pending") transaction_counts.pending_deposits += count;
    }
    if (["purchase", "deduction"].includes(row.type)) {
      transaction_counts.purchases += count;
      if (row.status === "completed") deposit_stats.total_spent = money(deposit_stats.total_spent + Math.abs(amount));
    }
    if (row.type === "refund") {
      transaction_counts.refunds += count;
      if (row.status === "completed") deposit_stats.total_refunded = money(deposit_stats.total_refunded + amount);
    }
    if (row.type === "bonus" && row.status === "completed") deposit_stats.total_bonuses = money(deposit_stats.total_bonuses + amount);
  }
  return { order_stats, deposit_stats, transaction_counts };
}

module.exports = { PAGE_SIZE, userPeriod, userScope, historyPage, userSummary };
