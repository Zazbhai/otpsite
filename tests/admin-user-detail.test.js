const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Op } = require("sequelize");
const details = require("../utils/adminUserDetails");

const userId = "6b00ac253eae57e7a1f9d6cd";
const rows = Array.from({ length: 15 }, (_, i) => ({
  _id: String(i + 1).padStart(2, "0"), user_id: userId,
  createdAt: new Date("2026-11-22T20:00:00Z"),
  type: i < 8 ? "deposit" : "purchase", status: i === 7 ? "pending" : "completed",
  amount: 10, description: i === 0 ? "was pending" : "test",
}));
const calls = [];
function historyModel() {
  return { find(where) {
    const call = { where }; calls.push(call);
    const query = {
      select(fields) { call.fields = fields; return query; },
      sort(sort) { call.sort = sort; return query; },
      skip(offset) { call.offset = offset; return query; },
      limit(limit) {
        call.limit = limit;
        return Promise.resolve(rows.filter(row => row.user_id === where.user_id &&
          (!where.type || (where.type.$in ? where.type.$in.includes(row.type) : row.type === where.type)) &&
          (!where.status || where.status === row.status))
          .sort((a, b) => b._id.localeCompare(a._id)).slice(call.offset, call.offset + limit));
      },
    };
    return query;
  } };
}

test("history returns six rows per request with deterministic order and an exhausted final page", async () => {
  calls.length = 0;
  const model = historyModel(), scope = { user_id: userId };
  const first = await details.historyPage(model, scope, { limit: 5000 });
  const second = await details.historyPage(model, scope, { offset: first.next_offset });
  const third = await details.historyPage(model, scope, { offset: second.next_offset });
  assert.deepEqual([first.items.length, second.items.length, third.items.length], [6, 6, 3]);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(row => row._id)).size, 15);
  assert.deepEqual([first.has_more, second.has_more, third.has_more], [true, true, false]);
  assert.ok(calls.every(call => call.limit === 7 && call.fields.includes("_id")));
  assert.deepEqual(calls[0].sort, { createdAt: -1, _id: -1 });
  await assert.rejects(details.historyPage(model, scope, { offset: -1 }), /Invalid history page/);
  await assert.rejects(details.historyPage(model, scope, { offset: "1.5" }), /Invalid history page/);
  await assert.rejects(details.historyPage(model, scope, { tab: "toString" }), /Invalid history page/);
});

test("transaction tabs query matching records at the database, never descriptions or the loaded page", async () => {
  const model = historyModel(), scope = { user_id: userId };
  const success = await details.historyPage(model, scope, { tab: "success_deposits" });
  assert.equal(success.items.length, 6);
  assert.equal(success.has_more, true);
  const pending = await details.historyPage(model, scope, { tab: "pending_deposits" });
  assert.deepEqual(pending.items.map(row => row._id), ["08"]);
  const foreign = await details.historyPage(model, { user_id: "another-user" });
  assert.equal(foreign.items.length, 0);
});

test("successful deposit history tab includes promo-code credits without counting other bonuses", async () => {
  const sift = require("sift").default;
  const records = [
    { _id: "1", user_id: userId, type: "deposit", status: "completed", description: "bank deposit" },
    { _id: "2", user_id: userId, type: "bonus", status: "completed", description: "Redeemed promo code: SAVE" },
    { _id: "3", user_id: userId, type: "bonus", status: "completed", description: "Referral bonus" },
    { _id: "4", user_id: userId, type: "bonus", status: "pending", description: "Redeemed promo code: LATER" },
  ];
  const model = { find: filter => ({
    select() { return this; }, sort() { return this; }, skip() { return this; },
    limit: async () => records.filter(sift(filter)),
  }) };
  const page = await details.historyPage(model, { user_id: userId }, { tab: "success_deposits" });
  assert.deepEqual(page.items.map(row => row._id), ["1", "2"]);
});

const orderGroups = [
  { status: "completed", count: "13", amount: "65.50" },
  { status: "active", count: "4", amount: "12" },
  { status: "cancelled", count: "3", amount: "10" },
];
const transactionGroups = [
  { type: "deposit", status: "completed", count: "9", amount: "100" },
  { type: "deposit", status: "pending", count: "2", amount: "20" },
  { type: "deposit", status: "failed", count: "1", amount: "7" },
  { type: "bonus", status: "completed", count: "2", amount: "15" },
  { type: "purchase", status: "completed", count: "8", amount: "-60" },
  { type: "purchase", status: "pending", count: "1", amount: "-5" },
  { type: "refund", status: "completed", count: "3", amount: "10" },
  { type: "deduction", status: "failed", count: "1", amount: "-15" },
];
const promoGroups = [{ status: "completed", count: "2", amount: "30" }];

