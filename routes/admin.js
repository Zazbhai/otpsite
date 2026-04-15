const express  = require("express");
const router   = express.Router();
const bcrypt   = require("bcryptjs");
const { adminRequired } = require("../middleware/auth");
const User        = require("../models/User");
const Order       = require("../models/Order");
const Service     = require("../models/Service");
const Server      = require("../models/Server");
const Transaction = require("../models/Transaction");
const Setting     = require("../models/Setting");
const Country     = require("../models/Country");
const multer      = require("multer");
const path        = require("path");
const fs          = require("fs");
const { DB_TYPE } = require("../utils/db");

// Multer Config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../public/uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

router.use(adminRequired);

/* ─── ANALYTICS ────────────────────────────────────────────────── */
router.get("/analytics", async (req, res) => {
  try {
    const now = new Date();
    
    // Start of today (local basic assumption)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thirtyDaysAgo = new Date(now - 30 * 864e5);
    const fourteenDaysAgo = new Date(now - 14 * 864e5);

    // Basic Counts
    const totalUsers = await User.countDocuments();
    const todayUsersList = await User.find({ createdAt: { $gte: todayStart } });
    const todayUsers = todayUsersList.length;

    // Deposits
    const depositPipeline = await Transaction.aggregate([
      { $match: { type: "deposit" } },
      { $group: {
          _id: null,
          total: { $sum: "$amount" },
          today: { $sum: { $cond: [{ $gte: ["$createdAt", todayStart] }, "$amount", 0] } }
        }
      }
    ]);
    const totalDeposits = depositPipeline[0]?.total || 0;
    const todayDeposits = depositPipeline[0]?.today || 0;

    // Revenue (from Orders)
    const orderPipeline = await Order.aggregate([
      { $match: { status: "completed" } },
      { $group: {
          _id: null,
          total: { $sum: "$cost" },
          today: { $sum: { $cond: [{ $gte: ["$createdAt", todayStart] }, "$cost", 0] } }
        }
      }
    ]);
    const totalRevenue = orderPipeline[0]?.total || 0;
    const todayRevenue = orderPipeline[0]?.today || 0;

    // Additional Order Context
    const totalOrders = await Order.countDocuments();
    const activeOrders = await Order.countDocuments({ status: "active" });

    // Graphs: Daily Data (Last 14 Days)
    const dailyDeposits = await Transaction.aggregate([
      { $match: { type: "deposit", createdAt: { $gte: fourteenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, total: { $sum: "$amount" } } },
      { $sort: { _id: 1 } }
    ]);
    
    const dailyRevenue = await Order.aggregate([
      { $match: { status: "completed", createdAt: { $gte: fourteenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, total: { $sum: "$cost" } } },
      { $sort: { _id: 1 } }
    ]);

    const userGrowth = await User.aggregate([
      { $match: { createdAt: { $gte: fourteenDaysAgo } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // Pie Chart: Top Services
    const topServices = await Order.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: "$service_name", count: { $sum: 1 }, revenue: { $sum: "$cost" } } },
      { $sort: { count: -1 } },
      { $limit: 6 }
    ]);

    // ── User Perspective Stats ──
    const userStats = await User.aggregate([
      { $group: {
          _id: null,
          totalLiability: { $sum: "$balance" },
          totalSpent: { $sum: "$total_spent" }
        }
      }
    ]);
    const totalLiability = userStats[0]?.totalLiability || 0;
    const lifetimeVolume = userStats[0]?.totalSpent || 0;

    const orderStats = await Order.aggregate([
      { $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } }
        }
      }
    ]);
    const totalAttempts = orderStats[0]?.total || 0;
    const completedOrders = orderStats[0]?.completed || 0;
    const successRate = totalAttempts > 0 ? (completedOrders / totalAttempts) : 0;

    // Group orders by status for Pie Chart (treat expired as cancelled)
    const osDist = await Order.aggregate([
      {
        $project: {
          normalizedStatus: {
            $cond: [{ $eq: ["$status", "expired"] }, "cancelled", "$status"]
          }
        }
      },
      { $group: { _id: "$normalizedStatus", count: { $sum: 1 } } }
    ]);

    res.json({
      metrics: {
        totalUsers, todayUsers,
        totalDeposits, todayDeposits,
        totalRevenue, todayRevenue,
        totalOrders, activeOrders,
        totalLiability, lifetimeVolume, successRate
      },
      graphs: {
        dailyDeposits,
        dailyRevenue,
        userGrowth
      },
      topServices,
      orderDistribution: osDist
    });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

/* ─── USERS ────────────────────────────────────────────────────── */
router.get("/users", async (req, res) => {
  try {
    const { q, page = 1, limit = 30, banned } = req.query;
    const filter = {};
    if (q) filter.$or = [
      { username:     new RegExp(q, "i") },
      { email:        new RegExp(q, "i") },
      { display_name: new RegExp(q, "i") },
    ];
    if (banned !== undefined) filter.is_banned = banned === "true";

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select("-password_hash")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ users, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

router.get("/users/:id", async (req, res) => {
  try {
    const user   = await User.findById(req.params.id).select("-password_hash");
    if (!user) return res.status(404).json({ error: "User not found" });
    const orders       = await Order.find({ user_id: req.params.id }).sort({ createdAt: -1 }).limit(10);
    const transactions = await Transaction.find({ user_id: req.params.id }).sort({ createdAt: -1 }).limit(10);
    res.json({ user, recent_orders: orders, recent_transactions: transactions });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

router.patch("/users/:id", async (req, res) => {
  try {
    const { balance, is_banned, notes, is_admin } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (balance   !== undefined) user.balance   = parseFloat(balance);
    if (is_banned !== undefined) user.is_banned = is_banned;
    if (is_admin  !== undefined) user.is_admin  = is_admin;
    if (notes     !== undefined) user.notes     = notes;
    await user.save();
    res.json({ user });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

router.post("/users/:id/login-as", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    
    const { createToken } = require("../middleware/auth");
    const token = createToken(user._id.toString(), user.is_admin);
    const publicUser = {
      id: user._id, username: user.username, email: user.email, display_name: user.display_name || user.username,
      avatar_color: user.avatar_color, balance: user.balance, is_admin: user.is_admin,
      total_spent: user.total_spent, total_orders: user.total_orders, created_at: user.createdAt
    };
    
    res.json({ token, user: publicUser });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

/* ─── ORDERS ───────────────────────────────────────────────────── */
router.get("/orders", async (req, res) => {
  try {
    const { status, page = 1, limit = 30, user_id } = req.query;
    const filter = {};
    if (status && status !== "all") {
      if (status === "cancelled") {
        filter.status = { $in: ["cancelled", "expired"] };
      } else {
        filter.status = status;
      }
    }
    if (user_id) filter.user_id = user_id;

    const total  = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ orders, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

router.patch("/orders/:id", async (req, res) => {
  try {
    const { status, otp } = req.body;
    const order = await Order.findOne({ order_id: req.params.id });
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (status === "refunded" && order.status !== "refunded") {
      await User.findByIdAndUpdate(order.user_id, { $inc: { balance: order.cost } });
      await Transaction.create({
        user_id: order.user_id, type: "refund", amount: order.cost,
        description: `Refund for order ${order.order_id}`, order_id: order.order_id,
      });
    }
    if (status) order.status = status;
    if (otp)    { order.otp = otp; order.all_otps.push(otp); }
    await order.save();
    res.json({ order });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

/* ─── SERVICES ─────────────────────────────────────────────────── */
router.get("/services", async (_, res) => res.json(await Service.find().sort({ name: 1 })));

router.post("/services", upload.single("logo"), async (req, res) => {
  try {
    const { server_id, name, service_code, price, is_active, icon_color } = req.body;
    if (!server_id) return res.status(400).json({ error: "Server selection is required" });
    
    let server;
    if (DB_TYPE === "mysql") {
      server = await Server.findByPk(server_id);
      if (server) {
        const country = await Country.findByPk(server.country_id);
        server.country_code = country ? country.code : "IN";
      }
    } else {
      server = await Server.findById(server_id).populate("country_id", "code");
      if (server && server.country_id) server.country_code = server.country_id.code;
    }

    if (!server) return res.status(404).json({ error: "Server not found" });
    
    let logo_url = "";
    if (req.file) logo_url = "/uploads/" + req.file.filename;

    const serviceData = {
      name,
      server_id,
      service_code,
      country_code: server.country_code || "IN",
      price: parseFloat(price),
      is_active: String(is_active) === "true",
      image_url: logo_url,
      icon_color: icon_color || "#3b82f6",
      check_interval: parseInt(req.body.check_interval) || 3
    };

    const service = await Service.create(serviceData);
    res.status(201).json(service);
  } catch (err) { 
    console.error("[Admin/Services] Create Error:", err.message);
    res.status(400).json({ error: err.message }); 
  }
});

router.put("/services/:id", upload.single("logo"), async (req, res) => {
  try {
    const { server_id, name, service_code, price, is_active, icon_color } = req.body;
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ error: "Service not found" });

    if (server_id) {
       let server;
       if (DB_TYPE === "mysql") {
         server = await Server.findByPk(server_id);
         if (server) {
           const country = await Country.findByPk(server.country_id);
           service.country_code = country ? country.code : service.country_code;
         }
       } else {
         server = await Server.findById(server_id).populate("country_id", "code");
         if (server && server.country_id) service.country_code = server.country_id.code;
       }
       service.server_id = server_id;
    }

    if (name) service.name = name;
    if (service_code) service.service_code = service_code;
    if (price !== undefined) service.price = parseFloat(price);
    if (is_active !== undefined) service.is_active = String(is_active) === "true";
    if (icon_color !== undefined) service.icon_color = icon_color;
    if (req.body.check_interval !== undefined) service.check_interval = parseInt(req.body.check_interval) || 3;

    if (req.file) {
      console.log("[Admin/Services] New logo for", service.name, ":", req.file.filename);
      if (service.image_url && service.image_url.startsWith("/uploads/")) {
        const oldFile = path.basename(service.image_url);
        const oldPath = path.join(__dirname, "../public/uploads", oldFile);
        try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch(e) {}
      }
      service.image_url = "/uploads/" + req.file.filename;
    }

    await service.save();
    res.json(service);
  } catch (err) { 
    console.error("[Admin/Services] Update Error:", err.message);
    res.status(400).json({ error: err.message }); 
  }
});

router.delete("/services/:id", async (req, res) => {
  await Service.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

/* ─── COUNTRIES ────────────────────────────────────────────────── */
router.get("/countries", async (_, res) => {
  try {
    const countries = await Country.find().sort({ sort_order: 1, name: 1 });
    res.json(countries);
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

router.post("/countries", async (req, res) => {
  try {
    const { code, name, flag, is_active, sort_order } = req.body;
    if (!code || !name) return res.status(400).json({ error: "Code and name are required" });
    const country = await Country.create({ code, name, flag, is_active, sort_order });
    res.status(201).json(country);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put("/countries/:id", async (req, res) => {
  try {
    const country = await Country.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!country) return res.status(404).json({ error: "Country not found" });
    res.json(country);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete("/countries/:id", async (req, res) => {
  try {
    const serversUsing = await Server.countDocuments({ country_id: req.params.id });
    if (serversUsing > 0) {
      return res.status(400).json({ error: `Cannot delete: ${serversUsing} server(s) use this country` });
    }
    await Country.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

/* ─── SERVERS ──────────────────────────────────────────────────── */
router.get("/servers", async (_, res) => res.json(await Server.find().sort({ name: 1 })));

router.post("/servers", async (req, res) => {
  try { 
    console.log("[DEBUG] Create Server Body:", req.body);
    res.status(201).json(await Server.create(req.body)); 
  }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put("/servers/:id", async (req, res) => {
  try { 
    console.log("[DEBUG] Update Server Body:", req.body);
    res.json(await Server.findByIdAndUpdate(req.params.id, req.body, { new: true })); 
  }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete("/servers/:id", async (req, res) => {
  await Server.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

/* ─── TRANSACTIONS ─────────────────────────────────────────────── */
router.get("/transactions", async (req, res) => {
  try {
    const { type, user_id, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (type    && type    !== "all") filter.type    = type;
    if (user_id)                      filter.user_id = user_id;

    const total        = await Transaction.countDocuments(filter);
    const transactions = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ transactions, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

router.post("/transactions/deposit", async (req, res) => {
  try {
    const { user_id, amount, description } = req.body;
    if (!user_id || amount == null) return res.status(400).json({ error: "user_id and amount are required" });
    
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }

    const user = await User.findById(user_id);
    if (!user) return res.status(404).json({ error: "User not found" });
    user.balance = parseFloat((user.balance + parsedAmount).toFixed(4));
    await user.save();
    await Transaction.create({
      user_id, type: "deposit", amount: parsedAmount,
      balance_after: user.balance,
      description: description || "Manual deposit by admin",
    });
    res.json({ balance: user.balance });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

/* ─── SETTINGS ─────────────────────────────────────────────────── */
router.get("/settings", async (_, res) => {
  const settings = await Setting.find();
  const obj = {};
  settings.forEach((s) => (obj[s.key] = s.value));
  res.json(obj);
});

router.post("/settings", async (req, res) => {
  try {
    const ops = Object.entries(req.body).map(([key, value]) => ({
      updateOne: { filter: { key }, update: { $set: { key, value } }, upsert: true },
    }));
    await Setting.bulkWrite(ops);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

/* ─── BROADCAST ────────────────────────────────────────────────── */
router.post("/broadcast", async (req, res) => {
  try {
    const { text, btn_text, btn_url } = req.body;
    const entry = { text, btn_text, btn_url, id: Date.now().toString() };
    await Setting.updateOne(
      { key: "site_broadcast" },
      { $set: { value: JSON.stringify(entry) } },
      { upsert: true }
    );
    res.json({ success: true, message: "Broadcast saved!" });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});


/* ─── PROMO CODES ──────────────────────────────────────────────── */
const PromoCode = require("../models/PromoCode");

router.get("/promo-codes", async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const total = await PromoCode.countDocuments();
    const codes = await PromoCode.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    res.json({ codes, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

router.post("/promo-codes", async (req, res) => {
  try {
    const { code, amount, usage_limit } = req.body;
    if (!code || !amount) return res.status(400).json({ error: "Code and amount are required" });
    const promo = await PromoCode.create({ code: code.toUpperCase(), amount, usage_limit });
    res.status(201).json(promo);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete("/promo-codes/:id", async (req, res) => {
  try {
    await PromoCode.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

/* ─── PAYMENT CONFIG ────────────────────────────────────────── */
const CONFIG_PATH = path.join(__dirname, "../payment_config.json");

router.get("/payment-config", (req, res) => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return res.json({ bharatpe: { enabled: false } });
    }
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    res.json(data);
  } catch (err) { res.status(500).json({ error: "Failed to read config" }); }
});

router.post("/payment-config", (req, res) => {
  try {
    const config = req.body;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Failed to save config" }); }
});

module.exports = router;
