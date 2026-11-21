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

    // Verify with gateway queryOrder directly; if not yet updated or returns null, check the callback payload status
    let data = await omnipay.queryOrder(omniConfig, orderNo);
    let statusStr = String(data?.status || "").toUpperCase();
    let isSuccess = statusStr === "SUCCEEDED" || statusStr === "SUCCESS" || statusStr === "PAID" || statusStr === "COMPLETED" || statusStr === "1" || data?.status === 1 || statusStr === "2" || data?.status === 2 || statusStr.includes("SUCC") || statusStr.includes("PAID");

    if (!isSuccess) {
      const callbackStatus = String(bodyData.status || payload.status || "").toUpperCase();
      isSuccess = callbackStatus === "SUCCEEDED" || callbackStatus === "SUCCESS" || callbackStatus === "PAID" || callbackStatus === "COMPLETED" || callbackStatus === "1" || bodyData.status === 1 || callbackStatus === "2" || bodyData.status === 2 || callbackStatus.includes("SUCC") || callbackStatus.includes("PAID");
      if (isSuccess) {
        data = bodyData.status ? bodyData : payload;
      }
    }

    if (!isSuccess) {
      const failedStatus = statusStr === "FAILED" || statusStr === "REJECTED" || statusStr === "-1" || data?.status === -1 || bodyData.status === -1;
      if (failedStatus && tx.status === "pending") {
        tx.status = "failed";
        tx.description = `OmniPay Deposit Failed (Ref: ${orderNo})`;
        await tx.save().catch(() => {});
      }
      return res.status(200).send("SUCCESS");
    }

    const commission = parseFloat(o.commission_percent) || 0;
    const paidAmount = parseFloat(data?.actual_amount || data?.amount || bodyData.amount || payload.amount || 0);
    const creditAmount = (tx && parseFloat(tx.amount) > 0)
      ? parseFloat(tx.amount)
      : (commission > 0 ? parseFloat((paidAmount / (1 + commission / 100)).toFixed(2)) : paidAmount);

    const { calculateDepositBonus } = require("../utils/paymentBonus");
    const { totalCredit, bonusAmount, bonusDesc } = calculateDepositBonus(creditAmount, o);

    let updatedUser;
    let hadDeposited = false;

    await withTransaction(async (session) => {
      const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };

      const doubleCheckTx = await Transaction.findOne({ reference: orderNo }, null, queryOptions);
      if (!doubleCheckTx || doubleCheckTx.status === "completed") {
        throw new Error("ALREADY_CREDITED");
      }

      const user = process.env.DB_TYPE === "mysql"
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
      doubleCheckTx.description = `OmniPay Deposit (Ref: ${orderNo})${bonusDesc}`;
      if (process.env.DB_TYPE === "mysql") {
        await doubleCheckTx.save(queryOptions);
      } else {
        await doubleCheckTx.save(queryOptions);
      }

      const { processReferralBonus } = require("../utils/referralBonus");
      await processReferralBonus(updatedUser, creditAmount, hadDeposited, queryOptions).catch(e => console.error("Referral bonus error:", e));
    });

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
