const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "utils/telegramNotifications.js"), "utf8");

function load(settings, overrides = {}) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require(name) {
      assert.equal(name, "./settingsCache");
      return { getCachedSettings: async () => settings };
    },
    fetch: global.fetch,
    AbortController,
    setTimeout,
    clearTimeout,
    JSON,
    String,
    console,
    ...overrides,
  }, { filename: "telegramNotifications.js" });
  return module.exports;
}

test("service-added notification sends the configured service and site names", async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const { notifyServiceAdded } = load({
    service_added_telegram_enabled: true,
    service_added_telegram_bot_token: "123456:abcdefghijklmnopqrstuvwxyz1234567890",
    service_added_telegram_chat_id: "@newservices",
    site_name: "Example OTP",
  });
  assert.equal((await notifyServiceAdded({ name: "WhatsApp" })).sent, true);
  assert.match(request.url, /\/sendMessage$/);
  assert.deepEqual(JSON.parse(request.options.body), {
    chat_id: "@newservices",
    text: "WhatsApp service added in Example OTP",
    disable_web_page_preview: true,
  });
});

test("network failures redact the token and the next queued notification can still send", async () => {
  const errors = [];
  let calls = 0;
  const { notifyServiceAdded } = load({
    service_added_telegram_enabled: true,
    service_added_telegram_bot_token: "secret-token",
    service_added_telegram_chat_id: "@channel",
  }, {
    console: { error: (...args) => errors.push(args.join(" ")) },
    fetch: async () => {
      if (++calls === 1) throw new Error("https://api.telegram.org/botsecret-token/sendMessage");
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  assert.equal((await notifyServiceAdded({ name: "A" })).reason, "request_failed");
  assert.equal((await notifyServiceAdded({ name: "B" })).sent, true);
  assert.doesNotMatch(errors.join(" "), /secret-token/);
});

test("bulk notifications are serialized and respect Telegram retry_after", async () => {
  let now = 10000;
  const jobs = new Map();
  let id = 0;
  const requests = [];
  const { notifyServiceAdded } = load({
    service_added_telegram_enabled: true,
    service_added_telegram_bot_token: "secret-token",
    service_added_telegram_chat_id: "@channel",
  }, {
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, ms) {
      const key = ++id;
      jobs.set(key, setImmediate(() => { jobs.delete(key); now += ms; fn(); }));
      return key;
    },
    clearTimeout(key) { clearImmediate(jobs.get(key)); jobs.delete(key); },
    fetch: async (url, options) => {
      requests.push({ at: now, text: JSON.parse(options.body).text });
      if (requests.length === 1) return {
        status: 429, ok: false, json: async () => ({ ok: false, parameters: { retry_after: 2 } }),
      };
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  const results = await Promise.all([notifyServiceAdded({ name: "A" }), notifyServiceAdded({ name: "B" })]);
  assert.ok(results.every(result => result.sent));
  assert.equal(requests.length, 3);
  assert.match(requests[0].text, /^A /);
  assert.match(requests[1].text, /^A /);
  assert.match(requests[2].text, /^B /);
  assert.ok(requests[1].at - requests[0].at >= 2000);
  assert.ok(requests[2].at - requests[1].at >= 1100);
  assert.equal(jobs.size, 0);
});

test("a stalled Telegram request is aborted after five seconds", async () => {
  let abort;
  const { notifyServiceAdded } = load({
    service_added_telegram_enabled: true,
    service_added_telegram_bot_token: "secret-token",
    service_added_telegram_chat_id: "@channel",
  }, {
    console: { error() {} },
    setTimeout(fn, ms) { assert.equal(ms, 5000); abort = fn; return 1; },
    clearTimeout() {},
    fetch: (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      abort();
    }),
  });
  assert.equal((await notifyServiceAdded({ name: "A" })).reason, "request_failed");
});

test("disabled and incomplete notification settings make no Telegram request", async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => { throw new Error("unexpected request"); };
  const disabled = load({ service_added_telegram_enabled: false }).notifyServiceAdded;
  assert.equal((await disabled({ name: "Service" })).reason, "disabled");
  const incomplete = load({ service_added_telegram_enabled: true }).notifyServiceAdded;
  assert.equal((await incomplete({ name: "Service" })).reason, "not_configured");
});

test("Telegram API rejection is reported without exposing the bot token in logs", async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => ({ ok: false, json: async () => ({ ok: false, description: "chat not found" }) });
  const errors = [];
  const { notifyServiceAdded } = load({
    service_added_telegram_enabled: "true",
    service_added_telegram_bot_token: "123456:abcdefghijklmnopqrstuvwxyz1234567890",
    service_added_telegram_chat_id: "-1001234567890",
  });
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    assert.equal((await notifyServiceAdded({ name: "Service" })).reason, "telegram_rejected");
  } finally {
    console.error = originalError;
  }
  assert.doesNotMatch(errors.join(" "), /abcdefghijklmnopqrstuvwxyz/);
});

const TOKEN_KEY = "service_added_telegram_bot_token";
const CHAT_KEY = "service_added_telegram_chat_id";
const ENABLED_KEY = "service_added_telegram_enabled";
const validToken = "123456:abcdefghijklmnopqrstuvwxyz1234567890";

function settingsPage(initial) {
  const html = fs.readFileSync(path.join(root, "views/admin/settings.html"), "utf8");
  const elements = new Map();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    const classes = new Set();
    elements.set(match[1], {
      value: "", checked: false, style: {}, textContent: "", innerHTML: "",
      classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key) },
    });
  }
  const posts = [], messages = [];
  const context = vm.createContext({
    document: {
      getElementById: id => elements.get(id), querySelectorAll: () => [], addEventListener() {},
      documentElement: { style: { setProperty() {} } },
    },
    requireAdmin: async () => false,
    API: { get: async () => initial, post: async (url, body) => posts.push({ url, body }) },
    toast: text => messages.push(text), console,
  });
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/src\s*=|application\/ld\+json/.test(match[1])) {
      vm.runInContext(match[2], context, { filename: "views/admin/settings.html" });
    }
  }
  return { elements, posts, messages, run: source => vm.runInContext(source, context) };
}

