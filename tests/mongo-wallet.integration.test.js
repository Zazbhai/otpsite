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
});
