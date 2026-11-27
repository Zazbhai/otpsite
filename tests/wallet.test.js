const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { Sequelize, DataTypes, Op } = require("sequelize");
const { money, positiveMoney, decimalField, roundMongoWalletIncrement } = require("../utils/money");
const { calculateUserPrice } = require("../utils/pricing");
const root = path.resolve(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");

function moduleFrom(file, dependencies, extra = {}) {
  const module = { exports: {} };
  vm.runInNewContext(source(file), {
    module, exports: module.exports, require: name => {
      if (name in dependencies) return dependencies[name];
      if (name.startsWith(".")) return require(path.resolve(path.dirname(path.join(root, file)), name));
      return require(name);
    }, console, Date, setTimeout, clearTimeout, __dirname: path.dirname(path.join(root, file)), ...extra,
  }, { filename: file });
  return module.exports;
}

// Real Sequelize instance.update/save code, with only the transport replaced.
// The old shim returns an updated in-memory balance but sends no UPDATE for it.
async function mysqlFixture() {
  const module = { exports: {} };
  const code = source("utils/db.js").split("// Global Logger Redirection")[0] +
    "\nmodule.exports = { sequelize, applyMongooseShims };";
  vm.runInNewContext(code, {
    module, process: { env: { DB_TYPE: "mysql" } }, console,
    require: name => name === "dotenv" ? { config() {} } : name === "./money" ? require("../utils/money") : require(name),
  });
  const { sequelize, applyMongooseShims } = module.exports;
  let row = { id: 1, balance: "10.0000", total_orders: 0, has_deposited: false };
  const updates = [], reads = [];
  const User = sequelize.define("WalletShimTest", {
    balance: decimalField(DataTypes, "balance"), total_orders: DataTypes.INTEGER, has_deposited: DataTypes.BOOLEAN,
  }, { timestamps: false });
  User.findOne = async options => {
    reads.push(options);
    const enough = options.where.balance?.[Op.gte];
    if (enough != null && Number(row.balance) < enough) return null;
    return User.build({ ...row }, { isNewRecord: false, raw: true });
  };
  sequelize.getQueryInterface().update = async (instance, table, values, where, options) => {
    updates.push({ values, options });
    row = { ...row, ...values };
    return [instance, 1];
  };
  let tail = Promise.resolve(), transactionCount = 0;
  sequelize.transaction = callback => {
    const result = tail.then(() => { transactionCount++; return callback({ LOCK: { UPDATE: "UPDATE" } }); });
    tail = result.catch(() => {});
    return result;
  };
  applyMongooseShims(User);
  return { User, row: () => row, updates, reads, transactionCount: () => transactionCount, sequelize };
}

test("MySQL $inc is persisted by real Sequelize save, including combined $set", async () => {
  const f = await mysqlFixture();
  const purchased = await f.User.findOneAndUpdate({ _id: 1, balance: { $gte: 6 } }, {
    $inc: { balance: -6, total_orders: 1 }, $set: { has_deposited: true },
  }, { new: true });
  assert.equal(purchased.balance, 4);
  assert.equal(Number(f.row().balance), 4);
  assert.equal(f.row().total_orders, 1);
  assert.equal(f.row().has_deposited, true);
  assert.equal(f.reads[0].lock, "UPDATE");
  assert.equal(f.transactionCount(), 1);
  assert.equal(await f.User.findOneAndUpdate({ _id: 1, balance: { $gte: 6 } }, { $inc: { balance: -6 } }), null);
  await f.User.updateOne({ _id: 1 }, { $inc: { balance: 2 }, $set: { has_deposited: false } });
  assert.equal(Number(f.row().balance), 6);
  assert.equal(f.row().has_deposited, false);
});

test("concurrent MySQL deductions persist once and stop at insufficient funds", async () => {
  const f = await mysqlFixture();
  const results = await Promise.all(Array.from({ length: 20 }, () =>
    f.User.findOneAndUpdate({ _id: 1, balance: { $gte: 3 } }, { $inc: { balance: -3 } }, { new: true })));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(Number(f.row().balance), 1);
});

test("MySQL preserves embedded transaction/lock and supports returning previous values", async () => {
  const f = await mysqlFixture();
  const transaction = { LOCK: { UPDATE: "UPDATE" } };
  await f.User.findOne({ where: { id: 1 }, transaction, lock: "UPDATE" });
  assert.equal(f.reads[0].transaction, transaction);
  assert.equal(f.reads[0].lock, "UPDATE");
  const before = await f.User.findOneAndUpdate({ _id: 1 }, { $inc: { balance: 5 } }, { transaction, new: false });
  assert.equal(before.balance, 10);
  assert.equal(Number(f.row().balance), 15);
});

function walletFixture(dbType = "mysql") {
  const tables = { users: [{ _id: "u1", balance: 10, total_orders: 0, total_spent: 0, has_deposited: false }], orders: [], transactions: [] };
  let tail = Promise.resolve(), failLedger = false;
  const bonuses = [];
  const matches = (row, query) => Object.entries(query).every(([key, value]) => {
    if (key === "$or") return value.some(q => matches(row, q));
    if (key === "$and") return value.every(q => matches(row, q));
    const current = row[key];
    if (value && typeof value === "object" && !(value instanceof Date)) {
      return Object.entries(value).every(([op, target]) => {
        if (op === "$gte") return current >= target;
        if (op === "$lte") return current <= target;
        if (op === "$lt") return new Date(current) < target;
        if (op === "$ne") return current !== target;
        if (op === "$in") return target.includes(current);
        if (op === "$nin") return !target.includes(current);
        throw new Error("Unsupported test operator " + op);
      });
    }
    return value === null ? current == null : current === value;
  });
  function model(name) {
    const wrap = row => row && Object.assign(structuredClone(row), {
      async save() {
        const plain = Object.fromEntries(Object.entries(this).filter(([, v]) => typeof v !== "function"));
        Object.assign(tables[name].find(r => r._id === this._id), plain);
        return this;
      },
    });
    return {
      async findById(id) { return wrap(tables[name].find(r => String(r._id) === String(id))); },
      async findOne(query) { return wrap(tables[name].find(r => matches(r, query))); },
      find(query) { return { limit: async n => tables[name].filter(r => matches(r, query)).slice(0, n).map(wrap) }; },
      async findOneAndUpdate(query, update, options = {}) {
        const row = tables[name].find(r => matches(r, query));
        if (!row) return null;
        const before = wrap(row);
        if (update.$set?.reference && tables[name].some(r => r !== row && r.reference === update.$set.reference)) {
          throw Object.assign(new Error("Duplicate reference"), { code: 11000 });
        }
        for (const [key, value] of Object.entries(update.$inc || {})) row[key] = money(Number(row[key] || 0) + value);
        Object.assign(row, update.$set);
        return options.new === false ? before : wrap(row);
      },
      async create(data) {
        if (Array.isArray(data)) return Promise.all(data.map(d => this.create(d)));
        if (name === "transactions" && failLedger) throw new Error("ledger unavailable");
        if (data.reference && tables[name].some(r => r.reference === data.reference)) throw Object.assign(new Error("Duplicate reference"), { code: 11000 });
        const row = { _id: `${name}-${tables[name].length + 1}`, status: "completed", createdAt: new Date(), ...data };
        tables[name].push(row);
        return wrap(row);
      },
    };
  }
  const db = { DB_TYPE: dbType, withTransaction(callback) {
    const result = tail.then(async () => {
      const snapshot = structuredClone(tables);
      try { return await callback({ LOCK: { UPDATE: "UPDATE" } }); }
      catch (err) { Object.assign(tables, snapshot); throw err; }
    });
    tail = result.catch(() => {});
    return result;
  } };
  const models = { User: model("users"), Order: model("orders"), Transaction: model("transactions") };
  const balanceEvents = [];
  const wallet = moduleFrom("utils/wallet.js", {
    "../models/User": models.User, "../models/Order": models.Order, "../models/Transaction": models.Transaction,
    "./db": db, "./referralBonus": { processReferralBonus: async (user, base, had) => bonuses.push({ base, had }) },
    "./realtimeEmitter": { emitToUser(userId, event, payload) { balanceEvents.push({ userId, event, payload }); } },
  });
  return { wallet, tables, models, db, bonuses, balanceEvents, failLedger(value) { failLedger = value; } };
}

for (const dbType of ["mysql", "mongodb"]) {
  test(`${dbType}: reservations reject insufficient funds; rollback is idempotent and recoverable`, async () => {
    const f = walletFixture(dbType);
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => f.wallet.reservePurchase({ userId: "u1", orderId: "o" + i, amount: 6, description: "test" })));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(f.tables.users[0].balance, 4);
    await Promise.all([f.wallet.reversePurchase("o0"), f.wallet.reversePurchase("o0")]);
    assert.equal(f.tables.users[0].balance, 10);
    assert.equal(f.tables.transactions.filter(t => t.type === "refund").length, 1);
    assert.equal(f.tables.users[0].total_orders, 0);
    assert.ok(f.balanceEvents.some(event => event.event === "balance" && event.payload.balance === 10));
    await f.wallet.reservePurchase({ userId: "u1", orderId: "crash", amount: 2, description: "test" });
    f.tables.transactions.find(t => t.order_id === "crash").createdAt = new Date(0);
    await f.wallet.recoverPendingPurchases();
    assert.equal(f.tables.users[0].balance, 10);
  });

  test(`${dbType}: concurrent refund entry points credit the original debit once`, async () => {
    const f = walletFixture(dbType);
    await f.wallet.reservePurchase({ userId: "u1", orderId: "o1", amount: 4, description: "test" });
    const order = await f.wallet.finalizePurchase({ order_id: "o1", user_id: "u1", cost: 4,
      server_name: "server", external_order_id: "provider1", status: "active", otp: "", all_otps: [], refund_issued: false });
    assert.equal(await f.wallet.reversePurchase("o1"), false);
    const results = await Promise.all(["cancelled", "expired", "refunded"].map(status => f.wallet.refundOrder(order._id, status, "test")));
    assert.equal(results.filter(r => r.refunded).length, 1);
    assert.equal(f.tables.users[0].balance, 10);
    assert.equal(f.tables.transactions.filter(t => t.type === "refund").length, 1);
  });

  test(`${dbType}: refund rejects OTP, terminal orders, missing purchase and altered cost`, async () => {
    const f = walletFixture(dbType);
    for (const [id, extra] of [["otp", { all_otps: ["1234"] }], ["terminal", { status: "cancelled" }], ["missing", {}], ["changed", { cost: 8 }]]) {
      f.tables.orders.push({ _id: id, order_id: id, user_id: "u1", cost: 4, status: "active", otp: "", ...extra });
    }
    f.tables.transactions.push({ _id: "p", order_id: "changed", user_id: "u1", type: "purchase", amount: -4, status: "completed" });
    assert.equal((await f.wallet.refundOrder("otp", "expired", "test")).refunded, false);
    assert.equal((await f.wallet.refundOrder("terminal", "expired", "test")).refunded, false);
    await assert.rejects(f.wallet.refundOrder("missing", "expired", "test"), /PURCHASE_LEDGER_MISSING/);
    await assert.rejects(f.wallet.refundOrder("changed", "expired", "test"), /ORDER_COST_MISMATCH/);
    assert.equal(f.tables.users[0].balance, 10);
  });

  test(`${dbType}: webhook/verify/approval replay credits once, owner is enforced`, async () => {
    const f = walletFixture(dbType);
    const tx = await f.models.Transaction.create({ user_id: "u1", type: "deposit", status: "pending", amount: 5, reference: "pay" });
    await assert.rejects(f.wallet.creditDeposit({ transactionId: tx._id, userId: "attacker", config: {}, description: "test" }), /ALREADY_CREDITED/);
    const calls = Array.from({ length: 12 }, () => f.wallet.creditDeposit({ transactionId: tx._id, userId: "u1", config: { bonus_enabled: true, bonus_value: 10 }, description: "test" }));
    assert.equal((await Promise.allSettled(calls)).filter(r => r.status === "fulfilled").length, 1);
    assert.equal(f.tables.users[0].balance, 15.5);
    assert.equal(f.tables.transactions[0].amount, 5.5);
    assert.equal(f.bonuses.length, 1);
    assert.equal(f.bonuses[0].had, false);
  });

  test(`${dbType}: same UTR cannot credit two users or be replayed via another pending order`, async () => {
    const f = walletFixture(dbType);
    f.tables.users.push({ _id: "u2", balance: 0 });
    await f.models.Transaction.create({ user_id: "u1", type: "deposit", status: "pending", amount: 5, reference: "order1" });
    const calls = ["u1", "u2"].map(userId => f.wallet.creditReceipt({ reference: "UTR123", userId, amount: 5, config: {}, description: "test", ...(userId === "u1" ? { orderNo: "order1" } : {}) }));
    assert.equal((await Promise.allSettled(calls)).filter(r => r.status === "fulfilled").length, 1);
    assert.equal(f.tables.users.reduce((sum, user) => sum + user.balance, 0), 15);
    await assert.rejects(f.wallet.creditReceipt({ reference: "UTR123", userId: "u1", amount: 5, config: {}, description: "test" }), /ALREADY_REDEEMED/);
  });

  test(`${dbType}: ledger failure rolls back debit, refund and admin adjustment`, async () => {
    const f = walletFixture(dbType);
    f.failLedger(true);
    await assert.rejects(f.wallet.reservePurchase({ userId: "u1", orderId: "bad", amount: 4, description: "test" }), /ledger unavailable/);
    await assert.rejects(f.wallet.adjustBalance({ userId: "u1", amount: 5, description: "test" }), /ledger unavailable/);
    assert.equal(f.tables.users[0].balance, 10);
    f.failLedger(false);
    await f.wallet.reservePurchase({ userId: "u1", orderId: "o", amount: 4, description: "test" });
    const order = await f.wallet.finalizePurchase({ order_id: "o", user_id: "u1", cost: 4, server_name: "s", external_order_id: "1", status: "active", otp: "" });
    f.failLedger(true);
    await assert.rejects(f.wallet.refundOrder(order._id, "expired", "test"), /ledger unavailable/);
    assert.equal(f.tables.users[0].balance, 6);
    assert.equal(f.tables.orders[0].status, "active");
    assert.equal(f.tables.orders[0].refund_issued, undefined);
  });

  test(`${dbType}: admin deduction has a balance floor and exact changes have ledger entries`, async () => {
    const f = walletFixture(dbType);
    await assert.rejects(f.wallet.adjustBalance({ userId: "u1", amount: -11, description: "test" }), /INSUFFICIENT_BALANCE/);
    await f.wallet.setBalance("u1", 2.1234);
    assert.equal(f.tables.users[0].balance, 2.1234);
    assert.equal(f.tables.transactions[0].amount, -7.8766);
  });

  test(`${dbType}: duplicate provider ID is rejected, scoped to its server, and failed finalization can be reversed`, async () => {
    const f = walletFixture(dbType);
    const data = { user_id: "u1", cost: 2, server_name: "s1", external_order_id: "external", status: "active", otp: "" };
    for (const orderId of ["a", "b", "c"]) await f.wallet.reservePurchase({ userId: "u1", orderId, amount: 2, description: "test" });
    await f.wallet.finalizePurchase({ ...data, order_id: "a" });
    await assert.rejects(f.wallet.finalizePurchase({ ...data, order_id: "b" }), /DUPLICATE_EXTERNAL_ORDER/);
    await f.wallet.reversePurchase("b");
    await f.wallet.finalizePurchase({ ...data, server_name: "s2", order_id: "c" });
    assert.equal(f.tables.orders.length, 2);
    assert.equal(f.tables.users[0].balance, 6);
  });

  test(`${dbType}: provider ID can be rebought through retired ancestors but a live duplicate is rejected`, async () => {
    const f = walletFixture(dbType);
    const data = { user_id: "u1", cost: 2, phone: "+919876543210", server_name: "s", external_order_id: "same", status: "active", otp: "" };
    f.tables.orders.push({ ...data, _id: "old", order_id: "old", status: "completed", otp: "1234", all_otps: ["1234"], refund_issued: true, rebuy_cancelled: true, rebuy_order_id: "next" });
    await f.wallet.reservePurchase({ userId: "u1", orderId: "next", amount: 2, description: "rebuy" });
    await f.wallet.finalizePurchase({ ...data, order_id: "next", rebuy_of: "old" });
    assert.equal(f.tables.users[0].balance, 8);
    assert.equal((await f.wallet.refundOrder("old", "cancelled", "test")).refunded, false);
    Object.assign(f.tables.orders[1], { status: "completed", otp: "5678", rebuy_cancelled: true, rebuy_order_id: "third" });
    await f.wallet.reservePurchase({ userId: "u1", orderId: "third", amount: 2, description: "rebuy" });
    await f.wallet.finalizePurchase({ ...data, order_id: "third", rebuy_of: "next" });
    assert.equal(f.tables.users[0].balance, 6);
    f.tables.orders[1].rebuy_order_id = "bad";
    await f.wallet.reservePurchase({ userId: "u1", orderId: "bad", amount: 2, description: "rebuy" });
    await assert.rejects(f.wallet.finalizePurchase({ ...data, order_id: "bad", rebuy_of: "next" }), /DUPLICATE_EXTERNAL_ORDER/);
    await f.wallet.reversePurchase("bad");
    assert.equal(f.tables.users[0].balance, 6);
    assert.equal(f.tables.orders.length, 3);
  });

  test(`${dbType}: legacy purchase entries are handled according to whether the old debit was reliable`, async () => {
    const f = walletFixture(dbType);
    f.tables.orders.push({ _id: "old", order_id: "old", user_id: "u1", cost: 4, status: "active", otp: "" });
    f.tables.transactions.push({ _id: "purchase", order_id: "old", user_id: "u1", type: "purchase", amount: -4, status: "completed" });
    if (dbType === "mysql") {
      await assert.rejects(f.wallet.refundOrder("old", "cancelled", "test"), /PURCHASE_DEBIT_UNVERIFIED/);
      assert.equal(f.tables.users[0].balance, 10);
    } else {
      assert.equal((await f.wallet.refundOrder("old", "cancelled", "test")).refunded, true);
      assert.equal(f.tables.users[0].balance, 14);
    }
  });
}

