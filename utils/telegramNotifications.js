const { getCachedSettings } = require("./settingsCache");

const BOT_TOKEN_KEY = "service_added_telegram_bot_token";
const CHAT_ID_KEY = "service_added_telegram_chat_id";
const ENABLED_KEY = "service_added_telegram_enabled";

function isConfigured(value) {
  return value === true || value === "true";
}

let pending = Promise.resolve();
let lastAttempt = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function priceValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? Math.round(price * 10000) / 10000 : null;
}

function formatPrice(value) {
  const price = priceValue(value);
  return price === null ? "Not set" : "INR " + price.toFixed(4).replace(/(\.\d{2})0+$/, "$1");
}

const line = value => String(value || "").replace(/[\r\n\t]/g, " ").trim().slice(0, 200);

function websiteUrl(settings, fallback) {
  const env = typeof process === "undefined" ? {} : process.env;
  for (const candidate of [settings.site_url, env.SITE_URL, env.WEBSITE_URL, fallback]) {
    try {
      const url = new URL(String(candidate || "").trim());
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
      url.search = "";
      url.hash = "";
      return url.href.replace(/\/$/, "");
    } catch {}
  }
  return "";
}

// Snapshot mutable model fields before waiting in the shared Telegram queue.
function queueNotification(type, service, context, previousPrice) {
  const snapshot = {
    name: line(service?.name) || "New service", price: service?.price,
    country: line(service?.country_code), server: line(context?.serverName),
    siteUrl: context?.siteUrl, previousPrice,
  };
  const notification = pending.then(() => sendServiceNotification(type, snapshot));
  pending = notification.catch(() => {});
  return notification;
}

// Telegram limits messages to a single channel; serialize additions and updates.
function notifyServiceAdded(service, context = {}) {
  return queueNotification("added", service, context);
}

function notifyServicePriceUpdated(service, previousPrice, context = {}) {
  const before = priceValue(previousPrice);
  const after = priceValue(service?.price);
  if (before === null || after === null || before === after) {
    return Promise.resolve({ sent: false, reason: "price_unchanged_or_invalid" });
  }
  return queueNotification("price", service, context, before);
}

async function sendServiceNotification(type, service) {
  const settings = await getCachedSettings();
  if (!isConfigured(settings[ENABLED_KEY])) return { sent: false, reason: "disabled" };

  const token = String(settings[BOT_TOKEN_KEY] || "").trim();
  const chatId = String(settings[CHAT_ID_KEY] || "").trim();
  if (!token || !chatId) return { sent: false, reason: "not_configured" };

  const siteName = line(settings.site_name) || "Our site";
  const lines = [
    type === "price" ? "\uD83D\uDCB8 Service price updated!" : "\uD83C\uDF89 New service added!",
    "\uD83C\uDF10 " + siteName,
    "\uD83D\uDCF1 Service: " + service.name,
  ];
  if (service.server) lines.push("\uD83D\uDDA5 Server: " + service.server);
  if (service.country) lines.push("\uD83C\uDF0D Country: " + service.country);
  if (type === "price") {
    lines.push("\uD83D\uDCB0 Previous price: " + formatPrice(service.previousPrice));
    lines.push("\u2728 Updated price: " + formatPrice(service.price));
  } else {
    lines.push("\uD83D\uDCB0 Service price: " + formatPrice(service.price));
  }
  const url = websiteUrl(settings, service.siteUrl);
  if (url) lines.push("\uD83D\uDD17 Visit website: " + url);
  lines.push("Prices shown are standard service prices before personal discounts.");
  const delay = lastAttempt + 1100 - Date.now();
  if (delay > 0) await pause(delay);
  return requestMessage(token, chatId, lines.join("\n"), true);
}

async function requestMessage(token, chatId, text, allowRetry) {
  lastAttempt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    const retryAfter = Number(result.parameters?.retry_after);
    if ((response.status === 429 || result.error_code === 429) && allowRetry &&
        Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 60) {
      clearTimeout(timeout);
      await pause(Math.max(1100, retryAfter * 1000));
      return requestMessage(token, chatId, text, false);
    }
    if (!response.ok || result.ok !== true) {
      console.error("[Telegram service notification] Telegram rejected the message.");
      return { sent: false, reason: "telegram_rejected" };
    }
    return { sent: true };
  } catch (error) {
    // Fetch errors can contain the request URL, which includes the bot token.
    console.error("[Telegram service notification] Request failed:", error.name || "Error");
    return { sent: false, reason: "request_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  BOT_TOKEN_KEY,
  CHAT_ID_KEY,
  ENABLED_KEY,
  isConfigured,
  notifyServiceAdded,
  notifyServicePriceUpdated,
};
