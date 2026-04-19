require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const { getCachedSettings } = require("./utils/settingsCache");

const app = express();
const cookieParser = require("cookie-parser");
const PORT = process.env.PORT || 5000;

/* ─── Middleware ──────────────────────────────────────────────── */
app.use(cookieParser());
// NOTE: Helmet removed — it was blocking onclick= handlers via script-src-attr.
// Add back only in production with explicit scriptSrcAttr: ["'unsafe-inline'"]

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : [];
app.use(cors({
  origin: ALLOWED_ORIGINS.length > 0
    ? (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin))
    : false,
  credentials: true,
}));
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("trust proxy", 1);

// Basic rate limiting on API
// Increased rate limiting to support high-frequency polling (3s intervals)
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, max: 2000, standardHeaders: true, legacyHeaders: false }));
// Maintenance Mode Interceptor
app.use(async (req, res, next) => {
  const { isMaintenanceOn } = require("./utils/maintenance");
  const { decodeToken } = require("./middleware/auth");
  
  // Allow these paths even during maintenance:
  const allowedPaths = [
    "/maintenance", 
    "/api/auth/status", 
    "/api/auth/login",
    "/api/auth/settings",
    "/login",
    "/register",
    "/img/", 
    "/css/", 
    "/js/", 
    "/favicon.ico",
    "/uploads/",
    "/api/auth/status",
    "/api/auth/settings"
  ];
  
  const isAllowed = allowedPaths.some(p => req.path.startsWith(p));
  
  // Check if current user is admin via token
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (req.cookies?.token || req.query?.token || "");
  const payload = decodeToken(token);
  const isUserAdmin = payload && payload.is_admin === true;

  const isAdminPath = req.path.startsWith("/admin") || req.path.startsWith("/api/admin");

  // Bypass maintenance if:
  // 1. Path is explicitly allowed (login, assets, status)
  // 2. Path is an admin path (to allow login/mgmt during outage)
  // 3. User is an authenticated ADMIN
  if (!isAllowed && !isAdminPath && !isUserAdmin) {
    if (await isMaintenanceOn()) {
      if (req.path.startsWith("/api/")) {
        return res.status(503).json({ error: "Under Maintenance", maintenance: true });
      }
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.redirect("/maintenance");
    }
  }
  next();
});

// Database Health Check Middleware
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    const { DB_TYPE } = require("./utils/db");
    const { connection } = require("mongoose");
    if (DB_TYPE === "mongodb" && connection.readyState !== 1) {
      return res.status(503).json({ message: "Database connection lost. Please check your internet or retry later." });
    }
  }
  next();
});

/* ─── Static Files ───────────────────────────────────────────── */
app.use(express.static(path.join(__dirname, "public")));