test("prices cannot create credits through invalid base prices or discounts", () => {
  assert.ok(Number.isNaN(calculateUserPrice(-1, "app", [])));
  assert.ok(Number.isNaN(calculateUserPrice(5, "app", [{ percentage: 150 }])));
  assert.ok(Number.isNaN(calculateUserPrice(5, "app", [{ percentage: Infinity }])));
  assert.equal(calculateUserPrice("10.5", "app", [{ percentage: 10 }]), 9.45);
  for (const value of [Infinity, NaN, -1, 0, "", null, "12junk"]) assert.throws(() => positiveMoney(value));
  assert.equal(money(0.1 + 0.2), 0.3);
});

test("MongoDB wallet increments use atomic rounding and literal set values", () => {
  let result, error;
  roundMongoWalletIncrement.call({
    getUpdate: () => ({ $inc: { balance: -0.1, total_orders: 1 }, $set: { has_deposited: true } }),
    setUpdate: update => { result = update; },
  }, err => { error = err; });
  assert.equal(error, undefined);
  assert.equal(result[0].$set.balance.$round[1], 4);
  assert.equal(result[0].$set.balance.$round[0].$add[1], -0.1);
  assert.equal(result[0].$set.has_deposited.$literal, true);
});

test("Mongoose executes the wallet rounding hook with timestamps enabled", async () => {
  const mongoose = new (require("mongoose").Mongoose)();
  const User = moduleFrom("models/User.js", {
    mongoose, "../utils/db": { DB_TYPE: "mongodb" },
  });
  let sent;
  let sentFilter;
  User.collection.findOneAndUpdate = async (query, update) => {
    sentFilter = query;
    sent = update;
    return { _id: new mongoose.Types.ObjectId(), balance: 9.9 };
  };
  const user = await User.findOneAndUpdate({ _id: new mongoose.Types.ObjectId(), balance: { $gte: 0.1 } }, {
    $inc: { balance: -0.1, total_orders: 1 }, $set: { has_deposited: true },
  }, { new: true });
  assert.equal(user.balance, 9.9);
  assert.ok(Array.isArray(sent));
  assert.equal(sent[0].$set.balance.$round[1], 4);
  assert.equal(sentFilter.balance, undefined);
  assert.equal(sentFilter.$and[0].$expr.$gte[1], 0.1);
});

