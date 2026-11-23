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
    const current = row[key];
    if (value && typeof value === "object" && !(value instanceof Date)) {
      return Object.entries(value).every(([op, target]) => {
        if (op === "$gte") return current >= target;
        if (op === "$lt") return new Date(current) < target;
        if (op === "$ne") return current !== target;
        if (op === "$in") return target.includes(current);
        throw new Error("Unsupported test operator " + op);
      });
    }
    return current === value;
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
  const wallet = moduleFrom("utils/wallet.js", {
    "../models/User": models.User, "../models/Order": models.Order, "../models/Transaction": models.Transaction,
    "./db": db, "./referralBonus": { processReferralBonus: async (user, base, had) => bonuses.push({ base, had }) },
    "./realtimeEmitter": { emitToUser() {} },
  });
  return { wallet, tables, models, db, bonuses, failLedger(value) { failLedger = value; } };
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

function watcherFixture(f, checkStatus) {
  return moduleFrom("utils/orderStatusManager.js", {
    "../models/Order": f.models.Order,
    "../models/Server": { findOne: async () => ({ api_check_status_url: "provider", api_cancel_url: "cancel" }) },
    "./wallet": f.wallet, "./realtimeEmitter": { emitToUser() {} },
    "./orderSms": { recordOrderSms: async (order, otp) => f.models.Order.findOneAndUpdate({ _id: order._id, status: "active" }, { $set: { otp, all_otps: [otp], refund_issued: true } }) },
    "./providerApi": { checkStatus, cancelOrder: async () => ({}) },
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

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, set() { return this; } };
}

function routesFixture(f, getNumber) {
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
    "../models/User": f.models.User, "../models/Order": f.models.Order, "../models/Transaction": f.models.Transaction,
    "../models/Service": { findById: async () => service, find: () => ({ sort: async () => [service] }) },
    "../models/Server": { findById: async () => server },
    "../utils/providerApi": { getNumber, cancelOrder: async () => ({}) },
    "../middleware/auth": { loginRequired() {}, optionalLogin() {} },
    "../utils/realtimeEmitter": { emitToUser() {} }, "../utils/adminRealtime": { notifyAdminChange() {} },
    "../utils/orderSms": {}, "../utils/bharatpe": {}, "../utils/paytm": {}, "../utils/omnipay": {}, "../utils/heleket": {}, "../utils/eaglepay": {},
    "../models/Country": {}, "../models/Setting": {}, "../models/UserWebhook": {}, "../models/PromoCode": {},
  };
  const extra = { process: { env: { DB_TYPE: "mysql" } }, console: { log() {}, error() {}, warn() {} } };
  const user = moduleFrom("routes/user.js", dependencies, extra);
  const api = moduleFrom("routes/apiGateway.js", dependencies, extra);
  const handler = (router, route) => router.stack.find(layer => layer.route?.path === route).route.stack.at(-1).handle;
  return { purchase: handler(user, "/orders"), gateway: handler(api, "/") };
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