test("admin settings load, track edits, preserve the saved token and clear replacement secrets after saving", async () => {
  const page = settingsPage({ site_name: "My site", [ENABLED_KEY]: true, [CHAT_KEY]: "@channel", service_added_telegram_configured: true });
  await page.run("loadSettings()");
  assert.equal(page.elements.get("s-telegram-enabled").checked, true);
  assert.equal(page.elements.get("s-telegram-token").value, "");
  assert.equal(page.elements.get("s-telegram-chat").value, "@channel");
  await page.run("saveSettings()");
  assert.equal(page.posts.length, 1);
  assert.equal(page.posts[0].body[TOKEN_KEY], undefined);
  assert.equal(page.posts[0].body[ENABLED_KEY], true);
  page.elements.get("s-telegram-token").value = " " + validToken + " ";
  page.run("checkChanges()");
  assert.equal(page.elements.get("save-bar").classList.contains("visible"), true);
  await page.run("saveSettings()");
  assert.equal(page.posts[1].body[TOKEN_KEY], validToken);
  assert.equal(page.elements.get("s-telegram-token").value, "");
  page.run("checkChanges()");
  assert.equal(page.elements.get("save-bar").classList.contains("visible"), false);
  assert.match(page.elements.get("s-telegram-token-state").textContent, /token is saved/);
});

test("admin settings require credentials when enabling and discard unsaved channel edits", async () => {
  const page = settingsPage({});
  await page.run("loadSettings()");
  page.elements.get("s-telegram-enabled").checked = true;
  page.elements.get("s-telegram-chat").value = "@channel";
  await page.run("saveSettings()");
  assert.equal(page.posts.length, 0);
  assert.match(page.messages.at(-1), /bot token and channel ID/);
  await page.run("loadSettings()");
  assert.equal(page.elements.get("s-telegram-enabled").checked, false);
  assert.equal(page.elements.get("s-telegram-chat").value, "");
});

function admin(dbType, initial = {}, models = {}, files) {
  const values = new Map(Object.entries(initial));
  const announcements = [];
  let invalidations = 0;
  const notifications = {
    BOT_TOKEN_KEY: TOKEN_KEY, CHAT_ID_KEY: CHAT_KEY, ENABLED_KEY,
    isConfigured: value => value === true || value === "true",
    notifyServiceAdded: async service => { announcements.push(service.name); },
  };
  const row = key => values.has(key) ? { key, value: values.get(key), update: async ({ value }) => values.set(key, value) } : null;
  const Setting = {
    find: async () => [...values].map(([key, value]) => ({ key, value })),
    findOne: async query => row(query.where?.key || query.key),
    create: async ({ key, value }) => values.set(key, value),
    destroy: async () => {}, deleteMany: async () => {},
    bulkWrite: async ops => ops.forEach(({ updateOne: op }) => values.set(op.filter.key, op.update.$set.value)),
  };
  const module = { exports: {} };
  const authorization = (req, res, next) => next();
  vm.runInNewContext(fs.readFileSync(path.join(root, "routes/admin.js"), "utf8"), {
    module, __dirname: path.join(root, "routes"), process: { env: {} },
    console: { error() {}, log() {} },
    require(name) {
      if (name === "../models/Setting") return Setting;
      if (name.startsWith("../models/")) return models[path.basename(name)] || {};
      if (name === "../middleware/auth") return { adminRequired: authorization };
      if (name === "../utils/db") return { DB_TYPE: dbType };
      if (name === "../utils/telegramNotifications") return notifications;
      if (name === "../utils/settingsCache") return { clearSettingsCache: () => invalidations++ };
      if (name === "../utils/apiCache") return { clearCache() {} };
      if (name === "../utils/realtimeEmitter") return { emitToAll() {} };
      if (name === "../utils/adminRealtime") return { streamAdminChanges() {} };
      if (name.startsWith("../utils/")) return {};
      if (name === "fs" && files) return files;
      return require(name);
    },
  }, { filename: "routes/admin.js" });
  const router = module.exports;
  return {
    values, announcements, notifications,
    get invalidations() { return invalidations; },
    async call(method, url, body = {}, params = {}) {
      const route = router.stack.find(layer => layer.route?.path === url && layer.route.methods[method]).route;
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
      await route.stack.at(-1).handle({ body, params }, res);
      await Promise.resolve();
      return res;
    },
  };
}