function watcherFixture(f, checkStatus, cancelOrder = async () => ({}), serverOptions = {}) {
  return moduleFrom("utils/orderStatusManager.js", {
    "../models/Order": f.models.Order,
    "../models/Server": { findOne: async () => { f.serverLookupCount = (f.serverLookupCount || 0) + 1; return { api_check_status_url: "provider", api_cancel_url: "cancel", ...serverOptions }; } },
    "./wallet": f.wallet, "./realtimeEmitter": { emitToUser() {} },
    "./orderSms": { recordOrderSms: async (order, otp, { complete } = {}) => {
      const current = f.tables.orders.find(row => String(row._id) === String(order._id));
      if (!current || current.status !== "active" || current.otp === otp || current.all_otps?.includes(otp)) return null;
      return f.models.Order.findOneAndUpdate({ _id: order._id, status: "active" }, { $set: { otp, all_otps: [...(current.all_otps || []), otp], refund_issued: true, ...(complete ? { status: "completed" } : {}) } });
    } },
    "./providerApi": { checkStatus, cancelOrder },
    "./orderLocks": { acquireLock: () => true, releaseLock() {} },
  });
}

test("watcher never overwrites a refund committed while a provider poll is in flight", async () => {
  const f = walletFixture();
  await f.wallet.reservePurchase({ userId: "u1", orderId: "o", amount: 4, description: "test" });
  const order = await f.wallet.finalizePurchase({ order_id: "o", user_id: "u1", cost: 4,
    server_name: "s", external_order_id: "1", status: "active", otp: "", refund_issued: false });
  let releasePoll, started;
  const polling = new Promise(resolve => { started = resolve; });
  const watcher = watcherFixture(f, async () => { started(); return new Promise(resolve => { releasePoll = resolve; }); });
  const sync = watcher.syncOrder(order);
  await polling;
  await f.wallet.refundOrder(order._id, "cancelled", "manual cancel");
  releasePoll({ status: "waiting" });
  await sync;
  assert.equal(f.tables.orders[0].status, "cancelled");
  assert.equal(f.tables.orders[0].refund_issued, true);
  assert.equal(f.tables.users[0].balance, 10);
});

test("watcher persists triple-check count and refunds only after the third confirmation", async () => {
  const f = walletFixture();
  await f.wallet.reservePurchase({ userId: "u1", orderId: "o", amount: 4, description: "test" });
  const order = await f.wallet.finalizePurchase({ order_id: "o", user_id: "u1", cost: 4,
    server_name: "s", external_order_id: "1", status: "active", otp: "", refund_issued: false });
  const watcher = watcherFixture(f, async () => ({ status: "cancelled" }));
  for (let i = 1; i <= 3; i++) {
    f.tables.orders[0].last_check_at = new Date(0);
    f.tables.orders[0].next_check_at = new Date(0);
    await watcher.syncOrder({ _id: order._id }); // deliberately omit projected bookkeeping fields
    assert.equal(f.tables.orders[0].verification_count, i);
    assert.equal(f.tables.users[0].balance, i === 3 ? 10 : 6);
  }
});

test("watcher checks the last provider OTP at expiry and never refunds a delivered OTP", async () => {
  const f = walletFixture();
  await f.wallet.reservePurchase({ userId: "u1", orderId: "o", amount: 4, description: "test" });
  const order = await f.wallet.finalizePurchase({ order_id: "o", user_id: "u1", cost: 4,
    server_name: "s", external_order_id: "1", status: "active", otp: "", expires_at: new Date(0) });
  const watcher = watcherFixture(f, async () => ({ status: "completed", otp: "123456" }));
  await watcher.syncOrder(order);
  assert.equal(f.tables.orders[0].status, "completed");
  assert.equal(f.tables.orders[0].refund_issued, true);
  assert.equal(f.tables.users[0].balance, 6);
  assert.equal(f.tables.transactions.filter(t => t.type === "refund").length, 0);
});

test("watcher honors each order's configured provider check interval", async () => {
  const f = walletFixture();
  const order = await f.models.Order.create({ _id: "poll-interval", order_id: "poll-interval", user_id: "u1",
    server_name: "s", external_order_id: "poll", status: "active", otp: "", all_otps: [], refund_issued: false, check_interval: 5, last_check_at: new Date() });
  let calls = 0;
  const watcher = watcherFixture(f, async () => { calls++; return { status: "waiting" }; });
  await watcher.syncOrder({ _id: "poll-interval" });
  assert.equal(calls, 0);
  assert.equal(f.serverLookupCount || 0, 0);
  f.tables.orders[0].last_check_at = new Date(Date.now() - 6000);
  f.tables.orders[0].next_check_at = new Date(Date.now() - 6000);
  await watcher.syncOrder({ _id: "poll-interval" });
  assert.equal(calls, 1);
  assert.equal(f.serverLookupCount, 1);
});

test("separate workers share the database polling lease for an active order", async () => {
  const f = walletFixture();
  const order = await f.models.Order.create({ _id: "shared-lease", order_id: "shared-lease", user_id: "u1",
    server_name: "s", external_order_id: "provider", status: "active", otp: "", all_otps: [], check_interval: 3 });
  let finish, started, calls = 0;
  const pollStarted = new Promise(resolve => { started = resolve; });
  const slowPoll = async () => { calls++; started(); return new Promise(resolve => { finish = resolve; }); };
  const workerA = watcherFixture(f, slowPoll);
  const workerB = watcherFixture(f, slowPoll);
  const running = workerA.syncOrder(order);
  await pollStarted;
  assert.ok(f.tables.orders[0].next_check_at > new Date());
  await workerB.syncOrder({ _id: "shared-lease" });
  assert.equal(calls, 1);
  finish({ status: "waiting" });
  await running;
});