/* ─── API Routes ─────────────────────────────────────────────── */
app.use("/api/auth", require("./routes/auth"));
app.use("/api/user", require("./routes/user"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/admin/readymade", require("./routes/accounts-admin"));
app.use("/api/accounts", require("./routes/accounts"));

// API Gateway (SMS handler API standard)
app.use("/stubs/handler_api.php", require("./routes/apiGateway"));

/* ─── HTML Page Routes ───────────────────────────────────────── */
const views = path.join(__dirname, "views");

const pageCache = new Map();

async function renderPage(res, filename) {
  try {
    const settings = await getCachedSettings();
    let html;

    // Simple in-memory cache for HTML templates
    if (pageCache.has(filename) && process.env.NODE_ENV === "production") {
      html = pageCache.get(filename);
    } else {
      html = fs.readFileSync(path.join(views, filename), "utf8");
      if (process.env.NODE_ENV === "production") pageCache.set(filename, html);
    }

    // Core Branding... (replacements continue below)
    const siteName = settings.site_name || "Zaz";
    const siteLogo = settings.site_logo || "/img/logo.png";
    const siteFavicon = (settings.site_favicon && settings.site_favicon !== "null") ? settings.site_favicon : "/favicon.ico";

    // SEO & Meta
    const seoTitle = settings.seo_title || `${siteName} — Instant Virtual Numbers for SMS Verification`;
    const seoDesc = settings.seo_description || `Get instant virtual phone numbers for ${siteName}. Receive OTP online for WhatsApp, Telegram, and 500+ services. Reliable, fast, and secure virtual numbers globally.`;
    const seoKeys = settings.seo_keywords || `otp, sms verification, virtual numbers, ${siteName}, receive sms online, burner number, private phone numbers, bypass otp`;
    const seoOg = settings.seo_og_image || "/img/og-preview.png";

    // Perform replacements
    const replacements = {
      "{{SITE_NAME}}": siteName,
      "{{SITE_LOGO}}": siteLogo,
      "{{SITE_FAVICON}}": siteFavicon,
      "{{SITE_URL}}": settings.site_url || process.env.SITE_URL || process.env.WEBSITE_URL || "https://your-site.com",
      "{{SEO_TITLE}}": seoTitle,
      "{{SEO_DESC}}": seoDesc,
      "{{SEO_KEYWORDS}}": seoKeys,
      "{{SEO_OG_IMAGE}}": seoOg
    };

    for (const [key, value] of Object.entries(replacements)) {
      html = html.replace(new RegExp(key, "g"), value);
    }

    res.send(html);
  } catch (err) {
    console.error("Render error:", err);
    res.sendFile(path.join(views, filename));
  }
}

// Public
app.get("/", (_, res) => renderPage(res, "index.html"));
app.get("/pricing", (_, res) => renderPage(res, "pricing.html"));
app.get("/api-docs", (_, res) => renderPage(res, "api-docs.html"));
app.get("/how-it-works", (_, res) => renderPage(res, "how-it-works.html"));
app.get("/terms", (_, res) => renderPage(res, "terms.html"));
app.get("/support", (_, res) => renderPage(res, "support.html"));
app.get("/maintenance", (_, res) => renderPage(res, "maintenance.html"));

// User portal
app.get("/dashboard", (_, res) => renderPage(res, "dashboard.html"));
app.get("/dashboard/buy", (_, res) => renderPage(res, "buy.html"));
app.get("/dashboard/orders", (_, res) => renderPage(res, "orders.html"));
app.get("/dashboard/orders/:id", (_, res) => renderPage(res, "order-detail.html"));
app.get("/dashboard/wallet", (_, res) => renderPage(res, "wallet.html"));
app.get("/dashboard/profile", (_, res) => renderPage(res, "profile.html"));
app.get("/dashboard/referrals", (_, res) => renderPage(res, "referrals.html"));
app.get("/dashboard/accounts", (_, res) => renderPage(res, "accounts.html"));

// Admin panel
app.get("/admin", (_, res) => renderPage(res, "admin/index.html"));
app.get("/admin/users", (_, res) => renderPage(res, "admin/users.html"));
app.get("/admin/users/:id", (_, res) => renderPage(res, "admin/user-detail.html"));
app.get("/admin/orders", (_, res) => renderPage(res, "admin/orders.html"));
app.get("/admin/orders/:id", (_, res) => renderPage(res, "admin/order-detail.html"));
app.get("/admin/services", (_, res) => renderPage(res, "admin/services.html"));
app.get("/admin/countries", (_, res) => renderPage(res, "admin/countries.html"));
app.get("/admin/servers", (_, res) => renderPage(res, "admin/servers.html"));
app.get("/admin/payments", (_, res) => renderPage(res, "admin/payments.html"));
app.get("/admin/transactions", (_, res) => renderPage(res, "admin/transactions.html"));
app.get("/admin/broadcast", (_, res) => renderPage(res, "admin/broadcast.html"));
app.get("/admin/settings", (_, res) => renderPage(res, "admin/settings.html"));
app.get("/admin/analytics", (_, res) => renderPage(res, "admin/analytics.html"));
app.get("/admin/readymade", (_, res) => renderPage(res, "admin/readymade.html"));
app.get("/admin/promo-codes", (_, res) => renderPage(res, "admin/promo-codes.html"));
app.get("/admin/referrals", (_, res) => renderPage(res, "admin/referrals.html"));

// global 404
app.use((_, res) => res.status(404).sendFile(path.join(views, "404.html")));

// Global Error Handler Safety Net
app.use((err, req, res, next) => {
  console.error("GLOBAL_ERROR:", err.stack || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

/* ─── Database ────────────────────────────────────────────────── */
const { connectDB } = require("./utils/db");

/* ─── Start ──────────────────────────────────────────────────── */
const { log } = require("./utils/db");
const os = require("os");

const server = app.listen(PORT, "0.0.0.0", async () => {
  log(`🚀 Server starting on port ${PORT}...`);

  try {
    await connectDB();
    log("✅ Database initialized successfully.");

    // Start background services ONLY after DB is ready
    const { startWatcher } = require("./utils/orderWatcher");
    startWatcher();
    log("🕒 Order Watcher started.");

    const { startCurrencyUpdater } = require("./utils/currencyUpdater");
    startCurrencyUpdater();
    log("💰 Currency Updater started.");

  } catch (err) {
    log("❌ Critical Startup Error: " + err.message);
  }

  const nets = os.networkInterfaces();
  let localIp = "localhost";
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        localIp = net.address;
        break;
      }
    }
  }
  log(`🚀 Rapid OTP fully ready at http://${localIp}:${PORT}`);
});

// Handle port-already-in-use gracefully
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const cmd = process.platform === "win32"
      ? `Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force`
      : `fuser -k ${PORT}/tcp`;
    console.error(`   ${cmd}`);
    process.exit(1);
  } else {
    throw err;
  }
});
