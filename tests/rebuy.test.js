const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "utils/rebuy.js"), "utf8");

function fixture({ reserveError, providerResult, cancelResult, finalizeError } = {}) {
  const original = {
    _id: "old-db-id", order_id: "ORD-OLD", user_id: "user-1", service_id: "service-1",
    service_name: "Messenger", service_image: "", service_color: "", server_name: "Server A",
    external_order_id: "provider-old", country: "22", phone: "+919876543210", cost: 6,
    status: "cancelled", refund_issued: true, otp: "", all_otps: [], rebuy_order_id: "",
  };
  const calls = { filters: [], reserved: [], finalized: [], reversed: [], provider: [], cancelled: [], ledger: [] };
  const matches = (row, query) => Object.entries(query).every(([key, value]) => {
    if (key === "$or") return value.some(q => matches(row, q));
    if (key === "$and") return value.every(q => matches(row, q));
    if (value && typeof value === "object") return Object.entries(value).every(([op, target]) => {
      if (op === "$ne") return row[key] !== target;
      if (op === "$in") return target.includes(row[key]);
      throw new Error("Unsupported operator: " + op);
    });
    return value === null ? row[key] == null : row[key] === value;
  });
  const Order = {
    findOne: async filter => {
      calls.filters.push(filter);
      if (!matches(original, filter)) return null;
      return original;
    },
    findOneAndUpdate: async (filter, update) => {
      calls.filters.push(filter);
      if (!matches(original, filter)) return null;
      Object.assign(original, update.$set);
      return original;
    },
  };
  const wallet = {
    hasOtp: order => Boolean(order?.otp || order?.all_otps?.length),
    otpHistory: order => Array.isArray(order?.all_otps) ? order.all_otps : [],
    reservePurchase: async args => {
      calls.reserved.push(args);
      if (reserveError) throw new Error(reserveError);
      return { balance: 14 };
    },
    finalizePurchase: async order => { calls.finalized.push(order); if (finalizeError) throw new Error(finalizeError); return order; },
    reversePurchase: async id => { calls.reversed.push(id); return true; },
  };
  const dependencies = {
    "../models/Order": Order,
    "../models/Server": { findOne: async () => ({ name: "Server A", is_active: true, api_rebuy_url: "https://provider.example/rebuy", api_cancel_url: "https://provider.example/cancel", auto_cancel_minutes: 20, min_cancel_minutes: 0, check_interval: 3 }) },
    "../models/Service": { findById: async () => ({ service_code: "msg" }) },
    "../models/Transaction": { findOne: async filter => { calls.ledger.push(filter); return filter.type === "purchase" ? { amount: -6 } : { amount: 6 }; } },
    "../utils/wallet": wallet,
    "../utils/providerApi": {
      rebuyOrder: async (server, order) => { calls.provider.push({ server, order }); return providerResult || { api_order_id: "provider-new", phone: "919876543210" }; },
      cancelOrder: async (...args) => { calls.cancelled.push(args); return cancelResult || { success: true }; },
    },
    "../utils/orderLocks": { acquireLockWithTimeout: async () => true, releaseLock() {} },
  };
  let nextId = 0;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require(name) {
      if (name in dependencies) return dependencies[name];
      if (name === "nanoid") return { nanoid: () => ++nextId === 1 ? "NEW-ORDER-ID" : "OTHER-ORDER-ID" };
      if (name === "./wallet") return dependencies["../utils/wallet"];
      if (name === "./providerApi") return dependencies["../utils/providerApi"];
      if (name === "./providerOrderId") return { providerOrderId: order => String(order?.provider_order_id || order?.external_order_id || "").trim() };
      if (name === "./providerWebhookQueue") return { retryForOrder: async () => 0 };
      if (name === "./orderLocks") return dependencies["../utils/orderLocks"];
      if (name === "./money") return require("../utils/money");
      return require(name);
    },
    Date, String, Boolean, Number, Error, Set, Promise,
  }, { filename: "utils/rebuy.js" });
  return { rebuy: module.exports.rebuyCancelledOrder, cancel: module.exports.cancelCompletedOrderForRebuy, original, calls, dependencies };
}