test("watcher completes an active order when the provider repeats an OTP already saved by an API poll", async () => {
  const f = walletFixture();
  const order = await f.models.Order.create({ _id: "repeat-otp", order_id: "repeat-otp", user_id: "u1",
    status: "active", otp: "001234", all_otps: ["001234"], refund_issued: true, check_interval: 3, last_check_at: new Date(0) });
  const watcher = watcherFixture(f, async () => ({ status: "completed", otp: "001234" }));
  await watcher.syncOrder(order);
  assert.equal(f.tables.orders[0].status, "completed");
  assert.equal(f.tables.orders[0].otp, "001234");
  assert.equal(f.tables.users[0].balance, 10);
  assert.equal(f.tables.transactions.filter(t => t.type === "refund").length, 0);
});

test("website order-status polling saves provider OTPs once and completes completed activations", async () => {
  const f = walletFixture();
  f.tables.users[0].api_key = "test-key";
  await f.models.Order.create({ _id: "api-poll", order_id: "api-poll", user_id: "u1", status: "active",
    otp: "", all_otps: [], refund_issued: false, external_order_id: "provider-poll", server_name: "s" });
  const routes = routesFixture(f, async () => ({}), undefined, undefined, undefined, async order => {
    await f.models.Order.findOneAndUpdate({ _id: order._id, status: "active" }, { $set: {
      status: "completed", otp: "000123", all_otps: ["000123"], refund_issued: true,
    } });
    return f.models.Order.findById(order._id);
  });
  const result = response();
  await routes.gateway({ method: "GET", query: { api_key: "test-key", action: "getStatus", id: "api-poll" } }, result);
  assert.equal(result.body, "STATUS_OK:000123");
  assert.equal(f.tables.orders[0].status, "completed");
  assert.equal(f.tables.orders[0].otp, "000123");
  assert.deepEqual(f.tables.orders[0].all_otps, ["000123"]);
  assert.equal(f.tables.users[0].balance, 10);
});

test("API getStatus honors the order interval and syncs only after its scheduled time", async () => {
  const f = walletFixture();
  f.tables.users[0].api_key = "test-key";
  const order = await f.models.Order.create({ _id: "paced-api", order_id: "paced-api", user_id: "u1", status: "active",
    otp: "", all_otps: [], external_order_id: "provider", server_name: "s", check_interval: 5, next_check_at: new Date(Date.now() + 60000) });
  let syncCalls = 0;
  const routes = routesFixture(f, async () => ({}), undefined, undefined, undefined, async current => { syncCalls++; return current; });
  const req = { method: "GET", query: { api_key: "test-key", action: "getStatus", id: "paced-api" } };
  const first = response();
  await routes.gateway(req, first);
  assert.equal(first.body, "STATUS_WAIT_CODE");
  assert.equal(syncCalls, 0);
  f.tables.orders[0].next_check_at = new Date(Date.now() - 1000);
  const due = response();
  await routes.gateway(req, due);
  assert.equal(due.body, "STATUS_WAIT_CODE");
  assert.equal(syncCalls, 1);
});

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, set() { return this; } };
}

function adminOrderFixture(f, options = {}) {
  const router = moduleFrom("routes/admin.js", {
    "../utils/wallet": f.wallet, "../utils/db": f.db,
    "../models/User": f.models.User, "../models/Order": f.models.Order, "../models/Transaction": f.models.Transaction,
    "../models/Service": {}, "../models/Server": { findOne: async () => options.server || { api_cancel_url: "cancel" } }, "../models/Country": {}, "../models/Setting": {},
    "../models/AdminBankAccount": {}, "../models/Payout": {},
    "../utils/omnipay": {}, "../utils/heleket": {}, "../utils/analyticsPeriod": {}, "../utils/adminUserDetails": {},
    "../utils/providerApi": { cancelOrder: (...args) => options.cancelOrder ? options.cancelOrder(...args) : Promise.resolve({ success: true }) },
    "../utils/orderSms": { recordOrderSms: (...args) => options.recordOrderSms ? options.recordOrderSms(...args) : Promise.resolve(null) },
    "../utils/settingsCache": {}, "../utils/apiCache": {}, "../utils/realtimeEmitter": { emitToUser() {}, emitToAll() {} },
    "../utils/adminRealtime": { streamAdminChanges() {} }, "../middleware/auth": { adminRequired() {} },
  }, { console: { log() {}, error() {} } });
  return router.stack.find(layer => layer.route?.path === "/orders/:id" && layer.route.methods.patch).route.stack.at(-1).handle;
}

for (const dbType of ["mysql", "mongodb"]) {
  test(`${dbType}: fractional buy and simultaneous refunds restore exactly the debit once`, async () => {
    const f = walletFixture(dbType);
    f.tables.users[0].balance = 2.1234;
    await f.wallet.reservePurchase({ userId: "u1", orderId: "fraction", amount: 1.2345, description: "test" });
    assert.equal(f.tables.users[0].balance, 0.8889);
    const order = await f.wallet.finalizePurchase({ order_id: "fraction", user_id: "u1", server_name: "s", external_order_id: "fraction", cost: 1.2345, otp: null, all_otps: [], status: "active" });
    const results = await Promise.all(Array.from({ length: 20 }, () => f.wallet.refundOrder(order._id, "cancelled", "test")));
    assert.equal(results.filter(r => r.refunded).length, 1);
    assert.equal(f.tables.users[0].balance, 2.1234);
    assert.equal(f.tables.transactions.filter(t => t.type === "refund").length, 1);
    assert.equal(f.tables.transactions.find(t => t.type === "refund").amount, 1.2345);
  });

  test(`${dbType}: stale rebuy recovery reverses once and retains the uncertain allocation claim`, async () => {
    const f = walletFixture(dbType);
    await f.wallet.reservePurchase({ userId: "u1", orderId: "rebuy-crash", amount: 3.25, description: "test" });
    f.tables.transactions[0].createdAt = new Date(0);
    f.tables.orders.push({ _id: "parent", order_id: "parent", rebuy_order_id: "rebuy-crash", status: "completed", otp: "1234" });
    await f.wallet.recoverPendingPurchases();
    await f.wallet.recoverPendingPurchases();
    assert.equal(f.tables.users[0].balance, 10);
    assert.equal(f.tables.orders[0].rebuy_order_id, "rebuy-crash");
    assert.equal(f.tables.transactions.filter(t => t.type === "refund").length, 1);
  });

  test(`${dbType}: admin cancelled, expired and refunded statuses all return one verified debit`, async () => {
    for (const status of ["cancelled", "expired", "refunded"]) {
      const f = walletFixture(dbType);
      await f.wallet.reservePurchase({ userId: "u1", orderId: "admin", amount: 3.125, description: "test" });
      await f.wallet.finalizePurchase({ order_id: "admin", user_id: "u1", server_name: "s", external_order_id: status, cost: 3.125, otp: "", all_otps: [], status: "active" });
      const handler = adminOrderFixture(f);
      const args = { params: { id: "admin" }, body: { status } };
      const result = response();
      await handler(args, result);
      assert.equal(result.statusCode, 200, status);
      assert.equal(f.tables.users[0].balance, 10);
      assert.equal(f.tables.orders[0].status, status);
      const repeated = response();
      await handler(args, repeated);
      assert.equal(repeated.statusCode, 200);
      assert.equal(f.tables.users[0].balance, 10);
      assert.equal(f.tables.transactions.filter(t => t.type === "refund").length, 1);
    }
  });

  test(`${dbType}: admin cannot refund OTPs, reactivate a rebought original or refund an uncharged order`, async () => {
    const f = walletFixture(dbType);
    await f.wallet.reservePurchase({ userId: "u1", orderId: "admin-otp", amount: 4, description: "test" });
    await f.wallet.finalizePurchase({ order_id: "admin-otp", user_id: "u1", server_name: "s", external_order_id: "otp", cost: 4, otp: "1234", all_otps: ["1234"], status: "completed", refund_issued: true, rebuy_cancelled: true });
    const handler = adminOrderFixture(f);
    for (const status of ["cancelled", "expired", "refunded", "active"]) {
      const result = response();
      await handler({ params: { id: "admin-otp" }, body: { status } }, result);
      assert.equal(result.statusCode, 409, status);
      assert.equal(f.tables.users[0].balance, 6);
    }
    f.tables.orders.push({ _id: "uncharged", order_id: "uncharged", user_id: "u1", status: "active", cost: 20, otp: "", all_otps: [] });
    const result = response();
    await handler({ params: { id: "uncharged" }, body: { status: "cancelled" } }, result);
    assert.equal(result.statusCode, 409);
    assert.equal(f.tables.users[0].balance, 6);
    assert.equal(f.tables.orders[1].status, "active");
  });

  test(`${dbType}: website cancellation waits for confirmation and captures cancellation-time OTP`, async () => {
    for (const providerResult of [{ success: false }, { success: false, otp: "9876" }, { success: true }]) {
      const f = walletFixture(dbType);
      await f.wallet.reservePurchase({ userId: "u1", orderId: "web-cancel", amount: 4, description: "test" });
      await f.wallet.finalizePurchase({ order_id: "web-cancel", user_id: "u1", server_name: "s", external_order_id: "cancel", cost: 4, otp: "", all_otps: [], status: "active" });
      let finishCancel, started;
      const hasStarted = new Promise(resolve => { started = resolve; });
      f.cancelOrder = async (_server, _id, options) => { assert.equal(options.requireConfirmation, true); started(); return new Promise(resolve => { finishCancel = resolve; }); };
      const routes = routesFixture(f, async () => ({}));
      routes.server.api_cancel_url = "cancel";
      const result = response();
      const cancelling = routes.cancel({ userId: "u1", params: { id: "web-cancel" } }, result);
      await hasStarted;
      assert.equal(f.tables.orders[0].status, "active");
      assert.equal(f.tables.users[0].balance, 6);
      finishCancel(providerResult);
      await cancelling;
      assert.equal(f.tables.users[0].balance, providerResult.success ? 10 : 6);
      assert.equal(f.tables.orders[0].status, providerResult.success ? "cancelled" : providerResult.otp ? "completed" : "active");
      assert.equal(f.tables.transactions.filter(t => t.type === "refund").length, providerResult.success ? 1 : 0);
      assert.equal(result.statusCode, providerResult.success || providerResult.otp ? 200 : 409);
    }
  });
}

