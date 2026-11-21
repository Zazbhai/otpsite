const crypto = require("node:crypto");

/**
 * Computes MD5 signature for Heleket requests and webhooks.
 * Formula: sign = md5( base64(json_body) + apiKey )
 *
 * @param {string|Buffer} body - Exact JSON string or raw body string/buffer
 * @param {string} apiKey - Heleket payment API key
 * @returns {string} 32-char lowercase hex MD5 signature
 */
function sign(body, apiKey) {
  if (!apiKey) throw new Error("Heleket API key is required for signing");
  const bodyBuf = typeof body === "string" ? Buffer.from(body, "utf8") : (body || Buffer.from(""));
  const encoded = bodyBuf.toString("base64");
  return crypto.createHash("md5").update(encoded + apiKey).digest("hex");
}

/**
 * Constant-time comparison of two MD5 hex signatures to avoid timing side-channels.
 *
 * @param {string} expected - Expected MD5 signature
 * @param {string} actual - Actual MD5 signature received from header
 * @returns {boolean}
 */
function signatureEqual(expected, actual) {
  if (!expected || !actual || expected.length !== actual.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(expected, "ascii"), Buffer.from(actual, "ascii"));
}

/**
 * Verifies raw webhook payload received from Heleket.
 *
 * @param {string|Buffer} rawBody - Exact raw request body received from Heleket
 * @param {string} signHeader - Value of the 'sign' header sent by Heleket
 * @param {string} apiKey - Heleket payment API key
 * @returns {object} Parsed JSON payload if valid
 */
function verifyWebhookRaw(rawBody, signHeader, apiKey) {
  const computedSign = sign(rawBody, apiKey);
  if (!signatureEqual(computedSign, String(signHeader || "").toLowerCase())) {
    const err = new Error("Invalid Heleket webhook signature");
    err.code = "INVALID_SIGNATURE";
    throw err;
  }
  try {
    const rawString = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    return JSON.parse(rawString);
  } catch (parseErr) {
    throw new Error("Failed to parse Heleket webhook payload JSON: " + parseErr.message);
  }
}

/**
 * Sends an API request to Heleket endpoints.
 *
 * @param {object} config - Heleket configuration containing merchant_id, payment_key, etc.
 * @param {string} endpoint - API path, e.g., '/v1/payment'
 * @param {object} body - Request body object
 * @returns {Promise<object>} API response result
 */
async function sendRequest(config, endpoint, body = {}, usePayoutKey = false) {
  const { merchant_id, payment_key, payout_key, api_base = "https://api.heleket.com" } = config;
  const apiKey = usePayoutKey ? (payout_key || payment_key) : payment_key;
  if (!merchant_id || !apiKey) {
    throw new Error(`Heleket merchant_id and ${usePayoutKey ? "payout_key" : "payment_key"} are required in configuration.`);
  }

  // Remove undefined fields
  const cleanBody = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null && v !== "") {
      cleanBody[k] = v;
    }
  }

  const jsonString = Object.keys(cleanBody).length > 0 ? JSON.stringify(cleanBody) : "";
  const signature = sign(jsonString, apiKey);

  const url = `${api_base.replace(/\/$/, "")}${endpoint}`;
  const headers = {
    "merchant": merchant_id,
    "sign": signature,
    "Content-Type": "application/json",
    "User-Agent": "RapidOTP-Heleket-Client/1.0"
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: jsonString || undefined
  });

  const rawText = await response.text();
  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (err) {
    throw new Error(`Invalid JSON response from Heleket (${response.status}): ${rawText}`);
  }

  if (data.state !== 0 || !response.ok) {
    const errMsg = data.message || (data.result ? JSON.stringify(data.result) : `HTTP ${response.status}`);
    const error = new Error(`Heleket API Error: ${errMsg}`);
    error.status = response.status;
    error.state = data.state;
    error.fields = data.result || null;
    throw error;
  }

  return data.result;
}

/**
 * Creates a new crypto payment invoice on Heleket.
 *
 * @param {object} config - Gateway config from payment_config.json
 * @param {object} options - Options containing amount, currency, order_id, url_callback, etc.
 * @returns {Promise<object>} Invoice details including { uuid, order_id, url, amount, currency }
 */
async function createInvoice(config, options) {
  const {
    amount,
    currency = "INR",
    order_id,
    url_callback,
    url_return,
    url_success,
    payer_email,
    coin
  } = options;

  if (!amount || !order_id) {
    throw new Error("amount and order_id are required to create Heleket invoice.");
  }

  const reqBody = {
    amount: String(amount),
    currency: String(currency).toUpperCase(),
    order_id: String(order_id)
  };

  if (url_callback) reqBody.url_callback = url_callback;
  if (url_return) reqBody.url_return = url_return;
  if (url_success) reqBody.url_success = url_success;
  if (payer_email) reqBody.payer_email = payer_email;

  if (config.lifetime && Number(config.lifetime) > 0) {
    reqBody.lifetime = Number(config.lifetime);
  }

  if (config.discount_percent && Number(config.discount_percent) > 0) {
    reqBody.discount_percent = Number(config.discount_percent);
  }

  return await sendRequest(config, "/v1/payment", reqBody);
}

/**
 * Gets info / status for an existing Heleket payment invoice.
 *
 * @param {object} config - Gateway config
 * @param {object} identifier - { uuid } or { order_id }
 * @returns {Promise<object>} Invoice details with payment_status, is_final, etc.
 */
