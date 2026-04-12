const express  = require("express");
const router   = express.Router();
const mongoose = require("mongoose");
const { loginRequired } = require("../middleware/auth");
const AccountCategory  = require("../models/AccountCategory");
const ReadymadeAccount = require("../models/ReadymadeAccount");
const Transaction      = require("../models/Transaction");
const User             = require("../models/User");

router.use(loginRequired);

/* ─── LIST CATEGORIES (public within dashboard) ─────────────────── */
router.get("/categories", async (req, res) => {
  try {
    const Setting = require("../models/Setting");
    const s = await Setting.findOne({ key: "readymade_accounts_enabled" });
    if (s && s.value === "false") return res.json([]); // feature disabled
    const cats = await AccountCategory.find({ is_active: true }).sort({ sort_order: 1, name: 1 });
    const result = await Promise.all(cats.map(async c => {
      const stock = await ReadymadeAccount.countDocuments({ category_id: c._id, status: "available" });
      return { ...c.toObject(), stock };
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

/* ─── PURCHASE ───────────────────────────────────────────────────── */
router.post("/buy/:categoryId", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findById(req.userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(401).json({ error: "User not found" });
    }

    const cat = await AccountCategory.findOne({ _id: req.params.categoryId, is_active: true }).session(session);
    if (!cat) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Category not found" });
    }

    const account = await ReadymadeAccount.findOneAndUpdate(
      { category_id: cat._id, status: "available" },
      { $set: { status: "sold", sold_to: req.userId, sold_at: new Date(), price_at_sale: cat.price } },
      { sort: { createdAt: 1 }, new: true, session }
    ).session(session);
    if (!account) {
      await session.abortTransaction();
      return res.status(400).json({ error: "Out of stock — no accounts available in this category" });
    }

    const newBalance = parseFloat((user.balance - Number(cat.price)).toFixed(4));
    if (newBalance < 0) {
      await session.abortTransaction();
      return res.status(402).json({ error: "Insufficient balance. Please top up your wallet." });
    }

    user.balance      = newBalance;
    user.total_spent  = parseFloat(((user.total_spent || 0) + Number(cat.price)).toFixed(4));
    user.total_orders = (user.total_orders || 0) + 1;
    await user.save({ session });

    await Transaction.create([{
      user_id:       req.userId,
      type:          "purchase",
      amount:        -Number(cat.price),
      balance_after: user.balance,
      description:   `Readymade Account: ${cat.name}`,
      reference:     account._id.toString(),
      status:        "completed",
    }], { session });

    await session.commitTransaction();
    res.json({
      ok: true,
      category: cat.name,
      credentials: account.credentials,
      notes: account.notes,
      price: cat.price,
      balance_after: user.balance,
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: "Server error" });
  } finally {
    session.endSession();
  }
});

/* ─── GET USER'S PURCHASED ACCOUNTS ─────────────────────────────── */
router.get("/my-purchases", async (req, res) => {
  try {
    const accounts = await ReadymadeAccount.find({ sold_to: req.userId, status: "sold" })
      .populate("category_id", "name icon")
      .sort({ sold_at: -1 });
    res.json(accounts);
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

module.exports = router;