function routesFixture(f, getNumber, rebuyCancelledOrder = async () => { throw new Error("Rebuy not configured"); }, cancelCompletedOrderForRebuy = async () => { throw new Error("Cancel not configured"); }, checkStatus = async () => ({ status: "waiting" }), syncOrder = async order => order) {
  const originalFind = f.models.User.findById;
  f.models.User.findById = (...args) => {
    const query = originalFind(...args);
    query.select = () => query;
    return query;
  };
  const service = { _id: "svc", server_id: "srv", name: "test", price: 6, is_active: true, service_code: "test", country_code: "22" };
  const server = { _id: "srv", name: "s", is_active: true };
  const dependencies = {
    "../utils/wallet": f.wallet, "../utils/db": f.db,
    "../utils/rebuy": { rebuyCancelledOrder, cancelCompletedOrderForRebuy },
    "../utils/orderStatusManager": { syncOrder },
    "../models/User": f.models.User, "../models/Order": f.models.Order, "../models/Transaction": f.models.Transaction,
    "../models/Service": { findById: async () => service, find: () => ({ sort: async () => [service] }) },
    "../models/Server": { findById: async () => server, findOne: async () => server, find: (...args) => f.serverFind(...args) },
    "../utils/providerApi": { getNumber, checkStatus, cancelOrder: (...args) => f.cancelOrder ? f.cancelOrder(...args) : Promise.resolve({ success: true }) },
    "../middleware/auth": { loginRequired() {}, optionalLogin() {} },
    "../utils/realtimeEmitter": { emitToUser() {} }, "../utils/adminRealtime": { notifyAdminChange() {} },
    "../utils/orderSms": { recordOrderSms: async (order, otp) => f.models.Order.findOneAndUpdate({ _id: order._id, status: "active" }, { $set: { otp, all_otps: [otp], refund_issued: true, status: "completed" } }) }, "../utils/bharatpe": {}, "../utils/paytm": {}, "../utils/omnipay": {}, "../utils/heleket": {}, "../utils/eaglepay": {},
    "../models/Country": {}, "../models/Setting": {}, "../models/UserWebhook": {}, "../models/PromoCode": {},
  };
  const extra = { process: { env: { DB_TYPE: "mysql" } }, console: { log() {}, error() {}, warn() {} } };
  const user = moduleFrom("routes/user.js", dependencies, extra);
  const api = moduleFrom("routes/apiGateway.js", dependencies, extra);
  const handler = (router, route, method) => router.stack.find(layer => layer.route?.path === route && (!method || layer.route.methods[method])).route.stack.at(-1).handle;
  return { service, server, cancel: handler(user, "/orders/:id/cancel"), listOrders: handler(user, "/orders", "get"), cancelForRebuy: handler(user, "/orders/:id/cancel-for-rebuy"), retry: handler(user, "/orders/:id/retry"), purchase: handler(user, "/orders"), rebuy: handler(user, "/orders/:id/rebuy"), gateway: handler(api, "/") };
}

test("website purchase refuses insufficient balance before calling provider and records a successful debit", async () => {
  const f = walletFixture();
  let providerCalls = 0;
  const routes = routesFixture(f, async () => { providerCalls++; return { api_order_id: "1", phone: "919876543210" }; });
  f.tables.users[0].balance = 5;
  const insufficient = response();
  await routes.purchase({ userId: "u1", body: { service_id: "svc" } }, insufficient);
  assert.equal(insufficient.statusCode, 402);
  assert.equal(providerCalls, 0);
  f.tables.users[0].balance = 10;
  const success = response();
  await routes.purchase({ userId: "u1", body: { service_id: "svc" } }, success);
  assert.equal(success.statusCode, 200);
  assert.equal(success.body.order.cost, 6);
  assert.equal(f.tables.users[0].balance, 4);
  assert.equal(f.tables.transactions[0].status, "completed");
});

