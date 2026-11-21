const axios = require("axios");
const crypto = require("crypto");

function createSignature(appSecret, method, path, body, ts, nonce) {
  const bodyJson = JSON.stringify(body);

  const bodyBase64 = Buffer
    .from(bodyJson, "utf8")
    .toString("base64");

  const signingString =
    `${method}\n` +
    `${path}\n` +
    `${ts}\n` +
    `${nonce}\n` +
    `${bodyBase64}`;

  console.log("\n=== Signing String ===");
  console.log(signingString);

  return crypto
    .createHmac("sha256", appSecret)
    .update(signingString)
    .digest("base64");
}

async function createOrder(config, { amount, orderNo, callbackUrl, jumpUrl }) {
  try {
    const { appId, appSecret, apiBase } = config;
    const path = "/api/v1/transactions";

    const body = {
      title: "Royal Casino Deposit",
      order_no: orderNo || `PAY-${Date.now()}`,
      amount: parseInt(amount),
      currency: "INR",
      payment_method: "UPI_INTENT",

      callback_url: callbackUrl || "https://api.royalcasino.com/payment/callback",

      return_url: jumpUrl || "royalcasino://deposit-complete",

      user_ip: "223.236.99.207",

      return_type: "CUSTOM",

      expire_seconds: 3600,

      payer: {
        user_id: "123456"
      }
    };

    const ts = Date.now().toString(); // 13 digits
    const nonce = crypto.randomBytes(8).toString("hex");

    const sign = createSignature(
      appSecret,
      "POST",
      path,
      body,
      ts,
      nonce
    );

    console.log("\n=== Headers ===");
    console.log({
      "X-App-Id": appId,
      "X-Ts": ts,
      "X-Nonce": nonce,
      "X-Sign": sign,
      "X-Enc": "none"
    });

    const response = await axios.post(
      `${apiBase}${path}`,
      body,
      {
        headers: {
          "Content-Type": "application/json",
          "X-App-Id": appId,
          "X-Ts": ts,
          "X-Nonce": nonce,
          "X-Sign": sign,
          "X-Enc": "none"
        }
      }
    );

    console.log("\n=== Response ===");
    console.log(
      JSON.stringify(response.data, null, 2)
    );

    return response.data;

  } catch (err) {
    console.error(
      err.response?.data || err.message
    );
    return { code: 500, message: "Omnipay server error" };
  }
}

module.exports = { createOrder };