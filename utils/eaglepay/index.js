const axios = require("axios");
const crypto = require("crypto");

const EAGLE_BASE = "https://xgxbscfgfhtiizzxipog.supabase.co/functions/v1";

// ── Signature Helpers ────────────────────────────────────────────────────────

/**
 * Pay-in signature: MD5(merchant_id + amount + merchant_order_no + api_key + callback_url)
 */
function signPayin(params, apiKey) {
  const raw =
    (params.merchant_id || "") +
    (params.amount || "") +
    (params.merchant_order_no || "") +
    apiKey +
    (params.callback_url || "");
  return crypto.createHash("md5").update(raw).digest("hex"); // lowercase hex
}

/**
 * Pay-out signature:
 * MD5(account_number + amount + bank_name + callback_url + ifsc + merchant_id + name + transaction_id + payout_key)
 */
function signPayout(params, payoutKey) {
  const raw =
    (params.account_number || "") +
    (params.amount || "") +
    (params.bank_name || "") +
    (params.callback_url || "") +
    (params.ifsc || "") +
    (params.merchant_id || "") +
    (params.name || "") +
    (params.transaction_id || "") +
    payoutKey;
  return crypto.createHash("md5").update(raw).digest("hex");
}

/**
 * Query order signature: MD5(sorted key=value pairs + &key=API_KEY).toUpperCase()
 */
function signQuery(params, apiKey) {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined)
  );
  const sorted = Object.keys(filtered).sort();
  const parts = sorted.map((k) => `${k}=${filtered[k]}`);
  parts.push(`key=${apiKey}`);
  return crypto.createHash("md5").update(parts.join("&")).digest("hex").toUpperCase();
}

/**
 * Verify an incoming callback signature.
 * Supports:
 * 1. MD5 of sorted key=value pairs (excluding 'sign') + '&key=API_KEY' (uppercase/lowercase)
 * 2. Concatenation MD5: (mchId + amount + mchOrderNo + apiKey) and (merchant_id + amount + merchant_order_no + apiKey + callback_url)
 */
function verifyCallback(payload, apiKey) {
  if (!payload || !payload.sign || !apiKey) return false;

  const receivedSign = String(payload.sign).trim().toLowerCase();

  // Strategy 1: Sorted key-value pairs (excluding sign)
  try {
    const filtered = Object.fromEntries(
      Object.entries(payload).filter(([k, v]) => k !== "sign" && v !== "" && v !== null && v !== undefined)
    );
    const sortedKeys = Object.keys(filtered).sort();
    const parts = sortedKeys.map((k) => `${k}=${filtered[k]}`);
    parts.push(`key=${apiKey}`);
    const sortedHash = crypto.createHash("md5").update(parts.join("&")).digest("hex").toLowerCase();
    if (sortedHash === receivedSign) return true;
  } catch (e) {}

  // Strategy 2: Concatenation variants
  const mchId = payload.mchId || payload.merchant_id || "";
  const mchOrderNo = payload.mchOrderNo || payload.merchant_order_no || payload.order_no || "";
  const callbackUrl = payload.callback_url || payload.notify_url || "";

  const amounts = new Set([String(payload.amount || "")]);
  const numAmt = parseFloat(payload.amount);
  if (!isNaN(numAmt)) {
    amounts.add(numAmt.toFixed(2));
    amounts.add(String(numAmt));
  }

  for (const amt of amounts) {
    // Standard pay-in string with callbackUrl
    const raw1 = `${mchId}${amt}${mchOrderNo}${apiKey}${callbackUrl}`;
    if (crypto.createHash("md5").update(raw1).digest("hex").toLowerCase() === receivedSign) return true;

    // Standard pay-in string without callbackUrl
    const raw2 = `${mchId}${amt}${mchOrderNo}${apiKey}`;
    if (crypto.createHash("md5").update(raw2).digest("hex").toLowerCase() === receivedSign) return true;
  }

  return false;
}

// ── API Calls ─────────────────────────────────────────────────────────────────

/**
 * Create a pay-in order.
 * @param {object} config  - { merchant_id, api_key, callback_url, return_url, trade_type, currency }
 * @param {object} options - { amount, orderNo }
 * @returns {object} Gateway response
 */
async function createPayin(config, { amount, orderNo, callbackUrl, returnUrl, tradeType, currency }) {
  try {
    const params = {
      merchant_id: config.merchant_id,
      amount: parseFloat(amount).toFixed(2),
      merchant_order_no: orderNo || `EP-${Date.now()}`,
      callback_url: callbackUrl || config.callback_url || "",
      return_url: returnUrl || config.return_url || "",
      trade_type: tradeType || config.trade_type || "INRUPI",
    };
    // PKR-specific: include currency field
    if ((currency || config.currency || "INR") === "PKR") {
      params.currency = "PKR";
    }

    params.sign = signPayin(params, config.api_key);

    const response = await axios.post(`${EAGLE_BASE}/payin`, params, {
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });
    return response.data;
  } catch (err) {
    console.error("[EaglePay createPayin Error]:", err.response?.data || err.message);
    return { code: 500, success: false, message: err.response?.data?.message || err.message };
  }
}

/**
 * Create a pay-out order.
 * @param {object} config  - { merchant_id, payout_key, callback_url }
 * @param {object} options - { amount, transactionId, accountNumber, name, bankName, ifsc }
 */
async function createPayout(config, { amount, transactionId, accountNumber, name, bankName, ifsc, callbackUrl }) {
  try {
    const params = {
      merchant_id: config.merchant_id,
      amount: parseFloat(amount).toFixed(2),
      transaction_id: transactionId || `EP-PO-${Date.now()}`,
      account_number: accountNumber,
      name,
      bank_name: bankName,
      ifsc: ifsc || "",
      callback_url: callbackUrl || config.callback_url || "",
    };

    params.sign = signPayout(params, config.payout_key);

    const response = await axios.post(`${EAGLE_BASE}/payout`, params, {
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });
    return response.data;
  } catch (err) {
    console.error("[EaglePay createPayout Error]:", err.response?.data || err.message);
    return { code: 500, success: false, message: err.response?.data?.message || err.message };
  }
}

/**
 * Query a pay-in or pay-out order status.
 * @param {object} config     - { merchant_id, api_key }
 * @param {string|object} query - merchant_order_no or { orderNo, mchOrderNo }
 */
async function queryOrder(config, query) {
  try {
    const orderNo = typeof query === "string" ? query : (query?.mchOrderNo || query?.orderNo || query?.order_no);
    const params = {
      mchId: config.merchant_id,
      mchOrderNo: orderNo,
    };
    params.sign = signQuery(params, config.api_key);

    const response = await axios.post(`${EAGLE_BASE}/check-order-status`, params, {
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });
    return response.data;
  } catch (err) {
    console.error("[EaglePay queryOrder Error]:", err.response?.data || err.message);
    return null;
  }
}

module.exports = {
  createPayin,
  createPayout,
  queryOrder,
  verifyCallback,
  signPayin,
  signPayout,
  signQuery,
};