test("website purchase applies the server price and user discount to its single ledger debit", async () => {
  const f = walletFixture();
  f.tables.users[0].discounts = [{ service_name: "test", server_id: "srv", percentage: 20 }];
  const routes = routesFixture(f, async () => ({ api_order_id: "discounted", phone: "919876543210" }));
  const result = response();
  await routes.purchase({ userId: "u1", body: { service_id: "svc" } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.order.cost, 4.8);
  assert.equal(f.tables.users[0].balance, 5.2);
  assert.equal(f.tables.users[0].total_spent, 4.8);
  assert.equal(f.tables.users[0].total_orders, 1);
  assert.equal(f.tables.transactions.filter(tx => tx.type === "purchase").length, 1);
  assert.equal(f.tables.transactions[0].amount, -4.8);
});

test("website provider failure reverses exactly the reserved debit and logs the refund", async () => {
  const f = walletFixture();
  const routes = routesFixture(f, async () => ({ error: "NO_NUMBERS" }));
  const res = response();
  await routes.purchase({ userId: "u1", body: { service_id: "svc" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(f.tables.users[0].balance, 10);
  assert.equal(f.tables.transactions.filter(tx => tx.type === "refund").length, 1);
  assert.equal(f.tables.orders.length, 0);
});

test("rebuy provider URL uses the original order ID and phone placeholders", async () => {
  const calls = [];
  const provider = require("../utils/providerApi");
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => "ACCESS_NUMBER:new-provider-id:919876543210" };
  };
  try {
    const result = await provider.rebuyOrder({ api_key: "key", api_rebuy_url: "https://provider.example/rebuy?key=$api_key&id=$id&phone=$phone" }, {
      external_order_id: "old-provider-id", phone: "919876543210", service_code: "wa", country: "22",
    });
    assert.deepEqual({ api_order_id: result.api_order_id, phone: result.phone }, { api_order_id: "new-provider-id", phone: "919876543210" });
    assert.match(calls[0], /key=key/);
    assert.match(calls[0], /id=old-provider-id/);
    assert.match(calls[0], /phone=919876543210/);
  } finally { global.fetch = originalFetch; }
});

test("provider timeout is exposed as no numbers on the website and NO_NUMBERS to API clients", async () => {
  const website = walletFixture();
  const websiteRoutes = routesFixture(website, async () => ({ error: "Provider request timed out" }));
  const websiteResponse = response();
  await websiteRoutes.purchase({ userId: "u1", body: { service_id: "svc" } }, websiteResponse);
  assert.equal(websiteResponse.statusCode, 400);
  assert.equal(websiteResponse.body.error, "No numbers available");
  assert.equal(websiteResponse.body.code, "NO_NUMBERS");
  assert.equal(website.tables.users[0].balance, 10);

  const api = walletFixture();
  api.tables.users[0].api_key = "test-key";
  const apiRoutes = routesFixture(api, async () => ({ error: "Provider request timed out" }));
  const apiResponse = response();
  await apiRoutes.gateway({ method: "GET", query: { api_key: "test-key", action: "getNumber", service: "test", country: "22" } }, apiResponse);
  assert.equal(apiResponse.statusCode, 200);
  assert.equal(apiResponse.body, "NO_NUMBERS");
  assert.equal(api.tables.users[0].balance, 10);
});

test("provider allocation maps fetch and response-body aborts to NO_NUMBERS and retains diagnostics", async () => {
  for (const phase of ["fetch", "body"]) {
    const logs = [];
    const aborted = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const provider = moduleFrom("utils/providerApi.js", {
      fs: { existsSync: () => true, readFileSync: () => "[]", appendFileSync() {} },
    }, {
      AbortController,
      fetch: async () => {
        if (phase === "fetch") throw aborted;
        return { ok: true, status: 200, text: async () => { throw aborted; } };
      },
      console: { log() {}, error: (...args) => logs.push(args.join(" ")) },
    });
    const result = await provider.getNumber({ api_get_number_url: "https://provider.example/getNumber" }, "test", "22");
    assert.equal(result.error, "NO_NUMBERS");
    assert.ok(logs.some(line => line.includes("Provider API Error: This operation was aborted")));
  }
});

test("API purchase also checks funds before provider and charges a successful order", async () => {
  const f = walletFixture();
  f.tables.users[0].api_key = "test-key";
  let calls = 0;
  const routes = routesFixture(f, async () => { calls++; return { api_order_id: "1", phone: "919876543210" }; });
  const req = { method: "GET", query: { api_key: "test-key", action: "getNumber", service: "test", country: "22" } };
  f.tables.users[0].balance = 5;
  const noBalance = response();
  await routes.gateway(req, noBalance);
  assert.equal(noBalance.body, "NO_BALANCE");
  assert.equal(calls, 0);
  f.tables.users[0].balance = 10;
  const success = response();
  await routes.gateway(req, success);
  assert.match(success.body, /^ACCESS_NUMBER:ORD-/);
  assert.equal(f.tables.users[0].balance, 4);
});

test("website and API rebuy endpoints use the caller-owned activation ID and return the new activation", async () => {
  const f = walletFixture();
  f.tables.users[0].api_key = "test-key";
  const calls = [];
  const sharedRebuy = async args => {
    calls.push(args);
    return { order: { order_id: "ORD-NEW", phone: "919876543210" }, balance: 4 };
  };
  const routes = routesFixture(f, async () => ({}), sharedRebuy);
  const webResponse = response();
  await routes.rebuy({ userId: "u1", params: { id: "ORD-OLD" } }, webResponse);
  assert.equal(webResponse.statusCode, 201);
  assert.equal(webResponse.body.order.order_id, "ORD-NEW");
  assert.equal(calls[0].orderId, "ORD-OLD");
  assert.equal(calls[0].userId, "u1");

  const apiResponse = response();
  await routes.gateway({ method: "GET", query: { api_key: "test-key", action: "rebuy", id: "ORD-OLD" } }, apiResponse);
  assert.equal(apiResponse.body, "ACCESS_NUMBER:ORD-NEW:919876543210");
  assert.equal(calls[1].orderId, "ORD-OLD");
  assert.equal(calls[1].userId, "u1");
});

test("OmniPay callback cannot credit from an unsigned body or a provider UNPAID status", async () => {
  let credits = 0, gatewayResult = null;
  const router = moduleFrom("routes/omnipayWebhook.js", {
    "../utils/wallet": { creditDeposit() { credits++; throw new Error("Must not credit"); } },
    "../models/User": {}, "../models/Payout": {}, "../utils/db": {},
    "../models/Transaction": { findOne: async () => ({ _id: "pay", type: "deposit", status: "pending", user_id: "u1", amount: 5 }) },
    "../utils/omnipay": { queryOrder: async () => gatewayResult },
    fs: { existsSync: () => true, readFileSync: () => JSON.stringify({ omnipay: {} }) },
  }, { console: { log() {}, warn() {}, error() {} } });
  const handler = router.stack.find(layer => layer.route?.path === "/callback").route.stack[0].handle;
  const req = { body: { order_no: "pay", status: "SUCCESS" }, query: {} };
  const unavailable = response();
  await handler(req, unavailable);
  assert.equal(unavailable.statusCode, 503);
  gatewayResult = { status: "UNPAID" };
  await handler(req, response());
  assert.equal(credits, 0);
});

test("wallet schema migration changes only money columns and skips an already migrated database", async () => {
  const { ensureWalletSchema } = require("../utils/walletSchema");
  const queries = [];
  let migrated = false;
  const sequelize = { query: async (sql, options) => {
    queries.push(sql);
    if (sql.includes("INFORMATION_SCHEMA.TABLES")) return [{ TABLE_NAME: "Users", ENGINE: "InnoDB" }];
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return options.replacements.table === "Users"
      ? [{ COLUMN_NAME: "balance", COLUMN_TYPE: migrated ? "decimal(18,4)" : "float" }, { COLUMN_NAME: "notes", COLUMN_TYPE: "text" }]
      : [];
    return [];
  } };
  await ensureWalletSchema(sequelize);
  assert.deepEqual(queries.filter(sql => sql.startsWith("ALTER TABLE")), ["ALTER TABLE `Users` MODIFY COLUMN `balance` DECIMAL(18,4) NOT NULL DEFAULT 0"]);
  migrated = true;
  queries.length = 0;
  await ensureWalletSchema(sequelize);
  assert.equal(queries.filter(sql => sql.startsWith("ALTER TABLE")).length, 0);
  await assert.rejects(ensureWalletSchema({ query: async () => [{ TABLE_NAME: "Users", ENGINE: "MyISAM" }] }), /InnoDB/);
});

test("legacy optional references become nullable before Sequelize adds the unique index", async () => {
  const { ensureReferenceSchema } = require("../utils/walletSchema");
  const queries = [];
  await ensureReferenceSchema({ query: async sql => {
    queries.push(sql);
    return sql.includes("INFORMATION_SCHEMA") ? [{ IS_NULLABLE: "NO" }] : [];
  } });
  assert.ok(queries[1].startsWith("ALTER TABLE `Transactions`"));
  assert.equal(queries[2], "UPDATE `Transactions` SET `reference` = NULL WHERE `reference` = ''");
});

test("rebuy schema migration adds server endpoint and order claim/link columns only when missing", async () => {
  const { ensureRebuySchema } = require("../utils/walletSchema");
  const queries = [];
  const present = new Set(["Servers.api_rebuy_url"]);
  await ensureRebuySchema({ query: async (sql, options) => {
    queries.push(sql);
    if (sql.includes("INFORMATION_SCHEMA")) {
      if (sql.includes("STATISTICS")) return [];
      const key = `${options.replacements.table}.${options.replacements.column}`;
      return present.has(key) ? [{ COLUMN_NAME: options.replacements.column }] : [];
    }
    return [];
  } });
  assert.deepEqual(queries.filter(sql => sql.startsWith("ALTER TABLE")), [
    "ALTER TABLE `Orders` ADD COLUMN `rebuy_of` VARCHAR(255) NOT NULL DEFAULT ''",
    "ALTER TABLE `Orders` ADD COLUMN `rebuy_order_id` VARCHAR(255) NULL DEFAULT NULL",
    "ALTER TABLE `Orders` ADD COLUMN `rebuy_cancelled` TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE `Orders` ADD COLUMN `rebuy_ignored_otps` TEXT NULL",
    "ALTER TABLE `Orders` ADD COLUMN `next_check_at` DATETIME NULL",
  ]);
  assert.ok(queries.includes("CREATE INDEX `idx_orders_status_next_check` ON `Orders` (`status`, `next_check_at`)"));
});

test("cancel-for-rebuy originals cannot be reactivated by website or API next-SMS requests", async () => {
  const f = walletFixture();
  f.tables.users[0].api_key = "test-key";
  f.tables.orders.push({ _id: "old", user_id: "u1", order_id: "old", status: "completed", otp: "1234", all_otps: ["1234"], refund_issued: true, rebuy_cancelled: true });
  const routes = routesFixture(f, async () => ({}));
  const web = response();
  await routes.retry({ userId: "u1", params: { id: "old" } }, web);
  assert.equal(web.statusCode, 400);
  const api = response();
  await routes.gateway({ method: "GET", query: { apikey: "test-key", action: "setStatus", id: "old", status: "3" } }, api);
  assert.equal(api.body, "BAD_STATUS");
  assert.equal(f.tables.orders[0].status, "completed");
  assert.equal(f.tables.orders[0].otp, "1234");
});

test("cancel-for-rebuy requires explicit provider confirmation and successful HTTP status", async () => {
  const provider = require("../utils/providerApi");
  const originalFetch = global.fetch;
  try {
    const server = { api_cancel_url: "https://provider.example/cancel?id=$id" };
    for (const [status, body, success] of [
      [200, "ACCESS_CANCEL", true], [200, "ACCESS_ACTIVATION_CANCELED", true],
      [200, '{"success":true}', true], [200, "STATUS_OK", false],
      [200, "NO_ACTIVATION", false], [200, "UNKNOWN", false],
      [200, '<html>login required</html>', false], [403, "ACCESS_CANCEL", false],
    ]) {
      global.fetch = async () => ({ status, ok: status === 200, text: async () => body });
      assert.equal((await provider.cancelOrder(server, "old", { requireConfirmation: true })).success, success, `${status}: ${body}`);
    }
  } finally { global.fetch = originalFetch; }
});

test("website and API cancellation endpoints scope completed-OTP cancellation to the caller", async () => {
  const f = walletFixture();
  f.tables.users[0].api_key = "test-key";
  const calls = [];
  const cancel = async args => { calls.push(args); return { order_id: args.orderId, status: "completed", otp: "1234", rebuy_cancelled: true }; };
  const routes = routesFixture(f, async () => ({}), undefined, cancel);
  const web = response();
  await routes.cancelForRebuy({ userId: "u1", params: { id: "old" } }, web);
  assert.equal(web.statusCode, 200);
  assert.equal(web.body.can_rebuy, true);
  assert.equal(web.body.order.status, "completed");
  const api = response();
  await routes.gateway({ method: "GET", query: { apikey: "test-key", action: "cancelForRebuy", id: "old" } }, api);
  assert.equal(api.body, "ACCESS_CANCEL_FOR_REBUY");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.userId === "u1" && call.orderId === "old"));
  const failed = routesFixture(f, async () => ({}), undefined, async () => { throw new Error("PROVIDER_CANCEL_FAILED"); });
  const failure = response();
  await failed.cancelForRebuy({ userId: "u1", params: { id: "old" } }, failure);
  assert.equal(failure.statusCode, 502);
  assert.equal(failure.body.can_rebuy, undefined);
});

