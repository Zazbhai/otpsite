// Optional integration check: install mongodb-memory-server separately, then
// run node --test tests/mongo-wallet.integration.test.js against its local replica set.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");

test("real MongoDB wallet conflicts, refunds and concurrent purchases", { timeout: 180000 }, async t => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ storageEngine: "wiredTiger" }] });
  t.after(async () => { await mongoose.disconnect(); await replica.stop(); });
  process.env.DB_TYPE = "mongodb";
  // Never read production credentials or use the configured application database.
  await mongoose.connect(replica.getUri(), { dbName: "wallet_conflict_validation" });
  const emitter = require.resolve("../utils/realtimeEmitter");
  const previousEmitter = require.cache[emitter];
  require.cache[emitter] = { id: emitter, filename: emitter, loaded: true, exports: { emitToUser() {} } };
  t.after(() => { if (previousEmitter) require.cache[emitter] = previousEmitter; else delete require.cache[emitter]; });
  const User = require("../models/User");
  const Order = require("../models/Order");
  const Transaction = require("../models/Transaction");
  const wallet = require("../utils/wallet");
  await Promise.all([User.init(), Order.init(), Transaction.init()]);
  let serial = 0;
  async function user(balance) {
    const suffix = ++serial;
    return User.create({ username: `testuser${suffix}`, email: `test${suffix}@example.test`, password_hash: "test", balance });
  }
  async function buy(owner, id, amount) {
    await wallet.reservePurchase({ userId: owner._id, orderId: id, amount, description: "test" });
    return wallet.finalizePurchase({ order_id: id, user_id: String(owner._id), service_name: "test",
      server_name: "test-provider", external_order_id: `provider-${id}`, cost: amount, status: "active", otp: "", all_otps: [] });
  }

  await t.test("simultaneous cancellations of several orders refund every purchase once", async () => {
    const owner = await user(20);
    const orders = [];
    for (let i = 0; i < 4; i++) orders.push(await buy(owner, `refund-${i}`, 2));
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) =>
      wallet.refundOrder(orders[index % orders.length]._id, "cancelled", "concurrent cancellation")));
    assert.deepEqual(results.filter(result => result.status === "rejected").map(result => result.reason.message), []);
    assert.equal(results.filter(result => result.value.refunded).length, 4);
    assert.equal((await User.findById(owner._id)).balance, 20);
    assert.equal(await Transaction.countDocuments({ user_id: String(owner._id), type: "refund" }), 4);
    assert.equal(await Order.countDocuments({ user_id: String(owner._id), status: "cancelled" }), 4);
  });

  await t.test("a real write conflict with an incoming OTP prevents a refund", async () => {
    const owner = await user(10), order = await buy(owner, "otp-conflict", 4);
    const original = Order.findOneAndUpdate;
    let conflicted = false, inject = true;
    Order.findOneAndUpdate = async function (filter, update, options) {
      if (inject && options?.session && String(filter._id) === String(order._id) && update.$set?.status === "cancelled") {
        inject = false;
        // Commit an OTP outside the refund's existing transaction snapshot.
        await Order.updateOne({ _id: order._id }, { $set: { otp: "001234", all_otps: ["001234"], status: "completed", refund_issued: true } });
        try { return await original.call(this, filter, update, options); }
        catch (error) { conflicted = error.code === 112; throw error; }
      }
      return original.call(this, filter, update, options);
    };
    let result;
    try { result = await wallet.refundOrder(order._id, "cancelled", "raced with OTP"); }
    finally { Order.findOneAndUpdate = original; }
    assert.equal(conflicted, true);
    assert.equal(result.refunded, false);
    assert.equal((await User.findById(owner._id)).balance, 6);
    assert.equal((await Order.findById(order._id)).otp, "001234");
    assert.equal(await Transaction.countDocuments({ order_id: order.order_id, type: "refund" }), 0);
  });

  await t.test("concurrent reservations cannot spend more than the available balance", async () => {
    const owner = await user(5);
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) =>
      wallet.reservePurchase({ userId: owner._id, orderId: `reserve-${index}`, amount: 3, description: "parallel test" })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.ok(results.filter(result => result.status === "rejected").every(result => result.reason.message === "INSUFFICIENT_BALANCE"));
    assert.equal((await User.findById(owner._id)).balance, 2);
    assert.equal(await Transaction.countDocuments({ user_id: String(owner._id), type: "purchase" }), 1);
  });

  await t.test("saved admin webhook mode survives reload, accepts an authenticated OTP and stops provider polling", async () => {
    const Server = require("../models/Server"), Country = require("../models/Country");
    await Promise.all([Server.init(), Country.init()]);
    const country = await Country.create({ code: "mode-test", name: "Mode test" });
    const server = await Server.create({ name: "Webhook mode integration", country_id: country._id,
      otp_webhook_enabled: false, otp_webhook_secret: "integration-webhook-secret", api_check_status_url: "https://provider.example/status" });
    const owner = await user(10);
    const order = await buy(owner, "webhook-mode", 4);
    await Order.updateOne({ _id: order._id }, { $set: { server_name: server.name, next_check_at: new Date("2099-01-01") } });
    const admin = require("../routes/admin");
    const save = admin.stack.find(layer => layer.route?.path === "/servers/:id" && layer.route.methods.put).route.stack.at(-1).handle;
    const invokeSave = async enabled => {
      let status = 200, result;
      await save({ params: { id: String(server._id) }, body: { country_id: String(country._id), otp_webhook_enabled: enabled } }, {
        status(code) { status = code; return this; }, json(value) { result = value; },
      });
      assert.equal(status, 200, result?.error);
    };
    await invokeSave("true");
    const reloaded = await Server.findById(server._id);
    assert.equal(reloaded.otp_webhook_enabled, true);
    assert.equal(reloaded.otp_webhook_secret, "integration-webhook-secret");
    assert.ok((await Order.findById(order._id)).next_check_at < new Date("2099-01-01"));
    assert.equal((await require("../utils/providerApi").checkStatus(reloaded, order.external_order_id)).webhook_only, true);
    const webhook = require("../routes/providerWebhook").stack[0].route.stack.at(-1).handle;
    let status = 200, result;
    await webhook({ params: { server: String(server._id) }, headers: { authorization: "Bearer integration-webhook-secret" },
      body: { external_order_id: order.external_order_id, otp: "001234" } }, {
      status(code) { status = code; return this; }, json(value) { result = value; },
    });
    assert.equal(status, 200, result?.error);
    assert.equal(result.received, true);
    const received = await Order.findById(order._id);
    assert.equal(received.otp, "001234");
    assert.equal(received.status, "completed");
    assert.equal((await User.findById(owner._id)).balance, 6);
    await invokeSave("false");
    assert.equal((await Server.findById(server._id)).otp_webhook_enabled, false);
  });

  await t.test("real API status and balance calls respond while the provider is still pending", async () => {
    const express = require("express");
    const Server = require("../models/Server"), Service = require("../models/Service");
    await require("../utils/apiQueryIndexes").ensureApiQueryIndexes({ DB_TYPE: "mongodb", models: { User, Order, Service } });
    await Promise.all([Server.init(), Service.init()]);
    const server = await Server.create({ name: "test-provider", slug: "performance", api_get_number_url: "https://provider.example/get",
      api_check_status_url: "https://provider.example/status", otp_webhook_enabled: false });
    await Service.create({ name: "Performance test", service_code: "perf", country_code: "22", price: 1, server_id: server._id });
    const owner = await user(30);
    owner.api_key = "performance-test-key"; await owner.save();
    const order = await buy(owner, "performance-status", 2);
    await Order.updateOne({ _id: order._id }, { $set: { next_check_at: new Date(0) } });
    const provider = require("../utils/providerApi");
    const originalStatus = provider.checkStatus, originalNumber = provider.getNumber;
    let finish, pollStarted = false, pollFinished = false, allocations = 0;
    const waiting = new Promise(resolve => { finish = resolve; });
    provider.checkStatus = async () => { pollStarted = true; const result = await waiting; pollFinished = true; return result; };
    provider.getNumber = async () => {
      const id = ++allocations;
      await new Promise(resolve => setTimeout(resolve, 100));
      return { api_order_id: `delayed-allocation-${id}`, phone: "919000000000" };
    };
    const app = express();
    app.use(require("../utils/apiTiming").trackGatewayTiming);
    app.use("/stubs/handler_api.php", require("../routes/apiGateway"));
    const listener = app.listen(0, "127.0.0.1");
    await new Promise(resolve => listener.once("listening", resolve));
    const base = `http://127.0.0.1:${listener.address().port}/stubs/handler_api.php?api_key=${owner.api_key}`;
    try {
      const started = Date.now();
      const responses = await Promise.all(Array.from({ length: 20 }, async () => {
        const response = await fetch(`${base}&action=getStatus&id=${order.external_order_id}`);
        assert.equal(response.status, 200);
        return response.text();
      }));
      assert.ok(responses.every(body => body === "STATUS_WAIT_CODE"));
      assert.equal(pollStarted, true);
      assert.equal(pollFinished, false);
      assert.ok(Date.now() - started < 2000);
      assert.equal(await (await fetch(`${base}&action=getBalance`)).text(), "ACCESS_BALANCE:28.0000");
      const buysStarted = Date.now();
      const purchases = await Promise.all(Array.from({ length: 8 }, async () =>
        (await fetch(`${base}&action=getNumber&service=perf&country=22`)).text()));
      assert.ok(purchases.every(body => body.startsWith("ACCESS_NUMBER:")), JSON.stringify(purchases));
      assert.equal(new Set(purchases).size, 8);
      assert.ok(Date.now() - buysStarted < 2000);
      const allocated = await fetch(`${base}&action=getNumber&service=perf&country=22`);
      assert.equal(await allocated.text(), "ACCESS_NUMBER:delayed-allocation-9:919000000000");
      assert.match(allocated.headers.get("server-timing"), /provider_getNumber;dur=/);
      assert.equal((await User.findById(owner._id)).balance, 19);
      const plan = await User.find({ api_key: owner.api_key }).explain("executionStats");
      assert.match(JSON.stringify(plan.queryPlanner.winningPlan), /idx_users_api_key/);
    } finally {
      finish({ status: "waiting" });
      await new Promise(resolve => setTimeout(resolve, 50));
      provider.checkStatus = originalStatus; provider.getNumber = originalNumber;
      await new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); });
    }
  });
});
