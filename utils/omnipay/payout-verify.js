const axios = require("axios");
const crypto = require("crypto");

const APP_ID = "M20261491FWJ7";

const APP_SECRET =
    "RiDIt3P9L^DOHJKfvN3TSwCtu9wkdbg@Y^LHm1VO20*!&rfGNAYriDaG!42^0&&A";

const API_BASE = "https://api.omnipay.global";

function createSignature(method, path, body, ts, nonce) {
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
        .createHmac("sha256", APP_SECRET)
        .update(signingString)
        .digest("base64");
}

async function queryPayout(orderNo) {
    try {
        const path = "/api/v1/payouts/detail";

        const body = {
            order_no: orderNo
        };

        const ts = Date.now().toString();

        const nonce = crypto
            .randomBytes(8)
            .toString("hex");

        const sign = createSignature(
            "POST",
            path,
            body,
            ts,
            nonce
        );

        const response = await axios.post(
            `${API_BASE}${path}`,
            body,
            {
                headers: {
                    "Content-Type": "application/json",
                    "X-App-Id": APP_ID,
                    "X-Ts": ts,
                    "X-Nonce": nonce,
                    "X-Sign": sign,
                    "X-Enc": "none"
                }
            }
        );

        const result = response.data;

        console.log(
            JSON.stringify(result, null, 2)
        );

        if (
            result.code === 200 &&
            result.data
        ) {

            console.log("\n=== Payout Status ===");

            console.log(
                "Trade No:",
                result.data.trade_no
            );

            console.log(
                "Order No:",
                result.data.order_no
            );

            console.log(
                "Status:",
                result.data.status
            );

            console.log(
                "Amount:",
                result.data.amount
            );

            console.log(
                "Currency:",
                result.data.currency
            );

            console.log(
                "Fee:",
                result.data.fee
            );

            console.log(
                "UTR:",
                result.data.utr
            );

            console.log(
                "Hash:",
                result.data.hash
            );

            return result.data;
        }

        return null;

    } catch (err) {

        console.error(
            err.response?.data || err.message
        );

        return null;
    }
}

// Example
queryPayout("Payout-004364565402");