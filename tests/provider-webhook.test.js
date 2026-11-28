const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const express = require("express");
const rateLimit = require("express-rate-limit");
const root = path.resolve(__dirname, "..");
const source = name => fs.readFileSync(path.join(root, name), "utf8");

function load(file, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(source(file), { module, exports: module.exports, Date,
    console: { info() {}, warn() {}, error() {} },
    require: name => name in dependencies ? dependencies[name] : require(name),
  }, { filename: file });
  return module.exports;
}

async function fixture(t, dbType = "mongodb") {
  const serverConfig = { name: "Provider A", is_active: true, otp_webhook_enabled: true,
    otp_webhook_secret: "webhook-secret", api_key: "provider-api-key" };
  const orders = [], notifications = [];
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some(branch => matches(row, branch));
    if (value && typeof value === "object" && "$ne" in value) return Array.isArray(row[key])
      ? !row[key].includes(value.$ne) : row[key] !== value.$ne;
    return Array.isArray(row[key]) ? row[key].includes(value) : row[key] === value;
  });
  const wrap = row => row && Object.assign({ ...row }, {
    set(fields) { Object.assign(this, fields); },
    async save() { Object.assign(row, this); return this; },
  });
  const Order = {
    async findOne(filter) { return wrap(orders.find(row => matches(row, filter))); },
    async findById(id) { return wrap(orders.find(row => row._id === id)); },
    find(filter) { return { sort: () => ({ limit: async n => orders.filter(row => matches(row, filter)).slice(-n).reverse().map(wrap) }) }; },
    async findOneAndUpdate(filter, update) {
      const row = orders.find(row => matches(row, filter));
      if (!row) return null;
      Object.assign(row, update.$set);
      if (update.$addToSet) row.all_otps.push(update.$addToSet.all_otps);
      return wrap(row);
    },
  };
  const sms = load("utils/orderSms.js", {
    "../models/Order": Order, "../models/User": {}, "../models/Country": {},
    "../models/UserWebhook": { findOne: async () => null },
    "./db": { DB_TYPE: dbType, withTransaction: async fn => fn({}) },
    "./customerWebhook": {}, "./realtimeEmitter": { emitToUser: (...args) => notifications.push(args) },
  });
  const router = load("routes/providerWebhook.js", {
    "../models/Server": { findById: async id => id === "server-a" ? serverConfig : null, findOne: async () => null },
    "../models/Order": Order, "../utils/orderSms": sms,
  });
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf.toString("utf8"); } }));
  let maintenance = false;
  // Execute the production limit and maintenance middleware to verify callbacks
  // continue to work when customer traffic is throttled or buying is paused.
  const main = source("server.js");
  vm.runInNewContext(main.slice(main.indexOf('app.use("/api/", rateLimit({'), main.indexOf("// Database Health Check Middleware")), {
    app, apiRateLimitKey: () => "test-customer",
    rateLimit: options => rateLimit({ ...options, max: 1, validate: false }),
    require: name => name === "./utils/maintenance" ? { isMaintenanceOn: async () => maintenance } : { decodeToken: () => null },
  });
  vm.runInNewContext(main.slice(main.indexOf("// Provider callbacks authenticate"), main.indexOf("// Private operational endpoint")), {
    app, rateLimit, require: () => router,
  });
  app.get("/api/customer-test", (_, res) => res.json({ ok: true }));
  const listener = app.listen(0, "127.0.0.1");
  await new Promise(resolve => listener.once("listening", resolve));
  t.after(() => new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); }));
  const base = `http://127.0.0.1:${listener.address().port}`;
  const send = async (body, headers = { authorization: "Bearer webhook-secret" }, server = "server-a") => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const response = await fetch(`${base}/api/provider/webhook/${server}`, {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw,
    });
    return { status: response.status, body: await response.json() };
  };
  const add = (fields = {}) => {
    const row = { _id: `db-${orders.length}`, order_id: `local-${orders.length}`, external_order_id: `external-${orders.length}`,
      server_name: "Provider A", user_id: "owner", status: "active", otp: "", all_otps: [],
      multi_otp_enabled: false, cost: 4, ...fields };
    orders.push(row);
    return row;
  };
  return { send, add, serverConfig, orders, notifications, base, Order, maintenance: value => { maintenance = value; } };
}

for (const dbType of ["mysql", "mongodb"]) {
  for (const idField of ["order_id", "orderId", "external_order_id"]) {
    test(`${dbType}: provider ID in ${idField} saves the OTP once and acknowledges retries`, async t => {
      const f = await fixture(t, dbType), order = f.add();
      const payload = { [idField]: order.external_order_id, otp: "001234" };
      assert.equal((await f.send(payload)).status, 200);
      assert.equal(order.otp, "001234");
      assert.equal(order.status, "completed");
      assert.equal(order.refund_issued, true);
      assert.deepEqual(Array.from(order.all_otps), ["001234"]);
      const retry = await f.send(payload);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.duplicate, true);
      assert.equal(f.notifications.length, 1);
    });
  }
}

