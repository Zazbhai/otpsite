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
  assert.equal(writes.length, 3);
  assert.ok(writes.every(sql => sql.startsWith("CREATE INDEX")));
  assert.ok(writes[0].includes("`api_key`"));
  assert.ok(writes[1].includes("`external_order_id`"));
  assert.ok(writes[2].includes("`price`"));
});
