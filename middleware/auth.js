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

function loginRequired(req, res, next) {
  const payload = decodeToken(extractToken(req));
  if (!payload) return res.status(401).json({ error: "Unauthorized — please log in" });
  req.userId   = payload.user_id;
  req.isAdmin  = payload.is_admin;
  next();
}

/** Middleware: require admin JWT or check DB if stale */
async function adminRequired(req, res, next) {
  const payload = decodeToken(extractToken(req));
  if (!payload) return res.status(401).json({ error: "Unauthorized — please log in" });
  
  if (!payload.is_admin) {
    // Check if they were recently promoted without relogging
    const User = require("../models/User");
    try {
      const user = await User.findById(payload.user_id);
      if (!user || (!user.is_admin && !isAdminEmail(user.email))) {
        return res.status(403).json({ error: "Forbidden — admin only" });
      }
      // Auto promote in DB if needed
      if (!user.is_admin && isAdminEmail(user.email)) {
        user.is_admin = true;
        await user.save();
      }
    } catch {
      return res.status(403).json({ error: "Forbidden — admin only" });
    }
  }

  req.userId  = payload.user_id;
  req.isAdmin = true;
  next();
}

module.exports = {
  isAdminEmail,
  createToken,
  decodeToken,
  loginRequired,
  adminRequired,
};
