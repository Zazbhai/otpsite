const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createHmac } = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const dns = require("node:dns").promises;
const https = require("node:https");
const { test } = require("node:test");
const { buildSmsPayload, deliverWebhook, parseWebhookUrl } = require("../utils/customerWebhook");

test("signs the exact SMS Candy payload and treats redirects as delivery failures", async t => {
  const url = "https://receiver.example/sms";
  const payload = buildSmsPayload({
    order_id: "ORD-SAMPLE", service_name: "WhatsApp", country: "India",
    phone: "919000000000", cost: 12.50,
  }, "Notice from 2026. Your verification code is: 001234.");
  assert.equal(payload.code, "001234");
  assert.equal(payload.number, "+919000000000");
  assert.equal(payload.customer, null);
  assert.equal(payload.message, "Notice from 2026. Your verification code is: 001234.");
  const originalLookup = dns.lookup;
  const originalRequest = https.request;
  let statusCode = 204;
  let requests = 0;
  dns.lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  https.request = (destination, options, respond) => {
    requests++;
    assert.equal(destination.href, url);
    assert.equal(options.method, "POST");
    assert.equal(options.headers["X-SmsCandy-Event"], "sms.received");
    options.lookup(destination.hostname, {}, (_err, address, family) => {
      assert.equal(address, "93.184.216.34");
      assert.equal(family, 4);
    });
    return Object.assign(new EventEmitter(), {
      end(body) {
        assert.equal(body, JSON.stringify(payload));
        assert.equal(options.headers["X-SmsCandy-Signature"], createHmac("sha256", "test-key").update(body).digest("hex"));
        respond({ statusCode, destroy() {} });
      },
    });
  };
  t.after(() => { dns.lookup = originalLookup; https.request = originalRequest; });
  assert.deepEqual(await deliverWebhook(url, "test-key", payload), { ok: true, status: 204 });
  statusCode = 302;
  assert.deepEqual(await deliverWebhook(url, "test-key", payload), { ok: false, status: 302 });
  assert.equal(requests, 2);
});

test("declines nonpublic callback destinations before making an HTTP request", async t => {
  assert.throws(() => parseWebhookUrl("http://receiver.example/sms"));
  assert.throws(() => parseWebhookUrl("https://127.0.0.1/sms"));
  assert.throws(() => parseWebhookUrl("https://user:secret@receiver.example/sms"));
  const originalLookup = dns.lookup;
  const originalRequest = https.request;
  let madeRequest = false;
  https.request = () => { madeRequest = true; };
  t.after(() => { dns.lookup = originalLookup; https.request = originalRequest; });
  for (const [address, family] of [["127.0.0.1", 4], ["10.0.0.1", 4], ["::ffff:127.0.0.1", 6], ["fd00::1", 6]]) {
    dns.lookup = async () => [{ address: "93.184.216.34", family: 4 }, { address, family }];
    const result = await deliverWebhook("https://receiver.example/sms", "test-key", {});
    assert.match(result.error, /public addresses/);
  }
  assert.equal(madeRequest, false);
});

test("new SMS messages notify the order owner once and only after they are saved", async () => {
  const path = require.resolve("../utils/orderSms");
  const stored = {
    _id: "db-order", order_id: "ORD-SAMPLE", user_id: "owner", service_name: "WhatsApp",
    country: "22", phone: "919000000000", cost: 10, status: "active", otp: "", all_otps: [],
  };
  const events = [];
  const deliveries = [];
  const modules = {
    "../models/Order": {
      async findOneAndUpdate(filter, update) {
        assert.equal(filter._id, stored._id);
        if (stored.status !== filter.status || stored.otp === filter.otp.$ne || stored.all_otps.includes(filter.all_otps.$ne)) return null;
        Object.assign(stored, update.$set);
        stored.all_otps.push(update.$addToSet.all_otps);
        events.push("saved");
        return { ...stored };
      },
    },
    "../models/User": {
      findById(id) {
        assert.equal(id, "owner");
        return { select: async () => ({ api_key: "owner-key" }) };
      },
    },
    "../models/Country": { findOne: () => ({ select: async () => ({ name: "India" }) }) },
    "../models/UserWebhook": {
      async findOne(filter) {
        assert.equal(filter.user_id, "owner");
        return { url: "https://receiver.example/sms" };
      },
    },
    "./db": { DB_TYPE: "mongodb" },
    "./customerWebhook": {
      buildSmsPayload,
      async deliverWebhook(url, key, payload) {
        assert.equal(url, "https://receiver.example/sms");
        assert.equal(key, "owner-key");
        assert.equal(events.at(-1), "realtime");
        deliveries.push(payload);
        return { ok: true, status: 204 };
      },
    },
    "./realtimeEmitter": {
      emitToUser(id) {
        assert.equal(id, "owner");
        assert.equal(events.at(-1), "saved");
        events.push("realtime");
      },
    },
  };
  const moduleShim = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path, "utf8"), { module: moduleShim, require: name => modules[name], console });
  const { recordOrderSms } = moduleShim.exports;
  const first = await Promise.all([recordOrderSms(stored, "001234"), recordOrderSms(stored, "001234")]);
  assert.equal(first.filter(Boolean).length, 1);
  await recordOrderSms(stored, "654321");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(deliveries.map(({ code }) => code), ["001234", "654321"]);
  assert.equal(deliveries[0].country, "India");
  assert.equal(stored.refund_issued, true);
});
