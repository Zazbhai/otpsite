const express  = require("express");
const router   = express.Router();
const bcrypt   = require("bcryptjs");
const crypto   = require("crypto");
const { isAdminEmail, createToken } = require("../middleware/auth");
const { loginRequired } = require("../middleware/auth");
const User = require("../models/User");
const Setting = require("../models/Setting");

async function verifyPassword(password, storedHash) {
  if (!storedHash || !password) return false;
  if (storedHash.startsWith("pbkdf2$")) {
    const parts = storedHash.split("$");
    if (parts.length === 3) {
      const salt = parts[1];
      const expectedHash = parts[2];
      const iterations = [100000, 10000, 1000, 20000, 25000, 50000];
      const digests = ["sha256", "sha512"];
      for (const iter of iterations) {
        for (const dig of digests) {
          for (const s of [salt, Buffer.from(salt, "hex")]) {
            try {
              const derived = crypto.pbkdf2Sync(password, s, iter, 32, dig).toString("hex");
              if (derived === expectedHash) return true;
            } catch (e) {}
          }
        }
      }
    }
    return false;
  }
  return await bcrypt.compare(password, storedHash);
}


const { nanoid } = require("nanoid");
const { DB_TYPE } = require("../utils/db");


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
      const sEnabled = await Setting.findOne({ key: "referral_system_enabled" });
      const isEnabled = sEnabled?.value === true || sEnabled?.value === 'true';


      if (isEnabled) {
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
    }



    const user = await User.create({
      username,
      email: email.toLowerCase(),
      password_hash,
      display_name: username,
      avatar_color: randomColor(),
      is_admin: isAdmin,
      referral_code,
      referred_by: referrer_id,
      api_key: nanoid(32)
    });


    const token = createToken(user._id.toString(), isAdmin);

    const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.cookie("token", token, {
      httpOnly: false,
      secure: isSecure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });

    return res.status(201).json({ token, user: { ...publicUser(user), referral_code } });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/auth/referral-info/:code ───────────────────────────
router.get("/referral-info/:code", async (req, res) => {
  try {
    const { code } = req.params;
    if (!code) return res.status(400).json({ error: "Code is required" });

    let referrer = await User.findOne({ referral_code: code }).select("username display_name");
    if (!referrer && code.match(/^[0-9a-fA-F]{24}$/)) {
      referrer = await User.findById(code).select("username display_name");
    }

    if (!referrer) return res.status(404).json({ error: "Referrer not found" });

    res.json({ 
      name: referrer.display_name || referrer.username,
      username: referrer.username 
    });
  } catch (err) {
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

    const match = await verifyPassword(password, user.password_hash);
    if (!match) return res.status(401).json({ error: "Invalid email or password" });

    // Transparently upgrade legacy PBKDF2 hash to bcrypt on successful login
    if (user.password_hash && user.password_hash.startsWith("pbkdf2$")) {
      user.password_hash = await bcrypt.hash(password, 12);
      await user.save();
    }

    // Promote to admin if email is in ADMIN_EMAILS list (handle newly added admins)
    if (isAdminEmail(email) && !user.is_admin) {
      user.is_admin = true;
      await user.save();
    }

    const token = createToken(user._id.toString(), user.is_admin);
    
    // Set cookie for browser-based page routes (like /admin)
    const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.cookie("token", token, {
      httpOnly: false,
      secure: isSecure,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "lax",
    });

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
    const match = await verifyPassword(current_password, user.password_hash);
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

    const keys = [
      "default_theme", "site_name", "site_logo", "site_favicon", "primary_color",
      "seo_title", "seo_description", "seo_keywords", "seo_og_image",
      "custom_css", "head_scripts", "foot_scripts", "exchange_rates",
      "maintenance_mode", "referral_bonus_percent", "referral_bonus_fixed_amount", "referral_system_enabled",
      "disable_immersive_animation",
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

    const m = await Setting.findOne({ key: "maintenance_mode" });
    res.json({ maintenance: m ? (m.value === "true" || m.value === true) : false });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// ── GET /api/auth/broadcast ──────────────────────────────────────
router.get("/broadcast", async (req, res) => {
  try {
    const bc = await Setting.findOne(DB_TYPE === "mysql" ? { where: { key: "site_broadcast" } } : { key: "site_broadcast" });
    if (!bc || !bc.value) return res.json({ active: false, data: [] });
    
    let data;
    try {
      data = JSON.parse(bc.value);
      if (!Array.isArray(data)) data = [data];
    } catch(e) { data = []; }

    // Sort newest first
    const sorted = [...data].reverse();
    res.json({ active: sorted.length > 0, data: sorted });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/auth/stream  (SSE — real-time push) ─────────────────
// In-module SSE client store: userId -> Set of response objects
const sseClients = new Map();

function sseAddClient(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);
}
function sseRemoveClient(userId, res) {
  const set = sseClients.get(userId);
  if (set) { set.delete(res); if (!set.size) sseClients.delete(userId); }
}

router.get("/stream", async (req, res) => {
  const token = req.query.token || (req.headers["authorization"] || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  let userId;
  try {
    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
    userId = String(decoded.user_id || decoded.id);
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`event: connected\ndata: {}\n\n`);
  sseAddClient(userId, res);

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { /* closed */ }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseRemoveClient(userId, res);
  });
});

// ── POST /api/auth/logout ────────────────────────────────────────
router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

// Attach SSE push helpers directly to the router object so they survive module.exports = router
router.ssePush = function(userId, event, data) {
  const set = sseClients.get(String(userId));
  if (!set) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  set.forEach(res => { try { res.write(msg); } catch { /* client gone */ } });
};

router.ssePushAll = function(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(set => {
    set.forEach(res => { try { res.write(msg); } catch { /* client gone */ } });
  });
};

module.exports = router;
