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
      const stock = await ReadymadeAccount.countDocuments({ 
        category_id: c._id || c.id, 
        status: "available" 
      });
      return { ...c.toObject(), stock };
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

/* ─── PURCHASE ───────────────────────────────────────────────────── */
router.post("/buy/:categoryId", async (req, res) => {
  const { withTransaction } = require("../utils/db");
  
  try {
    const result = await withTransaction(async (session) => {
      const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };

      const user = await User.findById(req.userId, queryOptions);
      if (!user) throw new Error("USER_NOT_FOUND");

      let cat;
      if (process.env.DB_TYPE === "mysql") {
        cat = await AccountCategory.findOne({ where: { id: req.params.categoryId, is_active: true }, ...queryOptions });
      } else {
        cat = await AccountCategory.findOne({ _id: req.params.categoryId, is_active: true }, null, queryOptions);
      }
      
      if (!cat) throw new Error("CATEGORY_NOT_FOUND");

      // Check balance before locking account record
      const newBalance = parseFloat((user.balance - Number(cat.price)).toFixed(4));
      if (newBalance < 0) throw new Error("INSUFFICIENT_BALANCE");

      // Find and lock one available account
      let account;
      if (process.env.DB_TYPE === "mysql") {
        const { Op } = require("sequelize");
        account = await ReadymadeAccount.findOne({
          where: { category_id: cat.id, status: "available" },
          order: [["createdAt", "ASC"]],
          ...queryOptions,
          lock: session.LOCK?.UPDATE || true
        });
        if (account) {
          await account.update({
            status: "sold",
            sold_to: req.userId,
            sold_at: new Date(),
            price_at_sale: cat.price
          }, queryOptions);
        }
      } else {
        account = await ReadymadeAccount.findOneAndUpdate(
          { category_id: cat._id || cat.id, status: "available" },
          { $set: { status: "sold", sold_to: req.userId, sold_at: new Date(), price_at_sale: cat.price } },
          { sort: { createdAt: 1 }, new: true, session }
        );
      }

      if (!account) throw new Error("OUT_OF_STOCK");

      user.balance = newBalance;
      user.total_spent = parseFloat(((user.total_spent || 0) + Number(cat.price)).toFixed(4));
      user.total_orders = (user.total_orders || 0) + 1;
      await user.save(queryOptions);

      await Transaction.create({
        user_id: req.userId,
        type: "purchase",
        amount: -Number(cat.price),
        balance_after: user.balance,
        description: `Readymade Account: ${cat.name}`,
        reference: account._id?.toString() || account.id?.toString(),
        status: "completed",
      }, queryOptions);

      return {
        category: cat.name,
        credentials: account.credentials,
        notes: account.notes,
        price: cat.price,
        balance_after: user.balance,
      };
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.message === "INSUFFICIENT_BALANCE") return res.status(402).json({ error: "Insufficient balance. Please top up your wallet." });
    if (err.message === "OUT_OF_STOCK") return res.status(400).json({ error: "Out of stock — no accounts available in this category" });
    if (err.message === "CATEGORY_NOT_FOUND") return res.status(404).json({ error: "Category not found" });
    
    console.error("Account purchase error:", err);
    res.status(500).json({ error: "Server error" });
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
