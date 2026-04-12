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
    return { success: false, amount: 0 };
  }

  const { merchant_id, access_token, session_cookie } = bharatpe;
  if (!merchant_id || !access_token) {
    console.log("❌ BharatPe credentials not configured properly");
    return { success: false, amount: 0 };
  }

  const utrStr = utr.toString();

  // URL and parameters
  const url = `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?module=PAYMENT_QR&merchantId=${merchant_id}`;

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
      headers: headers
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`❌ BharatPe HTTP Error: ${resp.status} - ${text}`);
      return { success: false, amount: 0 };
    }

    const data = await resp.json();
    const transactions = data.data?.transactions || [];

    const foundTxn = transactions.find(txn => 
      txn.bankReferenceNo && txn.bankReferenceNo.toString() === utrStr
    );

    if (foundTxn) {
      console.log("✅ Payment FOUND and CONFIRMED!");
      return {
        success: true,
        amount: parseFloat(foundTxn.amount),
        status: foundTxn.status,
        payer: foundTxn.payerName,
        upi: foundTxn.payerHandle
      };
    } else {
      console.log("❌ Payment NOT FOUND with this UTR");
      return { success: false, amount: 0 };
    }
  } catch (err) {
    console.error("❌ BharatPe request failed:", err.message);
    return { success: false, amount: 0 };
  }
}

module.exports = { paymentChecker };
