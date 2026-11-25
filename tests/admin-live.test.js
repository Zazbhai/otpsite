const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const root = path.resolve(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");

function clock() {
  let now = 10000, id = 0;
  const jobs = new Map();
  const timer = (fn, delay, repeat = false) => {
    const key = ++id;
    jobs.set(key, { fn, at: now + delay, delay, repeat });
    return key;
  };
  return {
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, ms) => timer(fn, ms), clearTimeout: key => jobs.delete(key),
    setInterval: (fn, ms) => timer(fn, ms, true), clearInterval: key => jobs.delete(key),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [key, job] = next;
        now = job.at;
        if (job.repeat) job.at += job.delay; else jobs.delete(key);
        job.fn();
        for (let i = 0; i < 6; i++) await Promise.resolve();
      }
      now = end;
    },
  };
}

function events(target = {}) {
  const listeners = new Map();
  target.addEventListener = (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
  };
  target.removeEventListener = (name, fn) => listeners.get(name)?.delete(fn);
  target.fire = (name, event = {}) => listeners.get(name)?.forEach(fn => fn(event));
  return target;
}

function client() {
  const timers = clock();
  const streams = [];
  let modal = false;
  const document = events({ visibilityState: "visible", querySelector: () => modal });
  const window = events();
  class EventSource {
    constructor(url) { events(this); this.url = url; streams.push(this); }
    close() { this.closed = true; }
  }
  vm.runInNewContext(source("public/js/admin-live.js"), { window, document, EventSource, console, ...timers });
  return { window, document, streams, timers, modal: value => { modal = value; } };
}

function server() {
  const timers = clock();
  const module = { exports: {} };
  vm.runInNewContext(source("utils/adminRealtime.js"), { module, exports: module.exports, ...timers });
  function response() {
    return Object.assign(new EventEmitter(), {
      statusCode: 200, headers: {}, messages: [],
      setHeader(key, value) { this.headers[key] = value; }, flushHeaders() {},
      write(value) { this.messages.push(value); return true; },
    });
  }
  return { ...module.exports, timers, response };
}

test("admin stream batches updates and removes closed subscribers", async () => {
  const s = server(), res = s.response();
  s.streamAdminChanges({}, res);
  assert.equal(res.headers["Content-Type"], "text/event-stream");
  s.notifyAdminChange(); s.notifyAdminChange();
  await s.timers.advance(250);
  assert.equal(res.messages.filter(m => m.startsWith("event: change")).length, 1);
  res.emit("close");
  s.notifyAdminChange();
  await s.timers.advance(30000);
  assert.equal(res.messages.length, 2);
});

test("successful website/API writes invalidate admin data; reads and failures do not", async () => {
  const s = server(), stream = s.response();
  s.streamAdminChanges({}, stream);
  const finish = async (path, method, statusCode, query = {}) => {
    const res = s.response(); res.statusCode = statusCode;
    let next = false;
    s.trackAdminChanges({ path, method, query }, res, () => { next = true; });
    assert.equal(next, true); res.emit("finish");
    await s.timers.advance(250);
  };
  await finish("/api/user/orders", "POST", 200);
  await finish("/api/payment/eaglepay/callback", "POST", 200);
  await finish("/api/auth/register", "POST", 201);
  await finish("/api/admin/users/1", "PATCH", 200);
  await finish("/stubs/handler_api.php", "GET", 200, { action: "getNumber" });
  assert.equal(stream.messages.length, 6);
  await finish("/api/user/orders", "POST", 500);
  await finish("/api/admin/analytics", "GET", 200);
  await finish("/stubs/handler_api.php", "GET", 200, { action: "getStatus" });
  await finish("/unrelated", "POST", 200);
  assert.equal(stream.messages.length, 6);
});

test("client coalesces events, serializes refreshes and refreshes after reconnect", async () => {
  const c = client();
  let calls = 0, release;
  c.window.subscribeAdminUpdates(async () => { calls++; await new Promise(resolve => { release = resolve; }); });
  assert.equal(c.streams[0].url, "/api/admin/events");
  c.streams[0].fire("connected"); c.streams[0].fire("change");
  await c.timers.advance(300);
  assert.equal(calls, 1);
  c.streams[0].fire("change");
  await c.timers.advance(5000);
  assert.equal(calls, 1);
  release(); for (let i = 0; i < 8; i++) await Promise.resolve();
  await c.timers.advance(300);
  assert.equal(calls, 2);
  release(); for (let i = 0; i < 8; i++) await Promise.resolve();
  c.streams[0].fire("connected");
  await c.timers.advance(3000);
  assert.equal(calls, 3);
});

