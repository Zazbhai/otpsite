const wallet = require("../utils/wallet");
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const heleket = require("../utils/heleket");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { withTransaction } = require("../utils/db");

// ── HELEKET DEPOSIT CALLBACK / WEBHOOK ───────────────────────────────
async function handleHeleketWebhook(req, res) {
  try {
    const configPath = path.join(__dirname, "..", "payment_config.json");
    if (!fs.existsSync(configPath)) {
      console.error("[Heleket Webhook] payment_config.json not found");
      return res.status(400).send("Configuration missing");
    }

    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const hConfig = cfg.heleket || {};
    if (!hConfig.enabled || !hConfig.payment_key) {
      console.warn("[Heleket Webhook] Gateway disabled or payment_key missing");
      return res.status(400).send("Gateway disabled");
    }

    const signHeader = req.headers["sign"] || req.headers["x-sign"] || "";
    const rawBody = req.rawBody || (typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}));

    let payload;
    try {
      // First try verifying exactly with rawBody
      payload = heleket.verifyWebhookRaw(rawBody, signHeader, hConfig.payment_key);
    } catch (verifyErr) {
      // If req.body was parsed/re-serialized and signature check failed, also try querying Heleket info directly if we have order_id or uuid
      console.warn("[Heleket Webhook] Signature check fallback/warning:", verifyErr.message);
      const fallbackOrderId = req.body?.order_id || req.body?.orderId || req.body?.order_no || req.body?.uuid || req.query?.order_id || req.query?.uuid;
      if (!fallbackOrderId) {
        return res.status(400).send("Invalid signature");
      }
      try {
        const info = await heleket.getInvoiceInfo(hConfig, fallbackOrderId.startsWith("HEL-") ? { order_id: fallbackOrderId } : { uuid: fallbackOrderId });
        payload = info;
      } catch (infoErr) {
        console.error("[Heleket Webhook] Info query failed:", infoErr.message);
        return res.status(400).send("Invalid signature & info query failed");
      }
    }

    console.log("[Heleket Webhook] Verified payload:", JSON.stringify(payload));

    const orderId = payload.order_id || payload.orderId || payload.order_no || payload.uuid;
    if (!orderId) {
      console.warn("[Heleket Webhook] Missing order_id in payload");
      return res.status(200).send("OK");
    }

    // Find pending transaction
    let tx = await Transaction.findOne({ reference: orderId });
    if (!tx && payload.uuid) {
      tx = await Transaction.findOne({ reference: payload.uuid });
    }
    if (!tx) {
      console.warn("[Heleket Webhook] Transaction not found for order:", orderId);
      return res.status(200).send("OK");
    }

    if (tx.status === "completed") {
      console.log(`[Heleket Webhook] Order ${orderId} already completed.`);
      return res.status(200).send("OK");
    }

    const isPaid = heleket.isPaymentPaid(payload);
    const isFailed = payload.payment_status === "expired" || payload.payment_status === "canceled" || payload.payment_status === "fail" || payload.status === "expired" || payload.status === "canceled" || payload.status === "fail";

    if (isFailed && tx.status === "pending") {
      tx.status = "failed";
      tx.description = `Heleket Crypto Deposit Failed/Expired (Ref: ${orderId})`;
      await Transaction.findOneAndUpdate({ _id: tx._id, status: "pending" }, { $set: { status: "failed", description: tx.description } });
      return res.status(200).send("OK");
    }

    if (!isPaid) {
      // Still pending / waiting for confirmations
      return res.status(200).send("OK");
    }

    // Payment is PAID! Credit amount to user
    // Note: If transaction has an expected INR amount in tx.amount, we credit that amount.
    const credited = await wallet.creditDeposit({ transactionId: tx._id, userId: tx.user_id,
      config: hConfig, description: `Heleket Crypto Deposit (Ref: ${orderId})` });
    const updatedUser = credited.user;
    const { totalCredit, bonusAmount, base_amount: creditAmount } = credited;

    console.log(`[Heleket Webhook] Successfully credited ₹${totalCredit} (base: ₹${creditAmount}, bonus: ₹${bonusAmount}) for order ${orderId}`);
    res.status(200).send("OK");
  } catch (err) {
    if (err.message === "ALREADY_CREDITED") {
      return res.status(200).send("OK");
    }
    console.error("[Heleket Webhook Error]:", err);
    res.status(500).send("Error");
  }
}

router.post("/callback", handleHeleketWebhook);
router.post("/webhook", handleHeleketWebhook);
router.post("/", handleHeleketWebhook);

module.exports = router;
