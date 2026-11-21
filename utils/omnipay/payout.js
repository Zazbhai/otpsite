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

    return crypto
        .createHmac("sha256", appSecret)
        .update(signingString)
        .digest("base64");
}

async function createPayout(config, { amount, orderNo, bankAccount, callbackUrl, uid }) {
    try {
        const { appId, appSecret, apiBase } = config;
        const path = "/api/v1/payouts";

        const finalCallbackUrl = callbackUrl || "https://api.royalcasino.com/payout/callback";

        const body = {
            title: "Withdrawal",
            order_no: orderNo || `WD-${Date.now()}`,
            amount: parseInt(amount),
            currency: "INR",
            payment_method: "BANK_TRANSFER",
            callback_url: finalCallbackUrl,
            user_ip: "223.236.99.207",
            remark: "User withdrawal",
            payee: {
                account_no: bankAccount.accountNumber || bankAccount.account_number,
                ifsc: bankAccount.ifsc,
                name: bankAccount.accountName || bankAccount.name,
                user_id: uid ? uid.toString() : "user123"
            }
        };

        const ts = Date.now().toString();
        const nonce = crypto
            .randomBytes(8)
            .toString("hex");

        const sign = createSignature(
            appSecret,
            "POST",
            path,
            body,
            ts,
            nonce
        );

        console.log("=== Headers ===");
        console.log({
            "X-App-Id": appId,
            "X-Ts": ts,
            "X-Nonce": nonce,
            "X-Sign": sign,
            "X-Enc": "none"
        });

        console.log("\n=== Request Body ===");
        console.log(JSON.stringify(body, null, 2));

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
                },
                timeout: 30000
            }
        );

        console.log("\n=== Response ===");
        console.log(JSON.stringify(response.data, null, 2));

        return response.data;
    } catch (err) {
        console.error("\n=== Error ===");
        console.error(err.response?.data || err.message);
        return { success: false, message: "Omnipay payout error" };
    }
}

module.exports = { createPayout };