test("fresh database SQL defines each table column once", () => {
  for (const table of source("database.sql").matchAll(/CREATE TABLE IF NOT EXISTS `([^`]+)` \(([\s\S]*?)\n\)/g)) {
    const names = [...table[2].matchAll(/^\s*`([^`]+)`\s+/gm)].map(match => match[1]);
    assert.equal(new Set(names).size, names.length, `Duplicate column in ${table[1]}`);
  }
});

test("order list exposes completed cancellation and rebuy buttons with six-row server pagination", async () => {
  const f = walletFixture();
  const rows = [
    { order_id: "otp", server_name: "s", status: "completed", otp: "1234", all_otps: ["1234"], refund_issued: true },
    { order_id: "otp-cancelled", server_name: "s", status: "completed", otp: "5678", all_otps: ["5678"], refund_issued: true, rebuy_cancelled: true },
    { order_id: "refunded", server_name: "s", status: "cancelled", otp: "", all_otps: "[]", refund_issued: true },
    { order_id: "unrefunded", server_name: "s", status: "cancelled", otp: "", all_otps: [], refund_issued: false },
  ];
  const calls = {};
  f.models.Order.countDocuments = async filter => { calls.filter = filter; return 12; };
  f.models.Order.find = () => ({
    select(fields) { calls.fields = fields; return this; }, sort(value) { calls.sort = value; return this; },
    skip(value) { calls.skip = value; return this; }, limit(value) { calls.limit = value; return this; },
    lean: async () => rows,
  });
  f.serverFind = () => ({
    select(fields) { calls.serverFields = fields; return this; }, populate() { return this; },
    lean: async () => [{ name: "s", is_active: true, api_cancel_url: "cancel", api_rebuy_url: "rebuy" }],
  });
  const routes = routesFixture(f, async () => ({}));
  const res = response();
  await routes.listOrders({ userId: "u1", query: { rebuy_candidates: "1", page: "2", limit: "6" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.filter.user_id, "u1");
  assert.equal(calls.skip, 6);
  assert.equal(calls.limit, 6);
  assert.equal(calls.sort._id, -1);
  assert.ok(calls.serverFields.includes("api_cancel_url"));
  assert.ok(calls.fields.includes("rebuy_cancelled"));
  assert.equal(res.body.pages, 2);
  assert.equal(rows[0].can_rebuy, false);
  assert.equal(rows[0].can_rebuy_after_cancel, true);
  assert.equal(rows[1].can_rebuy, true);
  assert.equal(rows[1].can_rebuy_after_cancel, false);
  assert.equal(rows[2].can_rebuy, true);
  assert.ok(Array.isArray(rows[2].all_otps));
  assert.equal(rows[3].can_rebuy, false);
});

test("rebuy and getNumber return identical plain-text success responses and normalize phone digits", async () => {
  const f = walletFixture();
  f.tables.users[0].api_key = "test-key";
  let newOrder;
  const routes = routesFixture(f,
    async () => ({ api_order_id: "provider-contract-test", phone: "+91 98765-43210" }),
    async () => ({ order: newOrder, balance: 4 }));
  const allocated = response();
  await routes.gateway({ method: "GET", query: { api_key: "test-key", action: "getNumber", service: "test", country: "22" } }, allocated);
  assert.equal(typeof allocated.body, "string");
  assert.match(allocated.body, /^ACCESS_NUMBER:ORD-[^:]+:919876543210$/);
  newOrder = f.tables.orders[0];
  for (const action of ["rebuy", "reBuy"]) {
    const rebought = response();
    await routes.gateway({ method: "GET", query: { apikey: "test-key", action, id: "old-order" } }, rebought);
    assert.equal(rebought.body, allocated.body);
    assert.equal(rebought.statusCode, allocated.statusCode);
  }
});

test("rebuy accepts the same text and JSON provider success formats as getNumber", async () => {
  const provider = require("../utils/providerApi");
  const originalFetch = global.fetch;
  const server = { api_get_number_url: "https://provider.example/getNumber", api_rebuy_url: "https://provider.example/rebuy?id=$id", retry_count: 1 };
  try {
    for (const body of ["ACCESS_NUMBER:provider-id:+91 98765-43210", JSON.stringify({ id: "provider-id", phone: "+91 98765-43210" })]) {
      global.fetch = async () => ({ ok: true, status: 200, text: async () => body });
      const allocated = await provider.getNumber(server, "test", "22");
      const rebought = await provider.rebuyOrder(server, { external_order_id: "old-provider-id", phone: "919876543210" });
      assert.deepEqual(rebought, allocated);
      assert.deepEqual(rebought, { api_order_id: "provider-id", phone: "919876543210" });
    }
  } finally { global.fetch = originalFetch; }
});

test("provider cancellation captures STATUS_OK OTPs and allows missing activations only when requested", async () => {
  const provider = require("../utils/providerApi");
  const originalFetch = global.fetch;
  try {
    const server = { api_cancel_url: "https://provider.example/cancel?id=$id" };
    global.fetch = async () => ({ status: 200, ok: true, text: async () => "STATUS_OK:001234" });
    const result = await provider.cancelOrder(server, "id", { requireConfirmation: true });
    assert.equal(result.success, false);
    assert.equal(result.otp, "001234");
    global.fetch = async () => ({ status: 200, ok: true, text: async () => "NO_ACTIVATION" });
    assert.equal((await provider.cancelOrder(server, "id", { requireConfirmation: true })).success, false);
    assert.equal((await provider.cancelOrder(server, "id", { requireConfirmation: true, allowMissing: true })).success, true);
  } finally { global.fetch = originalFetch; }
});

test("provider status parser accepts text and common JSON OTP formats without mistaking wait codes for OTPs", async () => {
  const provider = require("../utils/providerApi");
  const originalFetch = global.fetch;
  try {
    const server = { api_check_status_url: "https://provider.example/status?id=$id" };
    const cases = [
      ["STATUS_OK: 001234 ", { status: "completed", otp: "001234" }],
      ["STATUS_WAIT_CODE", { status: "waiting", otp: null }],
      ["STATUS_OK", { status: "completed", otp: null }],
      [JSON.stringify({ status: "SUCCESS", data: { otp_code: "00-4321" } }), { status: "completed", otp: "00-4321" }],
      [JSON.stringify({ status: "WAITING" }), { status: "waiting", otp: null }],
      [JSON.stringify({ status: "CANCELLED" }), { status: "cancelled", otp: null }],
    ];
    for (const [body, expected] of cases) {
      global.fetch = async () => ({ status: 200, ok: true, text: async () => body });
      assert.deepEqual(await provider.checkStatus(server, "provider-id"), expected, body);
    }
    global.fetch = async () => ({ status: 403, ok: false, text: async () => "forbidden" });
    assert.match((await provider.checkStatus(server, "provider-id")).error, /status request failed/);
  } finally { global.fetch = originalFetch; }
});

test("expiry captures an OTP returned while cancelling and retains the original debit", async () => {
  const f = walletFixture();
  await f.wallet.reservePurchase({ userId: "u1", orderId: "expiry", amount: 4, description: "test" });
  const order = await f.wallet.finalizePurchase({ order_id: "expiry", user_id: "u1", server_name: "s", external_order_id: "expiry", cost: 4, otp: "", all_otps: [], status: "active", expires_at: new Date(0) });
  const watcher = watcherFixture(f, async () => ({ status: "waiting" }), async () => ({ success: false, otp: "654321" }));
  await watcher.syncOrder(order);
  assert.equal(f.tables.orders[0].otp, "654321");
  assert.equal(f.tables.orders[0].status, "completed");
  assert.equal(f.tables.users[0].balance, 6);
  assert.equal(f.tables.transactions.filter(t => t.type === "refund").length, 0);
});

test("website duplicate buy requests allocate once and failed allocation restores funds", async () => {
  const f = walletFixture();
  let release, start;
  const started = new Promise(resolve => { start = resolve; });
  let calls = 0;
  const routes = routesFixture(f, async () => { calls++; start(); return new Promise(resolve => { release = resolve; }); });
  const first = response(), second = response();
  const buying = routes.purchase({ userId: "u1", body: { service_id: "svc" } }, first);
  await started;
  await routes.purchase({ userId: "u1", body: { service_id: "svc" } }, second);
  assert.equal(second.statusCode, 429);
  assert.equal(calls, 1);
  assert.equal(f.tables.users[0].balance, 4);
  release({ error: "NO_NUMBERS" });
  await buying;
  assert.equal(first.statusCode, 400);
  assert.equal(f.tables.users[0].balance, 10);
  assert.equal(f.tables.orders.length, 0);
  assert.equal(f.tables.transactions.filter(t => t.type === "refund").length, 1);
});

test("MySQL refund conditions generate IS NULL rather than IN (NULL) for legacy null OTPs", async () => {
  const f = await mysqlFixture();
  await f.User.findOne({ _id: 1, $or: [{ otp: "" }, { otp: null }] });
  const sql = f.sequelize.getQueryInterface().queryGenerator.selectQuery("Orders", { where: f.reads.at(-1).where });
  assert.match(sql, /`otp` IS NULL/);
  assert.doesNotMatch(sql, /IN \([^)]*NULL/);
});

for (const dbType of ["mysql", "mongodb"]) {
  for (const receivedOtp of [false, true]) {
    test(`${dbType}: complete buy/rebuy/refund ledger balances agree (original OTP ${receivedOtp})`, async () => {
      const f = walletFixture(dbType);
      const price = 2.125;
      const base = { order_id: "original", user_id: "u1", service_id: "svc", service_name: "test", country: "IN",
        cost: price, phone: "919876543210", server_name: "s", external_order_id: "same", otp: "", all_otps: [], status: "active" };
      await f.wallet.reservePurchase({ userId: "u1", orderId: "original", amount: price, description: "test" });
      await f.wallet.finalizePurchase(base);
      if (receivedOtp) Object.assign(f.tables.orders[0], { status: "completed", otp: "1234", all_otps: ["1234"], refund_issued: true, rebuy_cancelled: true });
      else await f.wallet.refundOrder(f.tables.orders[0]._id, "cancelled", "test");
      let calls = 0;
      const rebuy = moduleFrom("utils/rebuy.js", {
        "../models/Order": f.models.Order, "../models/Transaction": f.models.Transaction,
        "../models/Server": { findOne: async () => ({ is_active: true, api_rebuy_url: "rebuy", api_cancel_url: "cancel" }) },
        "../models/Service": { findById: async () => ({ service_code: "test" }) },
        "./wallet": f.wallet,
        "./providerApi": { cancelOrder: async () => ({ success: true }), rebuyOrder: async () => { calls++; return { api_order_id: "same", phone: base.phone }; } },
        "./orderLocks": { acquireLockWithTimeout: async () => true, releaseLock() {} },
      });
      const result = await rebuy.rebuyCancelledOrder({ orderId: "original", userId: "u1" });
      assert.equal(calls, 1);
      assert.equal(result.order.cost, price);
      assert.equal(result.order.phone, base.phone);
      assert.equal(f.tables.users[0].balance, receivedOtp ? 5.75 : 7.875);
      await assert.rejects(rebuy.rebuyCancelledOrder({ orderId: "original", userId: "u1" }), /REBUY_ALREADY_USED/);
      assert.equal(calls, 1);
      const rebuys = f.tables.orders.filter(order => order.rebuy_of);
      assert.equal(rebuys.length, 1);
      await Promise.all(Array.from({ length: 10 }, () => f.wallet.refundOrder(rebuys[0]._id, "cancelled", "test")));
      assert.equal(f.tables.users[0].balance, receivedOtp ? 7.875 : 10);
      const ledgerNet = f.tables.transactions.filter(tx => tx.status !== "failed").reduce((total, tx) => money(total + tx.amount), 0);
      assert.equal(money(10 + ledgerNet), f.tables.users[0].balance);
      const purchases = f.tables.transactions.filter(tx => tx.type === "purchase");
      assert.equal(purchases.length, 2);
      assert.match(purchases[0].reference, /^PROVIDER-ORDER:RETIRED:/);
      assert.ok(!purchases[1].reference.includes("RETIRED"));
    });
  }
}

test("concurrent API buys cannot allocate numbers beyond the available balance", async () => {
  const f = walletFixture();
  f.tables.users[0].api_key = "test-key";
  let calls = 0;
  const routes = routesFixture(f, async () => { calls++; return { api_order_id: "one", phone: "919876543210" }; });
  const results = await Promise.all(Array.from({ length: 20 }, async () => {
    const result = response();
    await routes.gateway({ method: "GET", query: { api_key: "test-key", action: "getNumber", service: "test", country: "22" } }, result);
    return result.body;
  }));
  assert.equal(results.filter(body => body.startsWith("ACCESS_NUMBER:")).length, 1);
  assert.equal(results.filter(body => body === "NO_BALANCE").length, 19);
  assert.equal(calls, 1);
  assert.equal(f.tables.users[0].balance, 4);
});

test("API rejects structured credentials and IDs before any ownership lookup", async () => {
  const f = walletFixture();
  let lookups = 0;
  f.models.User.findOne = async () => { lookups++; return { _id: "u1", api_key: "test-key" }; };
  const routes = routesFixture(f, async () => ({}));
  for (const query of [
    { api_key: { $ne: "" }, action: "rebuy", id: "other-order" },
    { apikey: ["test-key"], action: "getNumber" },
    { api_key: "test-key", action: "rebuy", id: { $ne: "" } },
  ]) {
    const result = response();
    await routes.gateway({ method: "GET", query }, result);
    assert.ok(["BAD_KEY", "BAD_REQUEST"].includes(result.body));
  }
  assert.equal(lookups, 0);
});

test("admin refunds wait for provider confirmation and never refund an OTP returned during cancellation", async () => {
  for (const cancellation of [{ success: false }, { success: false, otp: "009876" }, { success: true }]) {
    const f = walletFixture();
    await f.wallet.reservePurchase({ userId: "u1", orderId: "admin-provider", amount: 4, description: "test" });
    await f.wallet.finalizePurchase({ order_id: "admin-provider", user_id: "u1", server_name: "s", external_order_id: "provider", cost: 4, otp: "", all_otps: [], status: "active" });
    let recorded = false;
    const handler = adminOrderFixture(f, {
      server: { api_cancel_url: "cancel" },
      cancelOrder: async (_server, id, options) => {
        assert.equal(id, "provider");
        assert.equal(options.requireConfirmation, true);
        return cancellation;
      },
      recordOrderSms: async (_order, otp, options) => {
        recorded = otp === "009876" && options.complete;
        if (recorded) Object.assign(f.tables.orders[0], { otp, all_otps: [otp], refund_issued: true, status: "completed" });
        return f.tables.orders[0];
      },
    });
    const result = response();
    await handler({ params: { id: "admin-provider" }, body: { status: "cancelled" } }, result);
    assert.equal(f.tables.users[0].balance, cancellation.success ? 10 : 6);
    assert.equal(f.tables.transactions.filter(tx => tx.type === "refund").length, cancellation.success ? 1 : 0);
    assert.equal(result.statusCode, cancellation.success ? 200 : 409);
    if (cancellation.otp) {
      assert.equal(recorded, true);
      assert.equal(f.tables.orders[0].status, "completed");
      assert.equal(f.tables.orders[0].otp, "009876");
    } else if (!cancellation.success) assert.equal(f.tables.orders[0].status, "active");
  }
});

test("expired orders are not refunded while provider cancellation is unconfirmed", async () => {
  const f = walletFixture();
  await f.wallet.reservePurchase({ userId: "u1", orderId: "expiry-failed-cancel", amount: 4, description: "test" });
  const order = await f.wallet.finalizePurchase({ order_id: "expiry-failed-cancel", user_id: "u1", server_name: "s", external_order_id: "expiry", cost: 4, otp: "", all_otps: [], status: "active", expires_at: new Date(0) });
  let calls = 0;
  const watcher = watcherFixture(f, async () => ({ status: "waiting" }), async () => { calls++; return { success: false }; });
  await watcher.syncOrder(order);
  assert.equal(calls, 1);
  assert.equal(f.tables.orders[0].status, "active");
  assert.equal(f.tables.users[0].balance, 6);
  assert.equal(f.tables.transactions.filter(tx => tx.type === "refund").length, 0);
});