for (const dbType of ["mongodb", "mysql"]) {
  test(dbType + ": settings hide and preserve the bot token while allowing replacement", async () => {
    const app = admin(dbType, { [TOKEN_KEY]: validToken, [CHAT_KEY]: "@channel", [ENABLED_KEY]: true });
    let response = await app.call("get", "/settings");
    assert.equal(response.data[TOKEN_KEY], undefined);
    assert.equal(response.data.service_added_telegram_configured, true);
    response = await app.call("post", "/settings", { [TOKEN_KEY]: "   ", [CHAT_KEY]: " -1001234567890 ", [ENABLED_KEY]: true });
    assert.equal(response.statusCode, 200);
    assert.equal(app.values.get(TOKEN_KEY), validToken);
    assert.equal(app.values.get(CHAT_KEY), "-1001234567890");
    const replacement = validToken + "NEW";
    response = await app.call("post", "/settings", { [TOKEN_KEY]: " " + replacement + " " });
    assert.equal(response.statusCode, 200);
    assert.equal(app.values.get(TOKEN_KEY), replacement);
    assert.equal(app.invalidations, 2);
  });

  test(dbType + ": invalid and incomplete Telegram settings are rejected before saving", async () => {
    const app = admin(dbType);
    assert.equal((await app.call("get", "/settings")).data.service_added_telegram_configured, false);
    for (const body of [
      { [TOKEN_KEY]: "invalid" }, { [TOKEN_KEY]: null }, { [CHAT_KEY]: "https://t.me/channel" },
      { [CHAT_KEY]: {} }, { [ENABLED_KEY]: "yes" }, { [ENABLED_KEY]: true },
      { [ENABLED_KEY]: true, [TOKEN_KEY]: validToken },
    ]) {
      assert.equal((await app.call("post", "/settings", body)).statusCode, 400);
      assert.equal(app.values.size, 0);
    }
    assert.equal((await app.call("post", "/settings", {
      [TOKEN_KEY]: validToken, [CHAT_KEY]: "@channel", [ENABLED_KEY]: true,
    })).statusCode, 200);
    assert.equal(app.values.get(ENABLED_KEY), true);
  });

  test(dbType + ": only successful new service creation announces; failures do not block creation", async () => {
    let duplicate = false, fail = false;
    const service = { name: "Existing", server_id: "s1", service_code: "old", save: async () => {} };
    const app = admin(dbType, {}, {
      Service: {
        findOne: async () => duplicate ? service : null,
        create: async data => { if (fail) throw new Error("Database write failed"); return data; },
        findById: async () => service,
      },
      Server: {
        findByPk: async () => ({ id: "s1", country_id: "c1" }),
        findById: () => ({ populate: async () => ({ _id: "s1", country_id: { code: "IN" } }) }),
      },
      Country: { findByPk: async () => ({ code: "IN" }) },
    });
    const body = { name: "New service", server_id: "s1", service_code: "new", price: "10", is_active: "true" };
    assert.equal((await app.call("post", "/services", body)).statusCode, 201);
    assert.deepEqual(app.announcements, ["New service"]);
    duplicate = true;
    assert.equal((await app.call("post", "/services", body)).statusCode, 400);
    duplicate = false; fail = true;
    assert.equal((await app.call("post", "/services", body)).statusCode, 400);
    assert.deepEqual(app.announcements, ["New service"]);
    assert.equal((await app.call("put", "/services/:id", { name: "Renamed" }, { id: "1" })).statusCode, 200);
    assert.deepEqual(app.announcements, ["New service"]);
    fail = false;
    app.notifications.notifyServiceAdded = async () => { throw new Error("Telegram unavailable"); };
    assert.equal((await app.call("post", "/services", body)).statusCode, 201);
  });

  test(dbType + ": auto-add announces only new services and skips duplicate import rows", async () => {
    const stored = [{ name: "Existing", service_code: "old" }];
    const catalog = [
      { name: "Existing", code: "old" }, { name: "New", code: "new" },
      { name: "NEW", code: "new" }, { name: "Other", code: "other" },
    ];
    const app = admin(dbType, {}, {
      Server: { findByIdAndUpdate: async () => ({ id: "s1" }) },
      Service: { find: async () => stored, insertMany: async rows => { stored.push(...rows); return rows; } },
    }, { existsSync: () => true, readFileSync: () => JSON.stringify(catalog) });
    const body = { country_id: "c1", auto_add_services: true, provider_country_code: "IN" };
    assert.equal((await app.call("put", "/servers/:id", body, { id: "s1" })).statusCode, 200);
    assert.deepEqual(app.announcements, ["New", "Other"]);
    assert.equal((await app.call("put", "/servers/:id", body, { id: "s1" })).statusCode, 200);
    assert.deepEqual(app.announcements, ["New", "Other"]);
  });
}