for (const DB_TYPE of ["mongodb", "mysql"]) {
  test(`${DB_TYPE}: summaries use grouped queries, preserve user/date boundaries and exclude deposits from revenue`, async () => {
    const queries = [];
    const model = groups => ({
      aggregate: async pipeline => {
        queries.push(pipeline);
        if (pipeline.some(stage => stage.$match?.description)) return promoGroups;
        if (pipeline.some(stage => stage.$group?._id === null)) return [{ amount: 160 }];
        return groups;
      },
      findAll: async options => {
        queries.push(options);
        if (options.where?.description) return promoGroups;
        if (options.attributes?.length === 1) return [{ amount: "160" }];
        return groups;
      },
      find() { throw new Error("Summary must not load individual histories"); },
    });
    const period = details.userPeriod({ range: "date", date: "2026-11-23" });
    const scope = details.userScope(userId, period);
    assert.equal(scope.createdAt.$gte.toISOString(), "2026-11-22T18:30:00.000Z");
    assert.equal(scope.createdAt.$lt.toISOString(), "2026-11-23T18:30:00.000Z");
    const result = await details.userSummary({ DB_TYPE, Order: model(orderGroups), Transaction: model(transactionGroups) }, scope);
    assert.deepEqual(result.order_stats, { total_orders: 20, successful_orders: 13, total_revenue: 65.5 });
    assert.equal(result.deposit_stats.successful_deposits, 130);
    assert.equal(result.deposit_stats.successful_deposits_count, 11);
    assert.equal(result.deposit_stats.total_successful_deposits, 160);
    assert.equal(result.deposit_stats.total_spent, 60);
    assert.equal(result.transaction_counts.all, 27);
    assert.equal(result.transaction_counts.purchases, 10);
    if (DB_TYPE === "mysql") {
      assert.deepEqual(queries[0].group, ["status"]);
      assert.deepEqual(queries[1].group, ["type", "status"]);
      assert.equal(queries[0].where.user_id, userId);
      assert.equal(queries[0].where.createdAt[Op.gte], period.start);
      assert.equal(queries[0].where.createdAt[Op.lt], period.end);
    } else {
      assert.deepEqual(queries[0][0].$match, scope);
      assert.deepEqual(queries[1][0].$match, scope);
      assert.ok(queries.every(pipeline => pipeline.some(stage => stage.$group)));
    }
  });
}

test("periods support all time, today, yesterday and valid explicit dates", () => {
  assert.deepEqual(details.userScope(userId, details.userPeriod()), { user_id: userId });
  const today = details.userPeriod({ range: "today", date: "2000-01-01" });
  const yesterday = details.userPeriod({ range: "yesterday" });
  assert.equal(today.start - yesterday.start, 86400000);
  assert.throws(() => details.userPeriod({ range: "date", date: "2026-02-30" }), /Invalid analytics date/);
  assert.throws(() => details.userPeriod({ range: "date" }), /Invalid analytics date/);
  assert.throws(() => details.userPeriod({ range: "unknown" }), /Invalid analytics date/);
});

function browser(get) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: id === "user-period" ? "all" : "", style: {}, classList: { add() {}, remove() {} },
      innerHTML: "", textContent: "", hidden: false,
    });
    return elements.get(id);
  }
  const context = vm.createContext({
    window: { location: { pathname: `/admin/users/${userId}` } },
    document: { getElementById: element, querySelectorAll: () => [] },
    requireAdmin: async () => false, API: { get }, URLSearchParams, Intl, Date, console,
    fmtMoney: amount => Number(amount).toFixed(2), userAvatar: () => "avatar", toast() {},
  });
  const html = fs.readFileSync(path.join(__dirname, "../views/admin/user-detail.html"), "utf8");
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/js/main.js"), "utf8").split("const API =")[0], context);
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/src\s*=/.test(script[1])) vm.runInContext(script[2], context);
  }
  return { context, element, run: code => vm.runInContext(code, context) };
}

function profile() {
  return {
    user: { _id: userId, username: "test", discounts: [], balance: 10 },
    recent_transactions: rows.slice(0, 6), recent_orders: [],
    transactions_pagination: { has_more: true, next_offset: 6 }, orders_pagination: { has_more: false, next_offset: 0 },
    period: { label: "All time", timezone: "Asia/Calcutta" },
    order_stats: { total_orders: 20, successful_orders: 13, total_revenue: 65.5 },
    deposit_stats: { successful_deposits: 130, successful_deposits_count: 11, total_successful_deposits: 160 },
    transaction_counts: { all: 27, success_deposits: 9, pending_deposits: 2, purchases: 10, refunds: 3 },
  };
}

test("browser loads six initially, appends the next six, and switches tabs using a new database request", async () => {
  const urls = [];
  const page = browser(async url => {
    urls.push(url);
    return url.includes("/transactions?")
      ? { items: rows.slice(6, 12), has_more: false, next_offset: 12 }
      : profile();
  });
  await page.run("loadUser()");
  assert.ok(!urls[0].includes("5000"));
  assert.equal(page.element("count-all").textContent, 27);
  assert.equal(page.element("u-successful-orders").textContent, 13);
  assert.equal(page.element("u-revenue").textContent, "65.50");
  assert.equal(page.element("u-success-deposits").textContent, "130.00");
  assert.equal(page.element("u-total-deposits").textContent, "160.00");
  assert.equal(page.element("tx-load-more").hidden, false);
  await page.run("loadTransactions(true)");
  assert.ok(urls[1].includes("offset=6"));
  assert.equal(page.run("allUserTransactions.length"), 12);
  assert.equal(page.element("tx-load-more").hidden, true);
  page.run("setTxTab('pending_deposits')");
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(urls[2].includes("tab=pending_deposits"));
  assert.ok(urls[2].includes("offset=0"));
});

