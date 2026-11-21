const fs = require('fs');
const path = require('path');

/**
 * Load payment configuration from JSON file.
 */
function loadPaymentConfig() {
  const configPath = path.join(__dirname, '..', 'payment_config.json');
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("❌ Error reading payment_config.json:", err.message);
  }
  return {
    bharatpe: {
      enabled: false,
      merchant_id: "",
      access_token: "",
      session_cookie: ""
    }
  };
}

/**
 * Check payment status on BharatPe using UTR.
 * @param {string|number} utr 
 */
async function paymentChecker(utr) {
  const config = loadPaymentConfig();
  const bharatpe = config.bharatpe || {};

  if (!bharatpe.enabled) {
    console.log("❌ BharatPe is not enabled in payment_config.json");
    return { success: false, amount: 0, reason: "unavailable" };
  }

  const { merchant_id, access_token, session_cookie } = bharatpe;
  if (!merchant_id || !access_token) {
    console.log("❌ BharatPe credentials not configured properly");
    return { success: false, amount: 0, reason: "unavailable" };
  }

  const utrStr = utr.toString();

  // URL and parameters
  const url = new URL("https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions");
  url.search = new URLSearchParams({ module: "PAYMENT_QR", merchantId: merchant_id });

  const headers = {
    "token": access_token,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://dashboard.bharatpe.in/"
  };

  if (session_cookie) {
    headers["Cookie"] = session_cookie;
  }

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(8000)
    });

    if (!resp.ok) {
      console.error(`BharatPe verification returned HTTP ${resp.status}`);
      return { success: false, amount: 0, reason: "unavailable" };
    }

    const data = await resp.json();
    const transactions = data?.data?.transactions;
    if (!Array.isArray(transactions)) {
      console.error("BharatPe verification returned an invalid transaction list");
      return { success: false, amount: 0, reason: "unavailable" };
    }

    const matches = transactions.filter(txn => String(txn?.bankReferenceNo) === utrStr);
    if (!matches.length) return { success: false, amount: 0, reason: "not_found" };

    const confirmed = matches.find(txn => String(txn.status).trim().toUpperCase() === "SUCCESS");
    if (!confirmed) return { success: false, amount: 0, reason: "not_confirmed" };

    const amount = Number(confirmed.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      console.error("BharatPe verification returned an invalid payment amount");
      return { success: false, amount: 0, reason: "unavailable" };
    }
    return { success: true, amount, status: confirmed.status };
  } catch (err) {
    console.error("BharatPe verification request failed:", err.name);
    return { success: false, amount: 0, reason: "unavailable" };
  }
}

module.exports = { paymentChecker };