test("SMS Candy HMAC verifies the exact raw body with the configured API key or webhook secret", async t => {
  const f = await fixture(t);
  for (const key of ["provider-api-key", "webhook-secret"]) {
    const order = f.add();
    const body = ` { "orderId": "${order.external_order_id}", "code": "001234", "event": "sms.received" } `;
    const signature = createHmac("sha256", key).update(body).digest("hex");
    assert.equal((await f.send(body + " ", { "x-smscandy-signature": signature })).status, 401);
    assert.equal(order.otp, "");
    const accepted = await f.send(body, { "x-smscandy-signature": signature });
    assert.equal(accepted.status, 200);
    assert.equal(order.otp, "001234");
  }
});

test("missing, incorrect and malformed credentials never save an OTP", async t => {
  const f = await fixture(t), order = f.add();
  for (const headers of [{}, { authorization: "Bearer wrong" }, { "x-smscandy-signature": "bad-signature" },
    { "x-smscandy-signature": "0".repeat(64) }]) {
    const result = await f.send({ orderId: order.external_order_id, code: "001234" }, headers);
    assert.equal(result.status, 401);
    assert.equal(result.body.code, "INVALID_WEBHOOK_AUTH");
  }
  assert.equal(order.otp, "");
  assert.equal(f.notifications.length, 0);
});

test("valid credentials distinguish polling mode and a disabled server from invalid authentication", async t => {
  const f = await fixture(t), order = f.add();
  f.serverConfig.otp_webhook_enabled = false;
  let result = await f.send({ order_id: order.external_order_id, otp: "001234" });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "WEBHOOK_DISABLED");
  f.serverConfig.otp_webhook_enabled = true;
  f.serverConfig.is_active = false;
  result = await f.send({ order_id: order.external_order_id, otp: "001234" });
  assert.equal(result.body.code, "SERVER_DISABLED");
  assert.equal(order.otp, "");
});

test("callbacks remain available during maintenance and after customer API throttling", async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.base}/api/customer-test`)).status, 200);
  assert.equal((await fetch(`${f.base}/api/customer-test`)).status, 429);
  f.maintenance(true);
  const order = f.add();
  assert.equal((await f.send({ orderId: order.external_order_id, otp: "001234" })).status, 200);
  assert.equal(order.status, "completed");
});

test("foreign, ambiguous, mismatched and refunded orders are never updated", async t => {
  const f = await fixture(t);
  const foreign = f.add({ server_name: "Another provider" });
  assert.equal((await f.send({ orderId: foreign.external_order_id, otp: "001234" })).status, 404);
  const first = f.add(), second = f.add({ external_order_id: first.external_order_id });
  assert.equal((await f.send({ orderId: first.external_order_id, otp: "001234" })).status, 409);
  assert.equal((await f.send({ local_order_id: first.order_id, external_order_id: "different", otp: "001234" })).body.code, "ORDER_ID_MISMATCH");
  const refunded = f.add({ status: "refunded" });
  assert.equal((await f.send({ orderId: refunded.external_order_id, otp: "001234" })).status, 404);
  assert.equal((await f.send({ local_order_id: refunded.order_id, otp: "001234" })).body.code, "ORDER_NOT_ACTIVE");
  assert.equal(f.notifications.length, 0);
  assert.equal(second.otp, "");
});

test("multi-OTP callbacks retain every distinct code and ignore the previous rebuy's SMS", async t => {
  const f = await fixture(t), order = f.add({ multi_otp_enabled: true, rebuy_ignored_otps: ["old-code"] });
  assert.equal((await f.send({ orderId: order.external_order_id, code: "old-code" })).body.ignored, true);
  for (const code of ["001234", "005678", "001234"]) {
    assert.equal((await f.send({ orderId: order.external_order_id, code })).status, 200);
  }
  assert.deepEqual(order.all_otps, ["001234", "005678"]);
  assert.equal(order.status, "active");
  assert.equal(f.notifications.length, 2);
});

test("a concurrent refund cannot produce a false acknowledgement for an unsaved OTP", async t => {
  const f = await fixture(t), order = f.add();
  f.Order.findOneAndUpdate = async () => { order.status = "refunded"; return null; };
  const result = await f.send({ orderId: order.external_order_id, otp: "001234" });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "OTP_NOT_SAVED");
  assert.equal(order.otp, "");
  assert.equal(f.notifications.length, 0);
});
