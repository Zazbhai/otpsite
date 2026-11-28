/**
 * Provider API integration based on Master Reference Guide
 */
const fs = require('fs');
const path = require('path');
const { isProviderWebhookEnabled } = require("../public/js/provider-mode");

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '..', 'onlinesim');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DUP_FILE = path.join(DATA_DIR, 'duplicate_number_block.json');
const LOG_FILE = path.join(DATA_DIR, 'onlinesim_log.txt');
const appendProviderLog = require("./batchedLog").createBatchedLog((batch, done) => fs.appendFile(LOG_FILE, batch, error => {
  if (error) console.error("[Provider log write]", error.code || error.name);
  done();
}));

// Provider limits apply to the server/API key, not to an individual order.
// Back off all polling for this provider briefly after a 429 response.
const providerBackoff = new Map();
const PROVIDER_BACKOFF_MS = 10_000;
// Status checks run in the background. Bound only these calls so an
// unresponsive provider cannot permanently consume every polling worker.
const STATUS_REQUEST_TIMEOUT_MS = 30_000;

function providerKey(server) {
  return String(server?.api_check_status_url || server?.api_get_number_url || server?.name || "provider");
}

function isRateLimitedResponse(response) {
  const body = response?.data?.text || response?.data?.error || JSON.stringify(response?.data || "");
  return response?.status === 429 || /TOO[_ ]MANY[_ ]REQUESTS|too many requests|rate limit exceeded/i.test(String(body));
}

function getProviderBackoff(server) {
  const until = providerBackoff.get(providerKey(server)) || 0;
  return until > Date.now() ? until : 0;
}

function markProviderBackoff(server) {
  const until = Date.now() + PROVIDER_BACKOFF_MS;
  providerBackoff.set(providerKey(server), until);
  return until;
}

// Memory cache for speed, backed by file for persistence
let numberCache = new Map();
const DUPLICATE_WINDOW = 3 * 60 * 1000; 

// Load existing blocks on startup
try {
  if (fs.existsSync(DUP_FILE)) {
    const data = JSON.parse(fs.readFileSync(DUP_FILE, 'utf8'));
    const now = Date.now();
    data.forEach(item => {
      if (now - item.time < DUPLICATE_WINDOW) {
        numberCache.set(item.number, item.time);
      }
    });
  }
} catch (e) {
  console.error("[OnlineSim] Failed to load duplicate block file:", e.message);
}

function isDuplicate(number) {
  const now = Date.now();
  if (numberCache.has(number)) {
    if (now - numberCache.get(number) < DUPLICATE_WINDOW) return true;
  }
  numberCache.set(number, now);
  
  // Persist to file
  const cacheArr = [];
  numberCache.forEach((time, num) => {
    if (now - time < DUPLICATE_WINDOW) cacheArr.push({ number: num, time });
  });
  
  try {
    fs.writeFileSync(DUP_FILE, JSON.stringify(cacheArr));
  } catch (e) {}

  return false;
}

function logToProviderFile(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  appendProviderLog(line);
}

function buildUrl(urlTemplate, { api_key, service, country, order_id, external_order_id, phone }) {
  let url = urlTemplate || "";
  const replace = (pattern, value) => { if (value !== undefined && value !== null && value !== "") url = url.replace(pattern, encodeURIComponent(String(value))); };
  replace(/\{api_key\}|\$api_key/g, api_key);
  replace(/\{service\}|\$service/g, service);
  replace(/\{country\}|\$country/g, country);
  replace(/\{order_id\}|\$order_id|\{id\}|\$id/g, order_id);
  replace(/\{external_order_id\}|\$external_order_id/g, external_order_id);
  replace(/\{phone\}|\$phone|\{number\}|\$number/g, phone);
  return url;
}

async function callProvider(url, server, method = "GET", onHeaders, { timeoutMs } = {}) {
  const options = {
    method,
    headers: {
      "Accept": "application/json"
    }
  };

  if (server.api_uses_headers && server.api_key) {
    options.headers["Authorization"] = `Bearer ${server.api_key}`;
  }

  // Prevent any Node 18+ fetch caching issues
  const sep = url.includes('?') ? '&' : '?';
  const noCacheUrl = `${url}${sep}_t=${Date.now()}`;

  try {
    const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    const res = await fetch(noCacheUrl, { ...options, cache: 'no-store', ...(signal ? { signal } : {}) });
    onHeaders?.();
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
      if (!data || typeof data !== "object" || Array.isArray(data)) data = { text: text.trim() };
    } catch {
      data = { text: text.trim() };
    }
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    console.error("Provider API Error:", err.message);
    // A provider timeout is an inventory failure from the caller's point of
    // view. Do not expose transport details such as "This operation was
    // aborted" to website users or API clients.
    if (err.name === 'AbortError' || /\babort(?:ed|ing)?\b/i.test(String(err.message))) {
      return { ok: false, timed_out: true, data: { error: "NO_NUMBERS", code: "NO_NUMBERS" }, status: 408 };
    }
    return { ok: false, data: { error: err.message }, status: 500 };
  }
}