test("browser discards old tab and date responses arriving after a newer request", async () => {
  const pending = [];
  const page = browser(url => new Promise(resolve => pending.push({ url, resolve })));
  const oldProfile = page.run("loadUser()");
  page.element("user-period").value = "today";
  const newProfile = page.run("loadUser()");
  pending[1].resolve({ ...profile(), period: { label: "Today", timezone: "Asia/Calcutta" } });
  await newProfile;
  pending[0].resolve(profile()); await oldProfile;
  assert.ok(page.element("user-period-label").textContent.startsWith("Today"));
  const all = page.run("loadTransactions()");
  page.run("currentTxTab = 'refunds'");
  const refunds = page.run("loadTransactions()");
  pending[3].resolve({ items: [rows[12]], has_more: false }); await refunds;
  pending[2].resolve({ items: rows.slice(0, 6), has_more: true }); await all;
  assert.equal(page.run("allUserTransactions.length"), 1);
  assert.equal(page.element("tx-load-more").hidden, true);
});

test("admin detail and history routes expose six-row pages and grouped metrics without full-history reads", async () => {
  const historyCalls = [];
  const pageModel = rowsToReturn => ({
    find(where) {
      const call = { where }; historyCalls.push(call);
      const query = {
        select(fields) { call.fields = fields; return query; },
        sort(value) { call.sort = value; return query; },
        skip(value) { call.offset = value; return query; },
        limit(value) { call.limit = value; return Promise.resolve(rowsToReturn(value, call.offset || 0)); },
      };
      return query;
    },
    aggregate: async pipeline => pipeline.some(stage => stage.$group?._id === "$status") ? orderGroups : transactionGroups,
  });
  const models = {
    User: { findById: () => ({ select: async () => ({ _id: userId, username: "test", toObject() { return { _id: userId, username: "test" }; } }) }) },
    Order: pageModel((limit, offset) => rows.slice(offset, offset + limit)),
    Transaction: pageModel((limit, offset) => rows.slice(offset, offset + limit)),
  };
  const module = { exports: {} };
  const customRequire = name => {
    if (name.startsWith("../models/")) return models[path.basename(name)];
    if (name === "../middleware/auth") return { adminRequired: (_req, _res, next) => next() };
    if (name === "../utils/db") return { DB_TYPE: "mongodb" };
    if (name === "../utils/adminUserDetails") return details;
    if (name === "../utils/adminRealtime") return { streamAdminChanges() {} };
    if (name === "../utils/analyticsPeriod") return { resolveAnalyticsPeriod: details.userPeriod };
    if (name.startsWith("../utils/")) return new Proxy({}, { get: () => async () => {} });
    return require(name);
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../routes/admin.js"), "utf8"), {
    require: customRequire, module, __dirname: path.join(__dirname, "../routes"), console, process: { env: {} },
  });
  const router = module.exports;
  const getRoute = path => router.stack.find(layer => layer.route?.path === path).route.stack[0].handle;
  async function invoke(handler, req) {
    const result = { status: 200 };
    const res = { status(code) { result.status = code; return this; }, json(data) { result.data = data; return this; } };
    await handler(req, res);
    return result;
  }
  const detail = await invoke(getRoute("/users/:id"), { params: { id: userId }, query: { range: "date", date: "2026-11-23" } });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.recent_orders.length, 6);
  assert.equal(detail.data.recent_transactions.length, 6);
  assert.equal(detail.data.order_stats.successful_orders, 13);
  assert.equal(detail.data.order_stats.total_revenue, 65.5);
  assert.equal(detail.data.orders_pagination.has_more, true);
  assert.equal(detail.data.transactions_pagination.has_more, true);
  assert.ok(historyCalls.every(call => call.limit === 7));
  historyCalls.length = 0;
  const page = await invoke(getRoute("/users/:id/:history(transactions|orders)"), {
    params: { id: userId, history: "transactions" }, query: { range: "date", date: "2026-11-23", tab: "purchases", offset: "6" },
  });
  assert.equal(page.status, 200);
  assert.equal(page.data.offset, 6);
  assert.equal(page.data.items.length, 6);
  assert.deepEqual(page.data.items.map(row => row._id), ["07", "08", "09", "10", "11", "12"]);
  assert.deepEqual(historyCalls[0].where.type.$in, ["purchase", "deduction"]);
  assert.equal(historyCalls[0].where.createdAt.$gte.toISOString(), "2026-11-22T18:30:00.000Z");
  assert.equal(historyCalls[0].where.createdAt.$lt.toISOString(), "2026-11-23T18:30:00.000Z");
});
