const express  = require("express");
const router   = express.Router();
const { adminRequired } = require("../middleware/auth");
const AccountCategory   = require("../models/AccountCategory");
const ReadymadeAccount  = require("../models/ReadymadeAccount");

router.use(adminRequired);

/* ─── CATEGORIES ──────────────────────────────────────────────── */

// List all categories
router.get("/categories", async (req, res) => {
  try {
    const catIdField = 'category_id';
    
    const cats = await AccountCategory.find().sort({ sort_order: 1, createdAt: -1 });
    // Attach stock count for each
    const withStock = await Promise.all(cats.map(async c => {
      const cid = c.id || c._id;
      const available = await ReadymadeAccount.countDocuments({ [catIdField]: cid, status: "available" });
      const sold      = await ReadymadeAccount.countDocuments({ [catIdField]: cid, status: "sold" });
      return { ...c.toObject(), available, sold };
    }));
    res.json(withStock);
  } catch (err) { 
    console.error("List categories error:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

// Create category
router.post("/categories", async (req, res) => {
  try {
    const { name, description, icon, price, is_active, sort_order } = req.body;
    if (!name || price == null) return res.status(400).json({ error: "name and price are required" });
    const cat = await AccountCategory.create({ name, description, icon, price, is_active, sort_order });
    res.json(cat);
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// Update category
router.patch("/categories/:id", async (req, res) => {
  try {
    const cat = await AccountCategory.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!cat) return res.status(404).json({ error: "Category not found" });
    res.json(cat);
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// Delete category (only if no available accounts remain)
router.delete("/categories/:id", async (req, res) => {
  try {
    const count = await ReadymadeAccount.countDocuments({ 
      category_id: req.params.id, 
      status: "available" 
    });
    if (count > 0) return res.status(400).json({ error: "Remove all available accounts first" });
    await AccountCategory.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { 
    console.error("Delete category error:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

/* ─── ACCOUNTS ────────────────────────────────────────────────── */

// List accounts in a category (paginated)
router.get("/categories/:id/accounts", async (req, res) => {
  try {
    const catIdField = 'category_id';
    
    const { page = 1, limit = 50, status } = req.query;
    const filter = { [catIdField]: req.params.id };
    if (status) filter.status = status;
    const total    = await ReadymadeAccount.countDocuments(filter);
    const accounts = await ReadymadeAccount.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    res.json({ accounts, total });
  } catch (err) { 
    console.error("List accounts error:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

// Bulk add accounts (newline-separated credentials)
router.post("/categories/:id/accounts/bulk", async (req, res) => {
  try {
    const catIdField = 'category_id';
    
    const cat = await AccountCategory.findById(req.params.id);
    if (!cat) return res.status(404).json({ error: "Category not found" });
    const lines = (req.body.credentials || "")
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);
    if (!lines.length) return res.status(400).json({ error: "No credentials provided" });
    const notes = req.body.notes || "";
    const docs = lines.map(cred => ({ [catIdField]: req.params.id, credentials: cred, notes: notes }));
    const result = await ReadymadeAccount.insertMany(docs);
    res.json({ added: result.length });
  } catch (err) { 
    console.error("Bulk add accounts error:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

// Delete single account
router.delete("/accounts/:id", async (req, res) => {
  try {
    await ReadymadeAccount.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

/* ─── GLOBAL FEATURE TOGGLE ──────────────────────────────────── */
const Setting = require("../models/Setting");
const FEATURE_KEY = "readymade_accounts_enabled";

router.get("/settings", async (req, res) => {
  try {
    const s = await Setting.findOne({ key: FEATURE_KEY });
    res.json({ enabled: s ? s.value === "true" : true }); // default ON
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

router.post("/settings/toggle", async (req, res) => {
  try {
    const s = await Setting.findOne({ key: FEATURE_KEY });
    const current = s ? s.value === "true" : true;
    const next = !current;
    await Setting.findOneAndUpdate(
      { key: FEATURE_KEY },
      { key: FEATURE_KEY, value: String(next) },
      { upsert: true, new: true }
    );
    res.json({ enabled: next });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

module.exports = router;