test("client defers refreshes while hidden or editing, polls and cleans up", async () => {
  const c = client(); let calls = 0;
  const stop = c.window.subscribeAdminUpdates(async () => { calls++; });
  c.document.visibilityState = "hidden"; c.streams[0].fire("change");
  await c.timers.advance(2000); assert.equal(calls, 0);
  c.document.visibilityState = "visible"; c.modal(true);
  await c.timers.advance(2000); assert.equal(calls, 0);
  c.modal(false);
  await c.timers.advance(1000); assert.equal(calls, 1);
  await c.timers.advance(26000); assert.equal(calls, 2);
  stop(); assert.equal(c.streams[0].closed, true);
  await c.timers.advance(60000); assert.equal(calls, 2);
});

test("back/forward cache navigation reconnects the admin stream", async () => {
  const c = client(); let calls = 0;
  c.window.subscribeAdminUpdates(async () => { calls++; });
  c.window.fire("pagehide", { persisted: true });
  assert.equal(c.streams[0].closed, true);
  c.window.fire("pageshow", { persisted: true });
  assert.equal(c.streams.length, 2);
  await c.timers.advance(300); assert.equal(calls, 1);
});

function adminRouter(dbType, overrides = {}) {
  const distribution = [{ _id: "completed", count: 7 }, { _id: "active", count: 3 }, { _id: "cancelled", count: 2 }];
  const models = {
    User: { countDocuments: async () => 20, aggregate: async () => [], findAll: async () => [] },
    Order: {
      count: async options => options?.where?.status === 'completed' ? 7 : options?.where?.status === 'active' ? 3 : 12,
      aggregate: async pipeline => pipeline[0].$project?.normalizedStatus ? distribution : pipeline[0].$group?.orders ? [{ orders: 12, successful: 7, active: 3 }] : pipeline[0].$match?.createdAt ? [{ orders: 12, successful: 7, active: 3 }] : [],
      findAll: async options => options.group?.[0] === "status"
        ? distribution.map(row => ({ status: row._id, get: () => String(row.count) }))
        : [],
    },
    Transaction: { aggregate: async () => [], findAll: async () => [] },
    ...overrides,
  };
  const authorized = (req, res, next) => next();
  const module = { exports: {} };
  const customRequire = name => {
    if (name.startsWith("../models/")) return models[path.basename(name)] || {};
    if (name === "../middleware/auth") return { adminRequired: authorized };
    if (name === "../utils/db") return { DB_TYPE: dbType };
    if (name === "../utils/analyticsPeriod") return { resolveAnalyticsPeriod: (query = {}) => query.range === "all"
      ? ({ key: "all", date: null, start: null, end: null, timezone: "Asia/Calcutta", label: "All time" })
      : ({ key: "today", date: "2026-11-23", start: new Date(0), end: new Date(86400000), timezone: "Asia/Calcutta", label: "Today" }) };
    if (name === "../utils/adminRealtime") return { streamAdminChanges: (req, res) => res.json({ streamed: true }) };
    if (name.startsWith("../utils/")) return {};
    return require(name);
  };
  vm.runInNewContext(source("routes/admin.js"), { require: customRequire, module, __dirname: path.join(root, "routes"), console, process: { env: {} } });
  return { router: module.exports, authorized };
}

test("admin Deposits includes existing promo credits while preserving search, status and user filters", async () => {
  const sift = require("sift").default;
  const records = [
    { type: "deposit", description: "Payment", status: "completed", user_id: "u1" },
    { type: "bonus", description: "Redeemed promo code: WELCOME", status: "completed", user_id: "u1" },
    { type: "bonus", description: "Referral bonus WELCOME", status: "completed", user_id: "u1" },
    { type: "bonus", description: "Redeemed promo code: WELCOME", status: "completed", user_id: "u2" },
    { type: "bonus", description: "Redeemed promo code: WELCOME", status: "failed", user_id: "u1" },
  ];
  const Transaction = {
    countDocuments: async filter => records.filter(sift(filter)).length,
    find(filter) {
      let offset = 0;
      const query = {
        sort: () => query,
        skip(value) { offset = value; return query; },
        limit: async limit => records.filter(sift(filter)).slice(offset, offset + limit),
      };
      return query;
    },
  };
  const { router } = adminRouter("mongodb", { Transaction });
  const handler = router.stack.find(layer => layer.route?.path === "/transactions").route.stack[0].handle;
  async function run(query) {
    let result;
    await handler({ query }, { json(data) { result = data; }, status() { return this; } });
    return result;
  }
  const deposits = await run({ type: "deposit", status: "completed", user_id: "u1", limit: 1 });
  assert.equal(deposits.total, 2);
  assert.equal(deposits.pages, 2);
  const promoPage = await run({ type: "deposit", status: "completed", user_id: "u1", limit: 1, page: 2 });
  assert.equal(promoPage.transactions[0].description, "Redeemed promo code: WELCOME");
  const search = await run({ type: "deposit", q: "WELCOME", status: "completed", user_id: "u1" });
  assert.equal(search.total, 1);
  assert.equal(search.transactions[0].type, "bonus");
  assert.equal((await run({ type: "bonus" })).total, 4);
});

