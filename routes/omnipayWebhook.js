const wallet = require("../utils/wallet");
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const omnipay = require("../utils/omnipay");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Payout = require("../models/Payout");
const { withTransaction } = require("../utils/db");

// ── OMNIPAY DEPOSIT CALLBACK ─────────────────────────────────────────
async function handleDepositCallback(req, res) {
  try {
    const bodyData = req.body?.data || req.body || {};
    const queryData = req.query?.data || req.query || {};
    const payload = { ...queryData, ...bodyData, ...req.body, ...req.query };
    console.log("[OmniPay Deposit Callback] Received:", JSON.stringify(payload));

    const orderNo = payload.order_no || payload.orderNo || bodyData.order_no || bodyData.orderNo;
    if (!orderNo) {
      console.warn("[OmniPay Callback] Missing order_no");
      return res.status(200).send("FAILED");
    }

    // Check if we have a pending transaction for this order
    let tx = await Transaction.findOne({ reference: orderNo });
    if (!tx) {
      const utrRef = payload.utr || bodyData.utr || payload.trade_no || bodyData.trade_no;
      if (utrRef) tx = await Transaction.findOne({ reference: utrRef });
    }

    if (!tx) {
      console.warn("[OmniPay Callback] Transaction not found for order:", orderNo);
      return res.status(200).send("FAILED");
    }

    if (tx.status === "completed") {
      return res.status(200).send("SUCCESS"); // Already credited
    }

    const configPath = path.join(__dirname, "..", "payment_config.json");
    if (!fs.existsSync(configPath)) return res.status(200).send("FAILED");
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const o = cfg.omnipay || {};

    const omniConfig = {
      appId: o.app_id || o.appId,
      appSecret: o.app_secret || o.appSecret,
      apiBase: o.api_base || o.apiBase || "https://api.omnipay.global"
    };

    // Only the authenticated gateway query may confirm a payment.
    let data = await omnipay.queryOrder(omniConfig, orderNo);
    let statusStr = String(data?.status || "").toUpperCase();
    let isSuccess = statusStr === "SUCCEEDED" || statusStr === "SUCCESS" || statusStr === "PAID" || statusStr === "COMPLETED" || statusStr === "1" || data?.status === 1 || statusStr === "2" || data?.status === 2;

    if (!isSuccess) {
      const failedStatus = statusStr === "FAILED" || statusStr === "REJECTED" || statusStr === "-1" || data?.status === -1;
      if (failedStatus && tx.status === "pending") {
        tx.status = "failed";
        tx.description = `OmniPay Deposit Failed (Ref: ${orderNo})`;
        await Transaction.findOneAndUpdate({ _id: tx._id, status: "pending" }, { $set: { status: "failed", description: tx.description } });
      }
      return res.status(data ? 200 : 503).send(data ? "SUCCESS" : "RETRY");
    }

    const credited = await wallet.creditDeposit({ transactionId: tx._id, userId: tx.user_id,
      config: o, description: `OmniPay Deposit (Ref: ${orderNo})` });
    const updatedUser = credited.user;
    const { totalCredit, bonusAmount, base_amount: creditAmount } = credited;

    console.log(`[OmniPay Callback] Credited ₹${totalCredit} (base: ₹${creditAmount}, bonus: ₹${bonusAmount}) for order ${orderNo}`);
    res.status(200).send("SUCCESS");
  } catch (err) {
    if (err.message === "ALREADY_CREDITED") {
      return res.status(200).send("SUCCESS");
    }
    console.error("[OmniPay Deposit Callback Error]:", err);
    res.status(200).send("FAILED");
  }
}

// ── OMNIPAY PAYOUT CALLBACK ──────────────────────────────────────────
async function handlePayoutCallback(req, res) {
  try {
    const bodyData = req.body?.data || req.body || {};
    const queryData = req.query?.data || req.query || {};
    const payload = { ...queryData, ...bodyData, ...req.body, ...req.query };
    console.log("[OmniPay Payout Callback] Received:", JSON.stringify(payload));

    const orderNo = payload.order_no || payload.orderNo || bodyData.order_no || bodyData.orderNo;
    if (!orderNo) return res.status(200).send("FAILED");

    const payout = await Payout.findOne({ order_no: orderNo });
    if (!payout) return res.status(200).send("FAILED");

    if (payout.status === "SUCCESS") return res.status(200).send("SUCCESS");

    const statusStr = String(payload.status || bodyData.status || "").toUpperCase();
    if (statusStr === "SUCCEEDED" || statusStr === "SUCCESS" || statusStr === "COMPLETED" || statusStr === "1" || payload.status === 1) {
      payout.status = "SUCCESS";
      payout.utr = payload.utr || bodyData.utr || payload.trade_no || bodyData.trade_no || payout.utr;
    } else if (statusStr === "FAILED" || statusStr === "REJECTED" || statusStr === "-1" || payload.status === -1) {
      payout.status = "FAILED";
      payout.remark = payload.remark || bodyData.remark || payload.message || "Payout failed at gateway";
    } else {
      payout.status = statusStr || "PROCESSING";
    }

    payout.raw_response = payload;
    await payout.save();
    res.status(200).send("SUCCESS");
  } catch (err) {
    console.error("[OmniPay Payout Callback Error]:", err);
    res.status(200).send("FAILED");
  }
}

router.post("/callback", handleDepositCallback);
router.get("/callback", handleDepositCallback);
router.post("/payout-callback", handlePayoutCallback);
router.get("/payout-callback", handlePayoutCallback);

module.exports = router;
