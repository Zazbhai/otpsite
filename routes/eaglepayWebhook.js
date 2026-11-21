const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const eaglepay = require("../utils/eaglepay");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Payout = require("../models/Payout");
const { withTransaction } = require("../utils/db");

const CONFIG_PATH = path.join(__dirname, "..", "payment_config.json");

function getEagleConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  return cfg.eaglepay || null;
}

// ── EAGLE PAY DEPOSIT CALLBACK ────────────────────────────────────────────────
async function handleDepositCallback(req, res) {
  try {
    const payload = { ...req.query, ...req.body };
    console.log("[EaglePay Deposit Callback] Received:", JSON.stringify(payload));

    // We expect status: "success" | "failed"
    const merchantOrderNo =
      payload.merchant_order_no || payload.order_no || payload.mchOrderNo || "";
    if (!merchantOrderNo) {
      console.warn("[EaglePay Callback] Missing merchant_order_no");
      return res.status(200).send("success");
    }

    // Load and verify signature
    const epCfg = getEagleConfig();
    if (!epCfg || !epCfg.api_key) {
      console.warn("[EaglePay Callback] Gateway not configured");
      return res.status(200).send("success");
    }

    if (!eaglepay.verifyCallback(payload, epCfg.api_key)) {
      console.warn("[EaglePay Callback] Signature mismatch, ignoring");
      return res.status(200).send("success");
    }

    // Find the pending transaction
    let tx = await Transaction.findOne({ reference: merchantOrderNo });
    if (!tx) {
      console.warn("[EaglePay Callback] Transaction not found:", merchantOrderNo);
      return res.status(200).send("success");
    }

    if (tx.status === "completed") {
      return res.status(200).send("success"); // Already credited
    }

    const status = String(payload.status || "").toLowerCase();

    if (status === "failed") {
      if (tx.status === "pending") {
        tx.status = "failed";
        const reason = payload.reason ? ` (${payload.reason})` : "";
        tx.description = `Eagle Pay Deposit Failed${reason} (Ref: ${merchantOrderNo})`;
        await tx.save().catch(() => {});
      }
      return res.status(200).send("success");
    }

    if (status !== "success") {
      // Unknown status — just acknowledge
      return res.status(200).send("success");
    }

    // status === "success" — credit the user
    const commission = parseFloat((epCfg || {}).commission_percent) || 0;
    const paidAmount = parseFloat(payload.amount || payload.money || payload.order_amount || 0);
    const creditAmount = (tx && parseFloat(tx.amount) > 0)
      ? parseFloat(tx.amount)
      : (commission > 0 ? parseFloat((paidAmount / (1 + commission / 100)).toFixed(2)) : paidAmount);

    const { calculateDepositBonus } = require("../utils/paymentBonus");
    const { totalCredit, bonusAmount, bonusDesc } = calculateDepositBonus(creditAmount, epCfg);

    let updatedUser;
    let hadDeposited = false;

    await withTransaction(async (session) => {
      const queryOptions =
        process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };

      const doubleCheckTx = await Transaction.findOne(
        { reference: merchantOrderNo },
        null,
        queryOptions
      );
      if (!doubleCheckTx || doubleCheckTx.status === "completed") {
        throw new Error("ALREADY_CREDITED");
      }

      const user =
        process.env.DB_TYPE === "mysql"
          ? await User.findById(doubleCheckTx.user_id, queryOptions)
          : await User.findById(doubleCheckTx.user_id, null, queryOptions);

      if (!user) throw new Error("USER_NOT_FOUND");
      hadDeposited = user.has_deposited;

      updatedUser = await User.findOneAndUpdate(
        { _id: doubleCheckTx.user_id },
        { $inc: { balance: totalCredit }, $set: { has_deposited: true } },
        { ...queryOptions, new: true }
      );
      if (!updatedUser) throw new Error("USER_NOT_FOUND");

      doubleCheckTx.status = "completed";
      doubleCheckTx.amount = totalCredit;
      doubleCheckTx.balance_after = updatedUser.balance;
      doubleCheckTx.description = `Eagle Pay Deposit (Ref: ${merchantOrderNo})${bonusDesc}`;
      await doubleCheckTx.save(queryOptions);

      const { processReferralBonus } = require("../utils/referralBonus");
      await processReferralBonus(updatedUser, creditAmount, hadDeposited, queryOptions).catch((e) =>
        console.error("Referral bonus error:", e)
      );
    });

    if (updatedUser) {
      const { emitToUser } = require("../utils/realtimeEmitter");
      emitToUser(updatedUser._id.toString(), "wallet_update", { balance: updatedUser.balance });
    }

    console.log(`[EaglePay Callback] Credited ₹${totalCredit} (base: ₹${creditAmount}, bonus: ₹${bonusAmount}) for order ${merchantOrderNo}`);
    res.set("Content-Type", "text/plain");
    res.status(200).send("success");
  } catch (err) {
    if (err.message === "ALREADY_CREDITED") {
      res.set("Content-Type", "text/plain");
      return res.status(200).send("success");
    }
    console.error("[EaglePay Deposit Callback Error]:", err);
    res.set("Content-Type", "text/plain");
    res.status(200).send("success"); // Always return success to stop retries on unrecoverable errors
  }
}

// ── EAGLE PAY PAYOUT CALLBACK ─────────────────────────────────────────────────
async function handlePayoutCallback(req, res) {
  try {
    const payload = { ...req.query, ...req.body };
    console.log("[EaglePay Payout Callback] Received:", JSON.stringify(payload));

    const orderNo =
      payload.order_no || payload.transaction_id || payload.mchOrderNo || "";
    if (!orderNo) return res.status(200).send("success");

    const payout = await Payout.findOne({ order_no: orderNo });
    if (!payout) return res.status(200).send("success");

    if (payout.status === "SUCCESS") return res.status(200).send("success");

    const statusStr = String(payload.status || "").toLowerCase();
    if (statusStr === "success") {
      payout.status = "SUCCESS";
      payout.utr = payload.utr || payload.gateway_order_no || payout.utr;
    } else if (statusStr === "failed") {
      payout.status = "FAILED";
      payout.remark =
        payload.reason || payload.remark || "Payout failed at Eagle Pay gateway";
    } else {
      payout.status = statusStr.toUpperCase() || "PROCESSING";
    }

    payout.raw_response = payload;
    await payout.save();
    res.status(200).send("success");
  } catch (err) {
    console.error("[EaglePay Payout Callback Error]:", err);
    res.status(200).send("success");
  }
}

router.post("/callback", handleDepositCallback);
router.get("/callback", handleDepositCallback);
router.post("/payout-callback", handlePayoutCallback);
router.get("/payout-callback", handlePayoutCallback);

module.exports = router;