// 1. Get Number
async function getNumber(server, serviceCode, countryCode, { onProgress } = {}) {
  if (!server.api_get_number_url) return { error: "Server missing API GET url" };
  const backoffUntil = getProviderBackoff(server);
  if (backoffUntil) return { error: "Provider rate limited", rate_limited: true, retry_at: backoffUntil };
  
  let url = buildUrl(server.api_get_number_url, { 
    api_key: server.api_key, 
    service: serviceCode, 
    country: countryCode,
  });
  // The provider creates the activation ID. Never pass our internal wallet
  // reservation ID as external_order_id; use the provider response as the
  // canonical client-facing order reference instead.
  url = url.replace(/([?&])external_order_id=[^&]*/ig, "$1")
    .replace(/\?&/g, "?").replace(/&&+/g, "&").replace(/[?&]+$/, "");
  
  const maxRetries = Math.min(5, Math.max(1, Number(server.retry_count) || 1));
  let attempt = 0;
  let lastError = null;
  // Observation only: diagnostics must never change allocation or retry behavior.
  const progress = (phase, currentAttempt = attempt + 1) => {
    try { onProgress?.(phase, currentAttempt); } catch (_) {}
  };

  while (attempt < maxRetries || attempt === 0) {
    if (attempt > 0) console.log(`[RETRY] Attempt ${attempt}/${maxRetries - 1} for getNumber...`);
    
    progress("headers");
    const response = await callProvider(url, server, "GET", () => progress("body"));
    progress("parse");
    logToProviderFile(`getNumber | URL=${url} | RESP=${response.data.text || JSON.stringify(response.data)}`);
    const text = response.data.text || "";
    if (isRateLimitedResponse(response)) {
       const retryAt = markProviderBackoff(server);
       return { error: "Provider rate limited", rate_limited: true, retry_at: retryAt, originalError: text };
    }
    if (!response.ok) return { error: response.data.error || "Provider request failed" };
    console.log(`[DEBUG] Provider Response [Attempt ${attempt}]:`, text);

    // Standard Text Format: ACCESS_NUMBER:123456:919876543210
    if (text.startsWith("ACCESS_NUMBER:")) {
       const parts = text.split(":");
       const api_order_id = parts[1];
       const phone = (parts[2] || "").replace(/\D/g, '');
       if (!api_order_id || !phone) return { error: "Malformed provider response" };
       
       return { api_order_id, phone };
    }
    
    // JSON Alternative
    if (response.data.id && response.data.phone) {
       const api_order_id = response.data.id.toString();
       const phone = response.data.phone.toString().replace(/\D/g, '');
       
       return { api_order_id, phone };
    }

    // Error responses: NO_BALANCE, NO_MONEY (FATAL, don't retry)
    if (text === "NO_BALANCE" || text === "NO_MONEY") {
       return { error: "Provider account out of balance" };
    }

    // Error responses that are retryable (NO_NUMBERS, BAD_SERVICE, etc.)
    // Or unrecognized responses
    
    lastError = text || "Number Not Available";
    attempt++;
    
    // If no more retries allowed, exit loop
    if (maxRetries > 0 && attempt >= maxRetries) {
       console.log(`[RETRY_EXHAUSTED] Reached maximum attempts (${maxRetries})`);
       break;
    }

    if (attempt > 0) {
       console.log(`[RETRYABLE_ERROR] Provider returned: ${text || 'EMPTY'}. Attempting retry ${attempt}/${maxRetries - 1}`);
       // Optional: Add a small delay between retries to avoid spamming the provider
       progress("retry_wait", attempt);
       await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Exhausted inventory/retries always has the stable public error contract.
  return { error: "NO_NUMBERS", code: "NO_NUMBERS", originalError: lastError, url };
}

// 2. Check Status
async function checkStatus(server, api_order_id) {
  // Defense in depth: webhook servers never call Check Status URL, even if a
  // caller bypasses the background order synchronizer.
  if (isProviderWebhookEnabled(server)) return { status: "waiting", webhook_only: true };
  if (!server.api_check_status_url) return { error: "Server missing API Check url" };
  let backoffUntil = getProviderBackoff(server);
  if (backoffUntil) return { error: "Provider rate limited", rate_limited: true, retry_at: backoffUntil };
  
  let url = buildUrl(server.api_check_status_url, { 
    api_key: server.api_key, 
    order_id: api_order_id 
  });
  
  let response;
  const deadline = Date.now() + STATUS_REQUEST_TIMEOUT_MS;
  for (let attempt = 0; attempt < 3; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    backoffUntil = getProviderBackoff(server);
    if (backoffUntil) return { error: "Provider rate limited", rate_limited: true, retry_at: backoffUntil };
    response = await callProvider(url, server, "GET", undefined, { timeoutMs: remainingMs });
    const body = response.data.text || JSON.stringify(response.data);
    logToProviderFile(`checkStatus | ID=${api_order_id} | ATTEMPT=${attempt + 1} | HTTP=${response.status} | RESP=${body}`);
    if (isRateLimitedResponse(response)) {
      const retryAt = markProviderBackoff(server);
      return { error: "Provider rate limited", rate_limited: true, retry_at: retryAt };
    }
    if (response.ok) break;
    const retryable = response.timed_out || response.status >= 500 || response.status === 408 || response.status === 425;
    if (!retryable) return { error: response.data.error || "Provider status request failed", status: response.status };
    if (attempt < 2) {
      const retryDelay = Math.min(500 * (attempt + 1), Math.max(0, deadline - Date.now()));
      if (retryDelay > 0) await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  if (!response?.ok) return { error: response?.data?.error || "Provider status request failed", transient: true };

  const text = String(response.data.text || "").trim();

  const payload = response.data.data && typeof response.data.data === "object" ? response.data.data : {};
  const providerStatus = String(response.data.status || response.data.state || payload.status || payload.state || "").trim().toUpperCase();
  const providerOtp = response.data.otp ?? response.data.code ?? response.data.sms ??
    response.data.otp_code ?? response.data.verification_code ?? payload.otp ?? payload.code ?? payload.sms ??
    payload.otp_code ?? payload.verification_code;
  if (providerOtp !== undefined && providerOtp !== null && String(providerOtp).trim()) {
     return { status: ["COMPLETED", "SUCCESS", "SUCCESSFUL", "RECEIVED", "TRUE"].includes(providerStatus) ? "completed" : "waiting",
       otp: String(providerOtp).trim() };
  }

  if (["STATUS_WAIT_CODE", "TZ_NUM_WAIT", "STATUS_WAIT", "WAITING", "PENDING"].includes(text.toUpperCase()) ||
      ["WAITING", "PENDING", "STATUS_WAIT"].includes(providerStatus)) {
     return { status: "waiting", otp: null };
  }

  if (text.toUpperCase().startsWith("STATUS_OK:")) {
     const otp = text.slice(text.indexOf(":") + 1).trim();
     if (!otp) return { error: "Provider returned an empty OTP" };
     return { status: "completed", otp };
  }

  if (text.toUpperCase() === "STATUS_OK") return { status: "completed", otp: null };

  if (["STATUS_CANCEL", "STATUS_CANCELLED", "CANCELLED", "CANCELED", "EXPIRED", "REFUNDED"].includes(text.toUpperCase()) ||
      ["CANCELLED", "CANCELED", "EXPIRED", "REFUNDED"].includes(providerStatus)) {
     return { status: "cancelled", otp: null };
  }

  if (["COMPLETED", "SUCCESS", "SUCCESSFUL", "TRUE"].includes(providerStatus)) {
     return { status: "completed", otp: null };
  }

  return { status: "waiting", otp: null }; // Default to waiting if unrecognized, to keep polling
}

// 3. Cancel Order (setStatus=8)
async function cancelOrder(server, api_order_id, { requireConfirmation = false, allowMissing = false } = {}) {
  if (!server.api_cancel_url) return { error: "Server missing API Cancel url" };
  
  let url = buildUrl(server.api_cancel_url, { 
    api_key: server.api_key, 
    order_id: api_order_id 
  });
  
  const response = await callProvider(url, server);
  logToProviderFile(`cancelOrder | ID=${api_order_id} | RESP=${response.data.text || JSON.stringify(response.data)}`);
  const text = String(response.data.text || "").trim();
  const normalizedText = text.toUpperCase();

  if (!response.ok) return { success: false, error: "Provider cancellation failed" };

  if (["ACCESS_CANCEL", "ACCESS_ACTIVATION_CANCELED", "ACCESS_CANCEL_ALREADY", "STATUS_CANCEL", "STATUS_CANCELLED", "STATUS_CANCELED"].includes(normalizedText) ||
      (allowMissing && normalizedText === "NO_ACTIVATION")) {
     return { success: true };
  }

  if (normalizedText === "STATUS_OK" || normalizedText.startsWith("STATUS_OK:") || normalizedText === "NO_ACTIVATION") {
     return { success: false, otp: normalizedText.startsWith("STATUS_OK:") ? text.slice("STATUS_OK:".length).trim() : null,
       error: "Cannot confirm cancellation" };
  }

  const body = response.data || {};
  const nested = body.data && typeof body.data === "object" ? body.data : {};
  const successValue = body.success ?? nested.success;
  const statusValue = String(body.status ?? body.state ?? nested.status ?? nested.state ?? "").trim().toUpperCase();
  const confirmed = successValue === true || String(successValue).toLowerCase() === "true" ||
    body.status === true || nested.status === true ||
    ["CANCELLED", "CANCELED", "ACCESS_CANCEL", "ACCESS_ACTIVATION_CANCELED", "ACCESS_CANCEL_ALREADY", "STATUS_CANCEL", "STATUS_CANCELLED", "STATUS_CANCELED"].includes(statusValue);
  return { success: requireConfirmation ? confirmed : response.ok, details: response.data };
}

// 4. Request Another SMS (setStatus=3)
async function retryOrder(server, api_order_id) {
  if (!server.api_cancel_url) return { error: "Server missing API Cancel/Retry url" };
  // Expected to be same endpoint as cancel but with status=3
  // Admin input can be injected or we could just use check_status_url and replace action
  // Wait, the specification states: "Admin Input: https://api.provider.com/...setStatus...status=3"
  // Let's assume there is an api_retry_url or we just alter the cancel url if it contains status=8
  let baseTemplate = server.api_cancel_url;
  if (!baseTemplate.includes("status=8") && !server.api_retry_url) {
     return { error: "Cannot determine retry URL. Please specify api_retry_url." };
  }
  
  // If no dedicated retry url, fallback to replace status=8 with status=3
  let urlTemplate = server.api_retry_url || baseTemplate.replace("status=8", "status=3");
  
  let url = buildUrl(urlTemplate, { 
    api_key: server.api_key, 
    order_id: api_order_id 
  });

  const response = await callProvider(url, server);
  logToProviderFile(`retryOrder | ID=${api_order_id} | RESP=${response.data.text || JSON.stringify(response.data)}`);
  const text = response.data.text || "";

  if (text === "ACCESS_RETRY_GET" || text === "STATUS_READY") {
     return { success: true };
  }

  return { success: false, error: "Number Not Available", originalError: text || "Retry failed" };
}

async function rebuyOrder(server, order) {
  if (!server.api_rebuy_url) return { error: "Rebuy is not configured for this server" };
  const url = buildUrl(server.api_rebuy_url, {
    api_key: server.api_key,
    service: order.service_code || order.service_id,
    country: order.country,
    order_id: order.external_order_id,
    phone: order.phone,
  });
  const response = await callProvider(url, server);
  logToProviderFile(`rebuyOrder | ID=${order.external_order_id} | RESP=${response.data.text || JSON.stringify(response.data)}`);
  const text = response.data.text || "";
  const noAllocation = /^(NO_NUMBERS|NO_BALANCE|NO_MONEY|BAD_SERVICE|BAD_STATUS|NO_ACTIVATION)$/i.test(text);
  if (!response.ok) return { error: response.data.error || "Provider rebuy failed", originalError: text || response.data.error, no_allocation: noAllocation };
  if (text.startsWith("ACCESS_NUMBER:")) {
    const [, api_order_id, rawPhone] = text.split(":");
    const phone = String(rawPhone || "").replace(/\D/g, "");
    if (api_order_id && phone) return { api_order_id, phone };
  }
  if (response.data.id && response.data.phone) {
    return { api_order_id: String(response.data.id), phone: String(response.data.phone).replace(/\D/g, "") };
  }
  return { error: "Provider rebuy failed", originalError: text || JSON.stringify(response.data), no_allocation: noAllocation };
}

module.exports = {
  getNumber,
  checkStatus,
  cancelOrder,
  retryOrder,
  rebuyOrder,
  buildUrl
};
