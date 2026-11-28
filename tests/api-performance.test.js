const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(file, dependencies = {}, extra = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), {
    module, Date, console, require: name => name in dependencies ? dependencies[name] : require(name), ...extra,
  });
  return module.exports;
}

test("concurrent API middleware requests share one settings read and invalidation rejects stale cache writes", async () => {
  const pending = [];
  const cache = load("utils/settingsCache.js", { "../models/Setting": { find: () => new Promise(resolve => pending.push(resolve)) } });
  const requests = Array.from({ length: 100 }, () => cache.getCachedSettings());
  assert.equal(pending.length, 1);
  cache.clearSettingsCache();
  const refreshed = cache.getCachedSettings();
  assert.equal(pending.length, 2);
  pending[1]([{ key: "maintenance_mode", value: true }]);
  assert.equal((await refreshed).maintenance_mode, true);
  pending[0]([{ key: "maintenance_mode", value: false }]);
  await Promise.all(requests);
  assert.equal((await cache.getCachedSettings()).maintenance_mode, true);
  assert.equal(pending.length, 2);
});

test("failed settings reads release the shared request so the next request can retry", async () => {
  let calls = 0;
  const cache = load("utils/settingsCache.js", { "../models/Setting": { find: async () => {
    if (++calls === 1) throw new Error("Database unavailable");
    return [{ key: "maintenance_mode", value: false }];
  } } });
  await cache.getCachedSettings();
  assert.equal((await cache.getCachedSettings()).maintenance_mode, false);
  assert.equal(calls, 2);
});

test("service cache evicts old user/search keys, expires entries, and preserves scoped invalidation", () => {
  let now = 0;
  const cache = load("utils/apiCache.js", {}, { Date: class extends Date { static now() { return now; } } });
  for (let i = 0; i < 1000; i++) cache.setToCache(`services_user_${i}`, { user: i });
  assert.equal(cache.getFromCache("services_user_899"), null);
  assert.equal(cache.getFromCache("services_user_900").user, 900);
  assert.equal(cache.getFromCache("services_user_999").user, 999);
  cache.setToCache("countries", ["in"]);
  cache.clearCache("services_");
  assert.equal(cache.getFromCache("services_user_999"), null);
  assert.deepEqual(cache.getFromCache("countries"), ["in"]);
  now = 60000;
  assert.equal(cache.getFromCache("countries"), null);
  cache.setToCache("services_fresh", "new");
  assert.equal(cache.getFromCache("services_fresh"), "new");
  cache.clearCache();
  assert.equal(cache.getFromCache("services_fresh"), null);
});

test("gateway timing identifies the blocked stage without credentials or changing a response", () => {
  let now = 0, timer, cleared = false;
  const logs = [];
  const { trackGatewayTiming } = load("utils/apiTiming.js", {}, {
    Date: class extends Date { static now() { return now; } },
    setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => { cleared = true; },
    console: { warn: (...args) => logs.push(args) },
  });
  const req = { path: "/stubs/handler_api.php", method: "GET", query: { action: "getNumber", api_key: "private-key", id: "private-order" } };
  const headers = {};
  const res = Object.assign(new EventEmitter(), { setHeader: (name, value) => { headers[name] = value; }, writeHead() { this.headersSent = true; return this; } });
  let next = false;
  trackGatewayTiming(req, res, () => { next = true; });
  assert.equal(next, true);
  now = 50; req.apiTiming.mark("provider_getNumber");
  now = 8000; timer();
  const pending = JSON.parse(logs[0][1]);
  assert.equal(pending.outcome, "still_pending");
  assert.equal(pending.stage, "provider_getNumber");
  assert.equal(pending.stages_ms.provider_getNumber, 7950);
  assert.equal(res.headersSent, undefined);
  now = 9000; res.writeHead(200); res.emit("finish"); res.emit("close");
  assert.equal(cleared, true);
  assert.equal(logs.length, 2);
  assert.match(headers["Server-Timing"], /provider_getNumber;dur=8950/);
  assert.ok(headers["X-Request-ID"]);
  assert.doesNotMatch(JSON.stringify(logs), /private-key|private-order|api_key/);
});