async function getInvoiceInfo(config, { uuid, order_id }) {
  if (!uuid && !order_id) {
    throw new Error("Either uuid or order_id is required to get Heleket invoice info.");
  }
  const reqBody = {};
  if (uuid) reqBody.uuid = uuid;
  if (order_id) reqBody.order_id = order_id;

  return await sendRequest(config, "/v1/payment/info", reqBody);
}

/**
 * Helper to check if a Heleket status string or payload represents a successful paid order.
 *
 * @param {object|string} invoiceOrStatus - Invoice info object or status string
 * @returns {boolean}
 */
function isPaymentPaid(invoiceOrStatus) {
  if (!invoiceOrStatus) return false;
  const status = typeof invoiceOrStatus === "string" 
    ? invoiceOrStatus.toLowerCase() 
    : String(invoiceOrStatus.payment_status || invoiceOrStatus.status || "").toLowerCase();
  
  return status === "paid" || status === "paid_over";
}

/**
 * Creates a new payout/withdrawal on Heleket.
 *
 * @param {object} config - Gateway config containing merchant_id and payout_key (or payment_key)
 * @param {object} options - { amount, currency, network, order_id, address, is_subtract, url_callback, memo }
 * @returns {Promise<object>} Payout details
 */
async function createPayout(config, options) {
  const {
    amount,
    currency = "USDT",
    network,
    order_id,
    address,
    is_subtract = true,
    url_callback,
    memo
  } = options;

  if (!amount || !order_id || !address) {
    throw new Error("amount, order_id, and address are required to create Heleket payout.");
  }

  const reqBody = {
    amount: String(amount),
    currency: String(currency).toUpperCase(),
    order_id: String(order_id),
    address: String(address),
    is_subtract: Boolean(is_subtract)
  };

  if (network) reqBody.network = String(network).toUpperCase();
  if (url_callback) reqBody.url_callback = url_callback;
  if (memo) reqBody.memo = memo;

  return await sendRequest(config, "/v1/payout", reqBody, true);
}

/**
 * Queries payout status on Heleket.
 *
 * @param {object} config - Gateway config
 * @param {object} identifier - { uuid } or { order_id }
 * @returns {Promise<object>} Payout status details
 */
async function queryPayout(config, { uuid, order_id }) {
  if (!uuid && !order_id) {
    throw new Error("Either uuid or order_id is required to query Heleket payout.");
  }
  const reqBody = {};
  if (uuid) reqBody.uuid = uuid;
  if (order_id) reqBody.order_id = order_id;

  return await sendRequest(config, "/v1/payout/info", reqBody, true);
}

/**
 * Gets list of available payment services, commission rates, and min/max deposit limits from Heleket.
 * Endpoint: POST /v1/payment/services
 *
 * @param {object} config - Gateway config containing merchant_id and payment_key
 * @returns {Promise<Array>} Array of available payment services
 */
async function getPaymentServices(config) {
  return await sendRequest(config, "/v1/payment/services", {});
}

const { getCachedSettings } = require("../settingsCache");
let cachedUsdRate = null;
let lastUsdRateFetch = 0;
const RATE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Gets the current live/cached dollar (USD) to INR exchange rate.
 * Uses cached exchange rates from database or live API, falling back gracefully.
 *
 * @returns {Promise<number>} Current INR per 1 USD (e.g. 96.38)
 */
async function getCurrentUsdToInrRate() {
  const now = Date.now();
  if (cachedUsdRate && (now - lastUsdRateFetch < RATE_CACHE_TTL)) {
    return cachedUsdRate;
  }

  try {
    const settings = await getCachedSettings();
    if (settings && settings.exchange_rates && settings.exchange_rates.USD && settings.exchange_rates.USD > 0) {
      const dbRate = Math.round((1 / settings.exchange_rates.USD) * 100) / 100;
      if (dbRate > 40 && dbRate < 200) {
        cachedUsdRate = dbRate;
        lastUsdRateFetch = now;
        return cachedUsdRate;
      }
    }
  } catch (e) {
    // Ignore error and try live API fallback
  }

  try {
    const https = require("https");
    const liveRate = await new Promise((resolve, reject) => {
      https.get("https://api.exchangerate-api.com/v4/latest/USD", { timeout: 3000 }, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => {
          try {
            if (res.statusCode === 200) {
              const parsed = JSON.parse(data);
              if (parsed.rates && parsed.rates.INR) {
                return resolve(parsed.rates.INR);
              }
            }
            reject(new Error("Invalid live rate response"));
          } catch (err) { reject(err); }
        });
      }).on("error", reject);
    });
    if (liveRate && liveRate > 40 && liveRate < 200) {
      cachedUsdRate = Math.round(liveRate * 100) / 100;
      lastUsdRateFetch = now;
      return cachedUsdRate;
    }
  } catch (apiErr) {
    // Ignore live fetch error
  }

  return cachedUsdRate || 96.38; // Default current market rate
}

module.exports = {
  sign,
  signatureEqual,
  verifyWebhookRaw,
  sendRequest,
  createInvoice,
  getInvoiceInfo,
  isPaymentPaid,
  createPayout,
  queryPayout,
  getPaymentServices,
  getCurrentUsdToInrRate
};