test("completed OTP order requires confirmed cancellation, retains its paid history and rebuys as a new purchase", async () => {
  const f = fixture();
  Object.assign(f.original, { status: "completed", otp: "1234", all_otps: ["1234"], rebuy_cancelled: false });
  const args = { orderId: "ORD-OLD", userId: "user-1" };
  await assert.rejects(f.rebuy(args), /ORDER_NOT_REBUYABLE/);
  await assert.rejects(f.cancel({ ...args, userId: "attacker" }), /ORDER_NOT_FOUND/);
  assert.equal(f.calls.cancelled.length, 0);
  await f.cancel(args);
    assert.equal(f.calls.cancelled[0][2].requireConfirmation, true);
    assert.equal(f.calls.cancelled[0][2].allowMissing, true);
  assert.equal(f.original.status, "completed");
  assert.equal(f.original.otp, "1234");
  assert.deepEqual(f.original.all_otps, ["1234"]);
  assert.equal(f.original.refund_issued, true);
  assert.equal(f.original.rebuy_cancelled, true);
  assert.equal(f.calls.reserved.length, 0);
  assert.equal(f.calls.reversed.length, 0);
  await assert.rejects(f.cancel(args), /ORDER_NOT_CANCELLABLE_FOR_REBUY/);
  const result = await f.rebuy(args);
  assert.equal(result.order.status, "active");
  assert.equal(result.order.otp, "");
  assert.equal(result.order.all_otps.length, 0);
  assert.equal(result.order.refund_issued, false);
  assert.equal(result.order.rebuy_of, "ORD-OLD");
  assert.equal(f.calls.reserved[0].amount, 6);
  assert.equal(f.calls.ledger.some(q => q.type === "refund"), false);
  assert.equal(f.original.status, "completed");
  assert.equal(f.original.otp, "1234");
});

test("failed provider cancellation never enables rebuy or changes the original OTP", async () => {
  const f = fixture({ cancelResult: { success: false } });
  Object.assign(f.original, { status: "completed", otp: "1234", rebuy_cancelled: false });
  await assert.rejects(f.cancel({ orderId: "ORD-OLD", userId: "user-1" }), /PROVIDER_CANCEL_FAILED/);
  assert.equal(f.original.rebuy_cancelled, false);
  assert.equal(f.original.status, "completed");
  assert.equal(f.original.otp, "1234");
  assert.equal(f.calls.reserved.length, 0);
});

test("a duplicate provider activation is never cancelled as failed-rebuy compensation", async () => {
  const f = fixture({ finalizeError: "DUPLICATE_EXTERNAL_ORDER" });
  await assert.rejects(f.rebuy({ orderId: "ORD-OLD", userId: "user-1" }), /DUPLICATE_EXTERNAL_ORDER/);
  assert.equal(f.calls.cancelled.length, 1);
  assert.equal(f.calls.cancelled[0][1], "provider-old");
  assert.equal(f.calls.reversed.length, 1);
  assert.equal(f.original.rebuy_order_id, "");
});

test("rebuy charges a new purchase and creates a new order with the original number", async () => {
  const f = fixture();
  const result = await f.rebuy({ orderId: "ORD-OLD", userId: "user-1" });
  assert.equal(result.order.phone, f.original.phone);
  assert.equal(result.order.rebuy_of, "ORD-OLD");
  assert.equal(result.order.order_id, "ORD-NEW-ORDER-ID");
  assert.equal(result.balance, 14);
  assert.equal(f.calls.reserved[0].amount, 6);
  assert.equal(f.calls.provider[0].order.external_order_id, "provider-old");
  assert.equal(f.original.rebuy_order_id, "ORD-NEW-ORDER-ID");
});

test("rebuy is owner-scoped, claim-once, and rejects orders that already received an OTP", async () => {
  const f = fixture();
  await assert.rejects(f.rebuy({ orderId: "ORD-OLD", userId: "someone-else" }), /ORDER_NOT_FOUND/);
  f.original.otp = "123456";
  await assert.rejects(f.rebuy({ orderId: "ORD-OLD", userId: "user-1" }), /ORDER_NOT_REBUYABLE/);
  f.original.otp = "";
  f.original.rebuy_order_id = "ORD-ALREADY";
  await assert.rejects(f.rebuy({ orderId: "ORD-OLD", userId: "user-1" }), /REBUY_ALREADY_USED/);
  assert.equal(f.calls.reserved.length, 0);
});

