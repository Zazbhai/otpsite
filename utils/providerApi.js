/**
 * Provider API integration based on Master Reference Guide
 */
const fs = require('fs');
const path = require('path');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '..', 'onlinesim');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DUP_FILE = path.join(DATA_DIR, 'duplicate_number_block.json');
const LOG_FILE = path.join(DATA_DIR, 'onlinesim_log.txt');

// Provider limits apply to the server/API key, not to an individual order.
// Back off all polling for this provider briefly after a 429 response.
const providerBackoff = new Map();
const PROVIDER_BACKOFF_MS = 10_000;

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
  fs.appendFileSync(LOG_FILE, line);
}

function buildUrl(urlTemplate, { api_key, service, country, order_id }) {
  let url = urlTemplate || "";
  if (api_key) url = url.replace(/\{api_key\}|\$api_key/g, api_key);
  if (service) url = url.replace(/\{service\}|\$service/g, service);
  if (country) url = url.replace(/\{country\}|\$country/g, country);
  if (order_id) url = url.replace(/\{order_id\}|\$order_id|\{id\}|\$id/g, order_id);
  return url;
}

async function callProvider(url, server, method = "GET") {
  const options = {
    method,
    headers: {
      "Accept": "application/json"
    }
  };

  if (server.api_uses_headers && server.api_key) {
    options.headers["Authorization"] = `Bearer ${server.api_key}`;
  }

  console.log(`\n[DEBUG] === CALLING 3RD PARTY PROVIDER ===\nMETHOD: ${method}\nURL: ${url}\nHEADERS:`, options.headers, `\n`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

  // Prevent any Node 18+ fetch caching issues
  const sep = url.includes('?') ? '&' : '?';
  const noCacheUrl = `${url}${sep}_t=${Date.now()}`;

  try {
    const res = await fetch(noCacheUrl, { ...options, cache: 'no-store', signal: controller.signal });
    clearTimeout(timeoutId);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { text: text.trim() };
    }
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("Provider API Error:", err.message);
    if (err.name === 'AbortError') {
      return { ok: false, data: { error: "Provider request timed out" }, status: 408 };
    }
    return { ok: false, data: { error: err.message }, status: 500 };
  }
}

// 1. Get Number
async function getNumber(server, serviceCode, countryCode) {
  if (!server.api_get_number_url) return { error: "Server missing API GET url" };
  const backoffUntil = getProviderBackoff(server);
  if (backoffUntil) return { error: "Provider rate limited", rate_limited: true, retry_at: backoffUntil };
  
  let url = buildUrl(server.api_get_number_url, { 
    api_key: server.api_key, 
    service: serviceCode, 
    country: countryCode 
  });
  
  const maxRetries = server.retry_count || 0;
  let attempt = 0;
  let lastError = null;

  while (attempt < maxRetries || attempt === 0) {
    if (attempt > 0) console.log(`[RETRY] Attempt ${attempt}/${maxRetries - 1} for getNumber...`);
    
    const response = await callProvider(url, server);
    logToProviderFile(`getNumber | URL=${url} | RESP=${response.data.text || JSON.stringify(response.data)}`);
    const text = response.data.text || "";
    if (isRateLimitedResponse(response)) {
       const retryAt = markProviderBackoff(server);
       return { error: "Provider rate limited", rate_limited: true, retry_at: retryAt, originalError: text };
    }
    console.log(`[DEBUG] Provider Response [Attempt ${attempt}]:`, text);

    // Standard Text Format: ACCESS_NUMBER:123456:919876543210
    if (text.startsWith("ACCESS_NUMBER:")) {
       const parts = text.split(":");
       const api_order_id = parts[1];
       const phone = parts[2].replace(/\D/g, '');
       
       if (isDuplicate(phone)) {
         console.log(`[DUPLICATE] Number ${phone} already assigned recently. Retrying...`);
         attempt++;
         if (attempt >= maxRetries && maxRetries > 0) break;
         continue;
       }
       return { api_order_id, phone };
    }
    
    // JSON Alternative
    if (response.data.id && response.data.phone) {
       const api_order_id = response.data.id.toString();
       const phone = response.data.phone.toString().replace(/\D/g, '');
       
       if (isDuplicate(phone)) {
         console.log(`[DUPLICATE] Number ${phone} already assigned recently. Retrying...`);
         attempt++;
         if (attempt >= maxRetries && maxRetries > 0) break;
         continue;
       }
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
       await new Promise(r => setTimeout(r, 1000));
    }
  }

  // If we're here, it means we exhausted retries or hit an immediate non-retryable error
  // Map any technical error string to user-friendly "Number Not Available"
  const finalError = (lastError === "Provider request timed out") ? lastError : "Number Not Available";
  return { error: finalError, originalError: lastError, url };
}

// 2. Check Status
async function checkStatus(server, api_order_id) {
  if (!server.api_check_status_url) return { error: "Server missing API Check url" };
  const backoffUntil = getProviderBackoff(server);
  if (backoffUntil) return { error: "Provider rate limited", rate_limited: true, retry_at: backoffUntil };
  
  let url = buildUrl(server.api_check_status_url, { 
    api_key: server.api_key, 
    order_id: api_order_id 
  });
  
  const response = await callProvider(url, server);
  logToProviderFile(`checkStatus | ID=${api_order_id} | RESP=${response.data.text || JSON.stringify(response.data)}`);
  const text = response.data.text || "";
  if (isRateLimitedResponse(response)) {
     const retryAt = markProviderBackoff(server);
     return { error: "Provider rate limited", rate_limited: true, retry_at: retryAt };
  }

  if (text === "STATUS_WAIT_CODE" || text === "TZ_NUM_WAIT") {
     return { status: "waiting", otp: null };
  }

  if (text.startsWith("STATUS_OK:")) {
     const otp = text.slice("STATUS_OK:".length);
     return { status: "completed", otp };
  }

  if (text === "STATUS_CANCEL") {
     return { status: "cancelled", otp: null };
  }

  return { status: "waiting", otp: null }; // Default to waiting if unrecognized, to keep polling
}

// 3. Cancel Order (setStatus=8)
async function cancelOrder(server, api_order_id) {
  if (!server.api_cancel_url) return { error: "Server missing API Cancel url" };
  
  let url = buildUrl(server.api_cancel_url, { 
    api_key: server.api_key, 
    order_id: api_order_id 
  });
  
  const response = await callProvider(url, server);
  logToProviderFile(`cancelOrder | ID=${api_order_id} | RESP=${response.data.text || JSON.stringify(response.data)}`);
  const text = response.data.text || "";

  if (text === "ACCESS_CANCEL" || text === "ACCESS_ACTIVATION_CANCELED") {
     return { success: true };
  }

  if (text === "STATUS_OK" || text === "NO_ACTIVATION") {
     return { success: false, error: "Cannot cancel, OTP already delivered" };
  }

  return { success: response.ok, details: response.data };
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

module.exports = {
  getNumber,
  checkStatus,
  cancelOrder,
  retryOrder
};
