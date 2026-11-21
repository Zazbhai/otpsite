const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET environment variable is required in production");
}

// Emails listed in env are auto-promoted to admin
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

function createToken(userId, isAdmin = false) {
  return jwt.sign(
    { user_id: userId, is_admin: isAdmin },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function decodeToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/** Extract JWT from Authorization header, cookie, or query param */
function extractToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return req.cookies?.token || req.query?.token || "";
}

const { verifyIntegrity } = require("./integrity");

function sendUnauthorized(req, res) {
  const isApi = req.path.startsWith("/api/");
  if (!isApi && req.accepts("html")) {
    return res.status(401).send(`
      <div style="font-family:'Inter',sans-serif; text-align:center; padding:50px; background:#05060b; color:#fff; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; background-image: radial-gradient(circle at 50% 50%, #111827 0%, #000 100%);">
        <div style="padding:40px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:32px; backdrop-filter:blur(20px); box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
          <div style="font-size:64px; margin-bottom:20px">🔐</div>
          <h1 style="color:#fff; font-size:32px; margin-bottom:12px; font-weight:800; letter-spacing:-1px">Session Expired</h1>
          <p style="font-size:16px; color:#9ca3af; margin-bottom:32px; line-height:1.6">Your session has ended. Please log in again to continue.</p>
          <a href="/index.html?login=1" style="display:inline-block; padding:14px 32px; background:#3b82f6; color:#fff; text-decoration:none; border-radius:14px; font-weight:700; transition:0.3s; box-shadow:0 10px 20px rgba(59,130,246,0.3)">Back to Login</a>
        </div>
      </div>
    `);
  }
  return res.status(401).json({ error: "Unauthorized — please log in" });
}

function loginRequired(req, res, next) {
  const payload = decodeToken(extractToken(req));
  if (!payload) return sendUnauthorized(req, res);
  req.userId = payload.user_id;
  req.isAdmin = payload.is_admin;
  next();
}

/** Middleware: require admin JWT or check DB if stale */
async function adminRequired(req, res, next) {
  // 1. Check Central Integrity First (to show debug logs in terminal)
  const isAuthorized = await verifyIntegrity(req);
  if (!isAuthorized) {
    const { protectSource } = require("./integrity");
    return protectSource(req, res, next);
  }

  // 2. Check Session
  const token = extractToken(req);
  const payload = decodeToken(token);
  
  if (!payload) {
    console.log(`[Session Check] Failed. Token found: ${!!token}, Payload decoded: ${!!payload}`);
    return sendUnauthorized(req, res);
  }

  {
    const User = require("../models/User");
    try {
      const user = await User.findById(payload.user_id);
      if (!user || (!user.is_admin && !isAdminEmail(user.email))) {
        return res.status(403).json({ error: "Forbidden — admin only" });
      }
      if (!user.is_admin && isAdminEmail(user.email)) {
        user.is_admin = true;
        await user.save();
      }
    } catch {
      return res.status(403).json({ error: "Forbidden — admin only" });
    }
  }

  req.userId = payload.user_id;
  req.isAdmin = true;
  next();
}

function optionalLogin(req, res, next) {
  const payload = decodeToken(extractToken(req));
  if (payload) {
    req.userId = payload.user_id;
    req.isAdmin = payload.is_admin;
  }
  next();
}

module.exports = {
  isAdminEmail,
  createToken,
  decodeToken,
  loginRequired,
  adminRequired,
  optionalLogin
};