test("failed rebuy reverses the reserved debit and releases the one-time claim", async () => {
  const f = fixture({ providerResult: { error: "Provider unavailable", no_allocation: true } });
  await assert.rejects(f.rebuy({ orderId: "ORD-OLD", userId: "user-1" }), /PROVIDER_REBUY_FAILED/);
  assert.deepEqual(f.calls.reversed, ["ORD-NEW-ORDER-ID"]);
  assert.equal(f.original.rebuy_order_id, "");
  assert.equal(f.calls.finalized.length, 0);
});

test("rebuy rejects provider phone mismatches and insufficient wallet balance", async () => {
  const mismatch = fixture({ providerResult: { api_order_id: "new", phone: "911111111111" } });
  await assert.rejects(mismatch.rebuy({ orderId: "ORD-OLD", userId: "user-1" }), /PROVIDER_NUMBER_MISMATCH/);
  assert.equal(mismatch.original.rebuy_order_id, "");
  const poor = fixture({ reserveError: "INSUFFICIENT_BALANCE" });
  await assert.rejects(poor.rebuy({ orderId: "ORD-OLD", userId: "user-1" }), /INSUFFICIENT_BALANCE/);
  assert.equal(poor.original.rebuy_order_id, "");
  assert.equal(poor.calls.provider.length, 0);
});

test("API docs publish rebuy action, internal order ID and response contract", () => {
  const html = fs.readFileSync(path.join(root, "views/api-docs.html"), "utf8");
  assert.match(html, /action=rebuy&amp;id=\$id/);
  assert.match(html, /ACCESS_NUMBER:new_id:phone/);
});

