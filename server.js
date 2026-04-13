require("dotenv").config();
const express  = require("express");
const mongoose = require("mongoose");
const cors     = require("cors");
const morgan   = require("morgan");
const path     = require("path");
const rateLimit = require("express-rate-limit");

const app  = express();
const PORT = process.env.PORT || 5000;

/* ─── Middleware ──────────────────────────────────────────────── */
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

// Basic rate limiting on API
// Increased rate limiting to support high-frequency polling (3s intervals)
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, max: 2000, standardHeaders: true, legacyHeaders: false }));

/* ─── Static Files ───────────────────────────────────────────── */
app.use(express.static(path.join(__dirname, "public")));

/* ─── API Routes ─────────────────────────────────────────────── */
app.use("/api/auth",  require("./routes/auth"));
app.use("/api/user",  require("./routes/user"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/admin/readymade", require("./routes/accounts-admin"));
app.use("/api/accounts", require("./routes/accounts"));

// API Gateway (SMS handler API standard)
app.use("/stubs/handler_api.php", require("./routes/apiGateway"));

/* ─── HTML Page Routes ───────────────────────────────────────── */
const views = path.join(__dirname, "views");

// Public
app.get("/",             (_, res) => res.sendFile(path.join(views, "index.html")));
app.get("/pricing",      (_, res) => res.sendFile(path.join(views, "pricing.html")));
app.get("/api-docs",     (_, res) => res.sendFile(path.join(views, "api-docs.html")));
app.get("/how-it-works", (_, res) => res.sendFile(path.join(views, "how-it-works.html")));
app.get("/terms",        (_, res) => res.sendFile(path.join(views, "terms.html")));
app.get("/support",      (_, res) => res.sendFile(path.join(views, "support.html")));

// User portal
app.get("/dashboard",             (_, res) => res.sendFile(path.join(views, "dashboard.html")));
app.get("/dashboard/buy",         (_, res) => res.sendFile(path.join(views, "buy.html")));
app.get("/dashboard/orders",      (_, res) => res.sendFile(path.join(views, "orders.html")));
app.get("/dashboard/orders/:id",  (_, res) => res.sendFile(path.join(views, "order-detail.html")));
app.get("/dashboard/wallet",      (_, res) => res.sendFile(path.join(views, "wallet.html")));
app.get("/dashboard/profile",     (_, res) => res.sendFile(path.join(views, "profile.html")));
app.get("/dashboard/accounts",    (_, res) => res.sendFile(path.join(views, "accounts.html")));

// Admin panel
app.get("/admin",               (_, res) => res.sendFile(path.join(views, "admin", "index.html")));
app.get("/admin/users",         (_, res) => res.sendFile(path.join(views, "admin", "users.html")));
app.get("/admin/users/:id",     (_, res) => res.sendFile(path.join(views, "admin", "user-detail.html")));
app.get("/admin/orders",        (_, res) => res.sendFile(path.join(views, "admin", "orders.html")));
app.get("/admin/orders/:id",    (_, res) => res.sendFile(path.join(views, "admin", "order-detail.html")));
app.get("/admin/services",      (_, res) => res.sendFile(path.join(views, "admin", "services.html")));
app.get("/admin/countries",     (_, res) => res.sendFile(path.join(views, "admin", "countries.html")));
app.get("/admin/servers",       (_, res) => res.sendFile(path.join(views, "admin", "servers.html")));
app.get("/admin/payments",      (_, res) => res.sendFile(path.join(views, "admin", "payments.html")));
app.get("/admin/transactions",  (_, res) => res.sendFile(path.join(views, "admin", "transactions.html")));
app.get("/admin/broadcast",     (_, res) => res.sendFile(path.join(views, "admin", "broadcast.html")));
app.get("/admin/settings",      (_, res) => res.sendFile(path.join(views, "admin", "settings.html")));
app.get("/admin/analytics",     (_, res) => res.sendFile(path.join(views, "admin", "analytics.html")));
app.get("/admin/readymade",     (_, res) => res.sendFile(path.join(views, "admin", "readymade.html")));
app.get("/admin/promo-codes",   (_, res) => res.sendFile(path.join(views, "admin", "promo-codes.html")));

// 404
app.use((_, res) => res.status(404).sendFile(path.join(views, "404.html")));

/* ─── MongoDB ────────────────────────────────────────────────── */
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/RapidOTP";
mongoose.set("strictQuery", false);

async function connectMongo(retries = 0) {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    console.log("✅ MongoDB connected");
  } catch (err) {
    const delay = Math.min(5000 * (retries + 1), 30000);
    console.warn(`⚠️  MongoDB retry in ${delay / 1000}s… (${err.message})`);
    setTimeout(() => connectMongo(retries + 1), delay);
  }
}

/* ─── Start ──────────────────────────────────────────────────── */
const os = require("os");
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  connectMongo();
  
  // Start background order monitoring
  try {
    const { startWatcher } = require("./utils/orderWatcher");
    startWatcher();
  } catch (err) {
    console.error("❌ Failed to start Order Watcher:", err.message);
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
  console.log(`🚀 Rapid OTP running on:`);
  console.log(`   - Local:  http://localhost:${PORT}`);
  console.log(`   - LAN:    http://${localIp}:${PORT}`);
  connectMongo();
});

// Handle port-already-in-use gracefully
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is in use. Run this to free it:`);
    console.error(`   Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force`);
    process.exit(1);
  } else {
    throw err;
  }
});