test("API lookup index migration is additive and skips existing SQL indexes", async () => {
  const { ensureApiQueryIndexes } = require("../utils/apiQueryIndexes");
  const existing = new Set(), writes = [];
  const sequelize = { query: async (sql, options) => {
    if (options) return existing.has(options.replacements.name) ? [{ INDEX_NAME: options.replacements.name }] : [];
    writes.push(sql);
    existing.add(sql.match(/CREATE INDEX `([^`]+)`/)[1]);
  } };
  await ensureApiQueryIndexes({ DB_TYPE: "mysql", sequelize });
  await ensureApiQueryIndexes({ DB_TYPE: "mysql", sequelize });
  assert.equal(writes.length, 4);
  assert.ok(writes.every(sql => sql.startsWith("CREATE INDEX")));
  assert.ok(writes[0].includes("`api_key`"));
  assert.ok(writes[1].includes("`external_order_id`"));
  assert.ok(writes[2].includes("`price`"));
  assert.match(writes[3], /\(`status`, `next_check_at`, `id`\)/);
});

test("MongoDB watcher index covers status, scheduled time and stable queue ordering", async () => {
  const { ensureApiQueryIndexes } = require("../utils/apiQueryIndexes");
  const writes = [];
  const model = { collection: { createIndex: async (fields, options) => writes.push({ fields, options }) } };
  await ensureApiQueryIndexes({ DB_TYPE: "mongodb", models: { User: model, Order: model, Service: model } });
  const queue = writes.find(write => write.options.name === "idx_orders_due_queue");
  assert.deepEqual(queue.fields, { status: 1, next_check_at: 1, _id: 1 });
});

test("file logging batches bursts and bounds outstanding writes when disk is slow", async () => {
  const jobs = [], writes = [], completions = [];
  const { createBatchedLog } = load("utils/batchedLog.js", {}, {
    setTimeout(callback) { jobs.push(callback); return 1; },
  });
  const append = createBatchedLog((batch, done) => { writes.push(batch); completions.push(done); });
  for (let i = 0; i < 100; i++) append(`request ${i}\n`);
  assert.equal(writes.length, 0);
  assert.equal(jobs.length, 1);
  jobs.shift()();
  assert.equal(writes.length, 1);
  assert.ok(writes[0].includes("request 99\n"));
  for (let i = 0; i < 20000; i++) append("x".repeat(1000) + "\n");
  assert.equal(writes.length, 1, "never append concurrently while disk is blocked");
  assert.equal(jobs.length, 0);
  completions.shift()();
  while (jobs.length) { jobs.shift()(); completions.shift()(); }
  assert.ok(writes.slice(1).every(batch => Buffer.byteLength(batch) <= 64 * 1024));
  assert.ok(writes.reduce((sum, batch) => sum + Buffer.byteLength(batch), 0) < 300 * 1024);
  assert.match(writes.join(""), /Dropped \d+ lines/);
  append("recovered\n"); jobs.shift()(); completions.shift()();
  assert.equal(writes.at(-1), "recovered\n");
});

test("file logging keeps accepting messages after append failures and truncates oversized records", () => {
  const jobs = [], writes = [];
  let failed = false;
  const { createBatchedLog } = load("utils/batchedLog.js", {}, {
    setTimeout(callback) { jobs.push(callback); return 1; },
  });
  const append = createBatchedLog((batch, done) => {
    if (!failed) { failed = true; throw new Error("disk unavailable"); }
    writes.push(batch); done();
  });
  append("first\n"); jobs.shift()();
  append("a".repeat(500000)); jobs.shift()();
  assert.match(writes[0], / \[truncated\]\n$/);
  assert.ok(Buffer.byteLength(writes[0]) < 64 * 1024);
});
