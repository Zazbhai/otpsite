const axios = require("axios");
const crypto = require("crypto");

function createSignature(appSecret, method, path, body, ts, nonce) {
  const bodyJson = JSON.stringify(body || {});
  const bodyBase64 = Buffer.from(bodyJson, "utf8").toString("base64");
  const signingString =
    `${method}\n` +
    `${path}\n` +
    `${ts}\n` +
    `${nonce}\n` +
    `${bodyBase64}`;

  return crypto
    .createHmac("sha256", appSecret)
    .update(signingString)
    .digest("base64");
}

async function createOrder(config, { amount, orderNo, callbackUrl, jumpUrl, title, userId }) {
  try {
    const { appId, appSecret, apiBase } = config;
    const path = "/api/v1/transactions";

    const body = {
      title: title || "Rapid OTP Wallet Deposit",
      order_no: orderNo || `PAY-${Date.now()}`,
      amount: require("../money").positiveMoney(amount),
      currency: "INR",
      payment_method: "UPI_INTENT",
      callback_url: callbackUrl || "https://rapidotp.com/api/payment/omnipay/callback",
      return_url: jumpUrl || "https://rapidotp.com/dashboard/wallet",
      user_ip: "223.236.99.207",
      return_type: "CUSTOM",
      expire_seconds: 3600,
      payer: {
        user_id: userId ? userId.toString() : "guest"
      }
    };

    const ts = Date.now().toString();
    const nonce = crypto.randomBytes(8).toString("hex");
    const sign = createSignature(appSecret, "POST", path, body, ts, nonce);

    const response = await axios.post(`${apiBase}${path}`, body, {
      headers: {
        "Content-Type": "application/json",
        "X-App-Id": appId,
        "X-Ts": ts,
        "X-Nonce": nonce,
        "X-Sign": sign,
        "X-Enc": "none"
      },
      timeout: 30000
    });

    return response.data;
  } catch (err) {
    console.error("[Omnipay createOrder Error]:", err.response?.data || err.message);
    return { code: 500, message: err.response?.data?.message || err.message };
  }
}

async function queryOrder(config, orderNo) {
  try {
    const { appId, appSecret, apiBase } = config;
    const path = "/api/v1/transactions/detail";
    const body = { order_no: orderNo };

    const ts = Date.now().toString();
    const nonce = crypto.randomBytes(8).toString("hex");
    const sign = createSignature(appSecret, "POST", path, body, ts, nonce);

    const response = await axios.post(`${apiBase}${path}`, body, {
      headers: {
        "Content-Type": "application/json",
        "X-App-Id": appId,
        "X-Ts": ts,
        "X-Nonce": nonce,
        "X-Sign": sign,
        "X-Enc": "none"
      },
      timeout: 30000
    });

    const result = response.data;
    if (result && result.code === 200 && result.data) {
      return result.data;
    }
    return null;
  } catch (err) {
    console.error("[Omnipay queryOrder Error]:", err.response?.data || err.message);
    return null;
  }
}

async function createPayout(config, { amount, orderNo, bankAccount, callbackUrl, uid }) {
  try {
    const { appId, appSecret, apiBase } = config;
    const path = "/api/v1/payouts";

    const body = {
      title: "Admin Withdrawal",
      order_no: orderNo || `WD-${Date.now()}`,
      amount: parseInt(amount),
      currency: "INR",
      payment_method: "BANK_TRANSFER",
      callback_url: callbackUrl || "https://rapidotp.com/api/payment/omnipay/payout-callback",
      user_ip: "223.236.99.207",
      remark: "Admin withdrawal payout",
      payee: {
        account_no: bankAccount.accountNumber || bankAccount.account_number || bankAccount.accountNo,
        ifsc: (bankAccount.ifsc || "").toUpperCase(),
        name: bankAccount.accountName || bankAccount.account_name || bankAccount.name,
        user_id: uid ? uid.toString() : "admin1"
      }
    };

    const ts = Date.now().toString();
    const nonce = crypto.randomBytes(8).toString("hex");
    const sign = createSignature(appSecret, "POST", path, body, ts, nonce);

    const response = await axios.post(`${apiBase}${path}`, body, {
      headers: {
        "Content-Type": "application/json",
        "X-App-Id": appId,
        "X-Ts": ts,
        "X-Nonce": nonce,
        "X-Sign": sign,
        "X-Enc": "none"
      },
      timeout: 30000
    });

    return response.data;
  } catch (err) {
    console.error("[Omnipay createPayout Error]:", err.response?.data || err.message);
    return { code: 500, message: err.response?.data?.message || err.message };
  }
}

async function queryPayout(config, orderNo) {
  try {
    const { appId, appSecret, apiBase } = config;
    const path = "/api/v1/payouts/detail";
    const body = { order_no: orderNo };

    const ts = Date.now().toString();
    const nonce = crypto.randomBytes(8).toString("hex");
    const sign = createSignature(appSecret, "POST", path, body, ts, nonce);

    const response = await axios.post(`${apiBase}${path}`, body, {
      headers: {
        "Content-Type": "application/json",
        "X-App-Id": appId,
        "X-Ts": ts,
        "X-Nonce": nonce,
        "X-Sign": sign,
        "X-Enc": "none"
      },
      timeout: 30000
    });

    const result = response.data;
    if (result && result.code === 200 && result.data) {
      return result.data;
    }
    return null;
  } catch (err) {
    console.error("[Omnipay queryPayout Error]:", err.response?.data || err.message);
    return null;
  }
}

module.exports = {
  createOrder,
  queryOrder,
  createPayout,
  queryPayout,
  createSignature
};