for (const dbType of ["mongodb", "mysql"]) {
  test(`admin dashboard and analytics deposit totals include promo credits in ${dbType} mode`, async () => {
    const { Op } = require("sequelize");
    const observed = [];
    const Transaction = {
      aggregate: async pipeline => {
        observed.push(pipeline);
        if (pipeline[0].$match?.$or?.some(clause => clause.type === "bonus")) {
          return [{ total: 125, period: 25 }];
        }
        return [];
      },
      findAll: async options => {
        observed.push(options);
        if (options.where?.[Op.or]?.some(clause => clause.type === "bonus")) {
          if (options.group) return [];
          return [{ total: options.where.createdAt ? "25" : "125" }];
        }
        return [];
      },
    };
    const { router } = adminRouter(dbType, { Transaction });
    const route = router.stack.find(layer => layer.route?.path === "/analytics").route;
    let result;
    await route.stack[0].handle({ query: { range: "today" } }, {
      json(data) { result = data; }, status() { return this; },
    });
    assert.equal(result.metrics.totalDeposits, 125);
    assert.equal(result.period.deposits, 25);
    if (dbType === "mysql") {
      assert.ok(observed.some(query => query.where?.[Op.or]?.some(clause => clause.type === "bonus" && clause.description?.[Op.like] === "Redeemed promo code:%")));
    } else {
      assert.ok(observed.some(pipeline => pipeline[0].$match?.$or?.some(clause => clause.type === "bonus" && clause.description?.$regex === "^Redeemed promo code:")));
    }
  });
}

for (const dbType of ["mongodb", "mysql"]) {
  test(`admin dashboard all-time filter returns lifetime orders, users, deposits and revenue in ${dbType} mode`, async () => {
    const { router } = adminRouter(dbType);
    const handler = router.stack.find(layer => layer.route?.path === "/analytics").route.stack[0].handle;
    let result;
    await handler({ query: { range: "all" } }, {
      json(data) { result = data; }, status() { return this; },
    });
    assert.equal(result.period.label, "All time");
    assert.equal(result.period.orders, 12);
    assert.equal(result.period.successfulOrders, 7);
    assert.equal(result.period.users, 20);
    assert.equal(result.period.deposits, result.metrics.totalDeposits);
    assert.equal(result.period.revenue, result.metrics.totalRevenue);
  });

  test(`analytics returns total successful orders in ${dbType} mode`, async () => {
    const { router } = adminRouter(dbType);
    const route = router.stack.find(layer => layer.route?.path === "/analytics");
    let result;
    await route.route.stack[0].handle({}, { json(data) { result = data; }, status() { return this; } });
    assert.equal(result.metrics.successfulOrders, 7);
    assert.equal(result.metrics.totalOrders, 12);
    assert.equal(result.metrics.activeOrders, 3);
    assert.equal(result.metrics.successRate, 7 / 12);
    assert.equal(result.period.label, "Today");
    assert.equal(result.period.successfulOrders, 7);
    assert.equal(result.period.revenue, 0);
  });
}

test("admin event route is behind admin authorization", () => {
  const { router, authorized } = adminRouter("mongodb");
  const authIndex = router.stack.findIndex(layer => layer.handle === authorized);
  const streamIndex = router.stack.findIndex(layer => layer.route?.path === "/events");
  assert.ok(authIndex >= 0 && streamIndex > authIndex);
});

test("modified browser scripts and inline admin scripts parse", () => {
  new vm.Script(source("public/js/admin-live.js"));
  for (const file of ["index", "orders", "users", "transactions", "analytics"]) {
    const html = source(`views/admin/${file}.html`);
    assert.ok(html.includes('/js/admin-live.js?v=1'));
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/src\s*=|application\/ld\+json/.test(match[1])) new vm.Script(match[2], { filename: `${file}.html` });
    }
  }
  assert.match(source("views/admin/index.html"), /<option value="all">All time<\/option>/);
});
