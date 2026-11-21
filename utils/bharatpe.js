const fs = require('fs');
const path = require('path');

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 19_800_000;
const LOOKBACK_DAYS = 7;
const PAGE_SIZE = 10;
const MAX_PAGES = 20;

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

  // BharatPe expects calendar day boundaries in India Standard Time.
  const todayStart = Math.floor((Date.now() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  const url = new URL("https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions");
  url.search = new URLSearchParams({
    module: "PAYMENT_QR",
    merchantId: merchant_id,
    sDate: todayStart - (LOOKBACK_DAYS - 1) * DAY_MS,
    eDate: todayStart + DAY_MS - 1000,
    pageSize: PAGE_SIZE,
    isFromOtDashboard: "1",
  });

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
    const signal = AbortSignal.timeout(8000);
    let foundUnconfirmed = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      url.searchParams.set("pageCount", page);
      const resp = await fetch(url, { method: "GET", headers, redirect: "error", signal });

      if (!resp.ok) {
        console.error(`BharatPe verification returned HTTP ${resp.status}`);
        return { success: false, amount: 0, reason: "unavailable" };
      }

      const data = await resp.json();
      const transactions = data?.data?.transactions;
      if (data?.status === false || !Array.isArray(transactions)) {
        console.error("BharatPe verification returned an invalid transaction list");
        return { success: false, amount: 0, reason: "unavailable" };
      }

      const matches = transactions.filter(txn =>
        String(txn?.bankReferenceNo) === utrStr &&
        (txn.merchantId == null || String(txn.merchantId) === String(merchant_id)) &&
        (txn.type == null || txn.type === "PAYMENT_RECV")
      );
      const confirmed = matches.find(txn => String(txn.status).trim().toUpperCase() === "SUCCESS");
      if (confirmed) {
        const amount = Number(confirmed.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          console.error("BharatPe verification returned an invalid payment amount");
          return { success: false, amount: 0, reason: "unavailable" };
        }
        return { success: true, amount, status: confirmed.status };
      }

      foundUnconfirmed ||= matches.length > 0;
      if (transactions.length < PAGE_SIZE) {
        return { success: false, amount: 0, reason: foundUnconfirmed ? "not_confirmed" : "not_found" };
      }
    }
    return { success: false, amount: 0, reason: "search_incomplete" };
  } catch (err) {
    console.error("BharatPe verification request failed:", err.name);
    return { success: false, amount: 0, reason: "unavailable" };
  }
}

module.exports = { paymentChecker };
