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

// Telegram limits messages to a single channel; serialize bulk service imports.
function notifyServiceAdded(service) {
  const name = service?.name;
  const notification = pending.then(() => sendServiceAdded({ name }));
  pending = notification.catch(() => {});
  return notification;
}

async function sendServiceAdded(service) {
  const settings = await getCachedSettings();
  if (!isConfigured(settings[ENABLED_KEY])) return { sent: false, reason: "disabled" };

  const token = String(settings[BOT_TOKEN_KEY] || "").trim();
  const chatId = String(settings[CHAT_ID_KEY] || "").trim();
  if (!token || !chatId) return { sent: false, reason: "not_configured" };

  const siteName = String(settings.site_name || "").trim() || "Our site";
  const serviceName = String(service?.name || "New");
  const delay = lastAttempt + 1100 - Date.now();
  if (delay > 0) await pause(delay);
  return requestMessage(token, chatId, serviceName + " service added in " + siteName, true);
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
};