test("simultaneous rebuy calls allocate once and return the losing debit", async () => {
  const f = fixture();
  const args = { orderId: "ORD-OLD", userId: "user-1" };
  const results = await Promise.allSettled([f.rebuy(args), f.rebuy(args)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(f.calls.provider.length, 1);
  assert.equal(f.calls.reversed.length, 1);
  assert.equal(f.original.rebuy_order_id, "ORD-NEW-ORDER-ID");
});

test("refunded rebuy confirms cancellation before allocation and reverses failed confirmation", async () => {
  const f = fixture({ cancelResult: { success: false } });
  await assert.rejects(f.rebuy({ orderId: "ORD-OLD", userId: "user-1" }), /PROVIDER_CANCEL_FAILED/);
  assert.equal(f.calls.provider.length, 0);
  assert.equal(f.calls.reserved.length, 1);
  assert.equal(f.calls.reversed.length, 1);
  assert.equal(f.original.rebuy_order_id, "");
});

test("ambiguous provider rebuy failure reverses the debit but retains its one-time claim", async () => {
  const f = fixture({ providerResult: { error: "Malformed response" } });
  await assert.rejects(f.rebuy({ orderId: "ORD-OLD", userId: "user-1" }), /PROVIDER_REBUY_FAILED/);
  assert.equal(f.calls.reversed.length, 1);
  assert.equal(f.calls.cancelled.length, 1);
  assert.equal(f.calls.cancelled[0][1], "provider-old");
  assert.equal(f.original.rebuy_order_id, "ORD-NEW-ORDER-ID");
});

test("failed rebuy waits for provider cleanup before releasing the parent claim", async () => {
  const f = fixture({ providerResult: { api_order_id: "new-bad", phone: "1111111111" } });
  let cleanupStarted, finish;
  const started = new Promise(resolve => { cleanupStarted = resolve; });
  f.dependencies["../utils/providerApi"].cancelOrder = async (_server, id) => {
    if (id === "provider-old") return { success: true };
    cleanupStarted();
    return new Promise(resolve => { finish = resolve; });
  };
  const rebuy = f.rebuy({ orderId: "ORD-OLD", userId: "user-1" });
  await started;
  assert.equal(f.original.rebuy_order_id, "ORD-NEW-ORDER-ID");
  finish({ success: true });
  await assert.rejects(rebuy, /PROVIDER_NUMBER_MISMATCH/);
  assert.equal(f.original.rebuy_order_id, "");
});

test("provider cleanup failure retains the parent claim to prevent a duplicate allocation", async () => {
  const f = fixture({ providerResult: { api_order_id: "new-bad", phone: "1111111111" } });
  f.dependencies["../utils/providerApi"].cancelOrder = async (_server, id) =>
    id === "provider-old" ? { success: true } : { success: false };
  await assert.rejects(f.rebuy({ orderId: "ORD-OLD", userId: "user-1" }), /PROVIDER_NUMBER_MISMATCH/);
  assert.equal(f.calls.reversed.length, 1);
  assert.equal(f.original.rebuy_order_id, "ORD-NEW-ORDER-ID");
});

test("rebuy carries previous activation OTPs through successive rebuys without exposing them as new SMS", async () => {
  const f = fixture();
  Object.assign(f.original, { status: "completed", otp: "1234", all_otps: ["1234", "5678"], rebuy_cancelled: true, rebuy_ignored_otps: ["0000"] });
  const result = await f.rebuy({ orderId: "ORD-OLD", userId: "user-1" });
  assert.deepEqual([...result.order.rebuy_ignored_otps].sort(), ["0000", "1234", "5678"]);
  assert.equal(result.order.all_otps.length, 0);
  assert.equal(result.order.otp, "");
});

test("Buy page loads six orders at a time and reveals rebuy only after cancellation succeeds", async () => {
  const html = fs.readFileSync(path.join(root, "views/buy.html"), "utf8");
  const script = html.slice(html.indexOf("  let rebuyPage ="), html.indexOf("  window.initBuy ="));
  const element = () => ({ children: [], disabled: false, hidden: false,
    append(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
  });
  const elements = { "rebuy-orders": element(), "rebuy-load-more": element(), "rebuy-panel": element() };
  const rows = Array.from({ length: 12 }, (_, i) => ({ order_id: `order-${i}`, phone: "919876543210",
    service_name: "Messenger", status: "completed", cost: 6, can_rebuy: false, can_rebuy_after_cancel: true }));
  const calls = [];
  const window = { location: {}, addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(script, { window,
    document: { getElementById: id => elements[id], createElement: element },
    API: {
      get: async url => { calls.push(url); const page = Number(new URL(url, "https://test.example").searchParams.get("page")); return { orders: rows.slice((page - 1) * 6, page * 6).map(o => ({ ...o })), pages: 2 }; },
      post: async url => { calls.push(url); if (url.endsWith("/cancel-for-rebuy")) { rows[0].can_rebuy = true; rows[0].can_rebuy_after_cancel = false; return { success: true }; } return { order: { order_id: "new-order" } }; },
    }, uiConfirm: async () => true, toast() {}, fmtMoney: value => `INR ${value}`, URL,
  });
  await window.loadBuyRebuyOrders(true);
  assert.equal(elements["rebuy-orders"].children.length, 6);
  assert.equal(elements["rebuy-load-more"].hidden, false);
  assert.ok(calls[0].includes("limit=6&page=1"));
  await window.loadBuyRebuyOrders(false);
  assert.equal(elements["rebuy-orders"].children.length, 12);
  assert.equal(elements["rebuy-load-more"].hidden, true);
  const cancelButton = elements["rebuy-orders"].children[0].children[1];
  assert.equal(cancelButton.textContent, "Cancel for rebuy");
  await cancelButton.onclick();
  assert.ok(calls.includes("/api/user/orders/order-0/cancel-for-rebuy"));
  const rebuyButton = elements["rebuy-orders"].children[0].children[1];
  assert.equal(rebuyButton.textContent, "Rebuy same number");
  await rebuyButton.onclick();
  assert.ok(calls.includes("/api/user/orders/order-0/rebuy"));
  assert.equal(window.location.href, "/dashboard/orders/new-order");
});
