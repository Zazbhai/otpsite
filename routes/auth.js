const express  = require("express");
const router   = express.Router();
const bcrypt   = require("bcryptjs");
const { isAdminEmail, createToken } = require("../middleware/auth");
const { loginRequired } = require("../middleware/auth");
const User = require("../models/User");
const { addClient, removeClient } = require("../utils/realtimeEmitter");

// ── SSE Real-time Stream ──────────────────────────────────────────
// GET /api/auth/stream
router.get("/stream", (req, res) => {
  const token = req.query.token || (req.headers.authorization || "").replace("Bearer ", "");
  let userId = null;
  try {
    if (token) {
      const { decodeToken } = require("../middleware/auth");
      const payload = decodeToken(token);
      userId = payload?.user_id ? String(payload.user_id) : null;
    }
  } catch (_) {}

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, userId })}\n\n`);

  addClient(userId, res);

  req.on("close", () => removeClient(userId, res));
});

// ── Helpers ──────────────────────────────────────────────────────
const COLORS = ["#3b82f6","#6366f1","#8b5cf6","#ec4899","#10b981","#f59e0b","#06b6d4"];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

function publicUser(u) {
  return {
    id:           u._id,
    username:     u.username,
    email:        u.email,
    display_name: u.display_name || u.username,
    avatar_color: u.avatar_color,
    balance:      u.balance,
    is_admin:     u.is_admin,
    total_spent:  u.total_spent,
    total_orders: u.total_orders,
    created_at:   u.createdAt,
    currency:     u.currency || "INR",
  };
}

// ── POST /api/auth/register ──────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password)
      return res.status(400).json({ error: "username, email and password are required" });

    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters" });

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username))
      return res.status(400).json({ error: "Username must be 3–30 alphanumeric characters or underscores" });

    const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (exists) {
      const field = exists.email === email.toLowerCase() ? "email" : "username";
      return res.status(409).json({ error: `That ${field} is already taken` });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const isAdmin = isAdminEmail(email);

    // Generate unique referral code
    const referral_code = Math.random().toString(36).substring(2, 10).toUpperCase();
    
    // Check for referrer
    let referrer_id = null;
    const refInput = req.body.referral_code;
    if (refInput) {
      // 1. Try custom referral code
      let referrer = await User.findOne({ referral_code: refInput });
      
      // 2. Try User ID as fallback (if refInput looks like a MongoDB ID)
      if (!referrer && refInput.match(/^[0-9a-fA-F]{24}$/)) {
        referrer = await User.findById(refInput);
      }

      if (referrer) {
        referrer_id = referrer._id.toString();
        // Increment referrer's count
        await User.findByIdAndUpdate(referrer._id, { $inc: { referral_count: 1 } });
      }
    }

    const user = await User.create({
      username,
      email: email.toLowerCase(),
      password_hash,
      display_name: username,
      avatar_color: randomColor(),
      is_admin: isAdmin,
      referral_code,
      referred_by: referrer_id
    });

    const token = createToken(user._id.toString(), isAdmin);
    return res.status(201).json({ token, user: { ...publicUser(user), referral_code } });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password are required" });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    if (user.is_banned)
      return res.status(403).json({ error: "Your account has been suspended. Contact support." });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: "Invalid email or password" });

    // Promote to admin if email is in ADMIN_EMAILS list (handle newly added admins)
    if (isAdminEmail(email) && !user.is_admin) {
      user.is_admin = true;
      await user.save();
    }

    const token = createToken(user._id.toString(), user.is_admin);
    return res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────
router.get("/me", loginRequired, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: publicUser(user), is_admin: req.isAdmin });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/auth/change-password ───────────────────────────────
router.post("/change-password", loginRequired, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password)
      return res.status(400).json({ error: "Both passwords required" });
    if (new_password.length < 6)
      return res.status(400).json({ error: "New password must be at least 6 characters" });

    const user = await User.findById(req.userId);
    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return res.status(401).json({ error: "Current password is incorrect" });

    user.password_hash = await bcrypt.hash(new_password, 12);
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/auth/settings ──────────────────────────────────────
router.get("/settings", async (req, res) => {
  try {
    const Setting = require("../models/Setting");
    const keys = [
      "default_theme", "site_name", "site_logo", "site_favicon", "primary_color",
      "seo_title", "seo_description", "seo_keywords", "seo_og_image",
      "custom_css", "head_scripts", "foot_scripts", "exchange_rates",
      "maintenance_mode", "referral_bonus_percent", "referral_bonus_fixed_amount", "referral_system_enabled",
      "social_channel", "support_email", "social_whatsapp", "support_contact", "support_telegram", "support_discord"
    ];
    const settings = await Setting.find({ key: { $in: keys } });
    const obj = {};
    settings.forEach(s => obj[s.key] = s.value);
    res.json(obj);
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// ── GET /api/auth/status ─────────────────────────────────────────
router.get("/status", async (req, res) => {
  try {
    const Setting = require("../models/Setting");
    const m = await Setting.findOne({ key: "maintenance_mode" });
    res.json({ maintenance: m ? (m.value === "true" || m.value === true) : false });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// ── GET /api/auth/broadcast ──────────────────────────────────────
router.get("/broadcast", async (req, res) => {
  try {
    const Setting = require("../models/Setting");
    const bc = await Setting.findOne({ key: "site_broadcast" });
    if (!bc || !bc.value) return res.json({ active: false });
    res.json({ active: true, data: JSON.parse(bc.value) });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
