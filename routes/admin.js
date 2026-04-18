const express  = require("express");
const router   = express.Router();
const bcrypt   = require("bcryptjs");
const mongoose = require("mongoose");
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
const { clearSettingsCache } = require("../utils/settingsCache");
const { emitToAll, emitToUser } = require("../utils/realtimeEmitter");

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

    const totalUsers = await User.countDocuments();
    const todayUsers = await User.countDocuments({ createdAt: { [DB_TYPE === "mysql" ? require("sequelize").Op.gte : "$gte"]: todayStart } });
    const totalOrders = await Order.countDocuments();
    const activeOrders = await Order.countDocuments({ status: "active" });

    let metrics = { totalUsers, todayUsers, totalOrders, activeOrders };
    let graphs = { dailyDeposits: [], dailyRevenue: [], userGrowth: [] };
    let topServices = [];
    let orderDistribution = [];

    if (DB_TYPE === "mysql") {
      const { Op, fn, col } = require("sequelize");
      
      const [depRes, todayDepRes, revRes, todayRevRes, liabRes, volRes] = await Promise.all([
        Transaction.findAll({ attributes: [[fn('SUM', col('amount')), 'total']], where: { type: 'deposit' }, raw: true }),
        Transaction.findAll({ attributes: [[fn('SUM', col('amount')), 'total']], where: { type: 'deposit', createdAt: { [Op.gte]: todayStart } }, raw: true }),
        Order.findAll({ attributes: [[fn('SUM', col('cost')), 'total']], where: { status: 'completed' }, raw: true }),
        Order.findAll({ attributes: [[fn('SUM', col('cost')), 'total']], where: { status: 'completed', createdAt: { [Op.gte]: todayStart } }, raw: true }),
        User.findAll({ attributes: [[fn('SUM', col('balance')), 'total']], raw: true }),
        User.findAll({ attributes: [[fn('SUM', col('total_spent')), 'total']], raw: true })
      ]);

      const totalDeposits = parseFloat(depRes[0]?.total || 0);
      const todayDeposits = parseFloat(todayDepRes[0]?.total || 0);
      const totalRevenue  = parseFloat(revRes[0]?.total || 0);
      const todayRevenue  = parseFloat(todayRevRes[0]?.total || 0);
      const totalLiability = parseFloat(liabRes[0]?.total || 0);
      const lifetimeVolume = parseFloat(volRes[0]?.total || 0);

      const totalAttempts = await Order.count();
      const completedCount = await Order.count({ where: { status: 'completed' } });
      const successRate = totalAttempts > 0 ? (completedCount / totalAttempts) : 0;
      metrics = { ...metrics, totalDeposits, todayDeposits, totalRevenue, todayRevenue, totalLiability, lifetimeVolume, successRate };

      graphs.dailyDeposits = await Transaction.findAll({
        attributes: [[fn('DATE', col('createdAt')), 'date'], [fn('SUM', col('amount')), 'total']],
        where: { type: 'deposit', createdAt: { [Op.gte]: fourteenDaysAgo } },
        group: [fn('DATE', col('createdAt'))],
        order: [[fn('DATE', col('createdAt')), 'ASC']]
      }).then(res => res.map(r => ({ _id: r.get('date'), total: r.get('total') })));

      graphs.dailyRevenue = await Order.findAll({
        attributes: [[fn('DATE', col('createdAt')), 'date'], [fn('SUM', col('cost')), 'total']],
        where: { status: 'completed', createdAt: { [Op.gte]: fourteenDaysAgo } },
        group: [fn('DATE', col('createdAt'))],
        order: [[fn('DATE', col('createdAt')), 'ASC']]
      }).then(res => res.map(r => ({ _id: r.get('date'), total: r.get('total') })));

      graphs.userGrowth = await User.findAll({
        attributes: [[fn('DATE', col('createdAt')), 'date'], [fn('COUNT', col('id')), 'count']],
        where: { createdAt: { [Op.gte]: fourteenDaysAgo } },
        group: [fn('DATE', col('createdAt'))],
        order: [[fn('DATE', col('createdAt')), 'ASC']]
      }).then(res => res.map(r => ({ _id: r.get('date'), count: r.get('count') })));

      topServices = await Order.findAll({
        attributes: ['service_name', [fn('COUNT', col('id')), 'count'], [fn('SUM', col('cost')), 'revenue']],
        where: { status: 'completed' },
        group: ['service_name'], order: [[fn('COUNT', col('id')), 'DESC']], limit: 6
      }).then(res => res.map(r => ({ _id: r.service_name, count: r.get('count'), revenue: r.get('revenue') })));

      const rawDist = await Order.findAll({ attributes: ['status', [fn('COUNT', col('id')), 'count']], group: ['status'] });
      const distMap = { active: 0, completed: 0, cancelled: 0 };
      rawDist.forEach(r => {
        const s = r.status === 'expired' ? 'cancelled' : r.status;
        distMap[s] = (distMap[s] || 0) + r.get('count');
      });
      orderDistribution = Object.entries(distMap).map(([k, v]) => ({ _id: k, count: v }));
    } else {
      // Original MongoDB Aggregations
      const depositPipeline = await Transaction.aggregate([{ $match: { type: "deposit" } },{ $group: { _id: null, total: { $sum: "$amount" }, today: { $sum: { $cond: [{ $gte: ["$createdAt", todayStart] }, "$amount", 0] } } } }]);
      const orderPipeline = await Order.aggregate([{ $match: { status: "completed" } },{ $group: { _id: null, total: { $sum: "$cost" }, today: { $sum: { $cond: [{ $gte: ["$createdAt", todayStart] }, "$cost", 0] } } } }]);
      const userStats = await User.aggregate([{ $group: { _id: null, totalLiability: { $sum: "$balance" }, totalSpent: { $sum: "$total_spent" } } }]);
      const orderStats = await Order.aggregate([{ $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } } } }]);
      metrics = { ...metrics, totalDeposits: depositPipeline[0]?.total || 0, todayDeposits: depositPipeline[0]?.today || 0, totalRevenue: orderPipeline[0]?.total || 0, todayRevenue: orderPipeline[0]?.today || 0, totalLiability: userStats[0]?.totalLiability || 0, lifetimeVolume: userStats[0]?.totalSpent || 0, successRate: orderStats[0]?.total > 0 ? (orderStats[0]?.completed / orderStats[0]?.total) : 0 };
      graphs.dailyDeposits = await Transaction.aggregate([{ $match: { type: "deposit", createdAt: { $gte: fourteenDaysAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, total: { $sum: "$amount" } } }, { $sort: { _id: 1 } }]);
      graphs.dailyRevenue = await Order.aggregate([{ $match: { status: "completed", createdAt: { $gte: fourteenDaysAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, total: { $sum: "$cost" } } }, { $sort: { _id: 1 } }]);
      graphs.userGrowth = await User.aggregate([{ $match: { createdAt: { $gte: fourteenDaysAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
      topServices = await Order.aggregate([{ $match: { status: "completed" } }, { $group: { _id: "$service_name", count: { $sum: 1 }, revenue: { $sum: "$cost" } } }, { $sort: { count: -1 } }, { $limit: 6 }]);
      orderDistribution = await Order.aggregate([{ $project: { normalizedStatus: { $cond: [{ $eq: ["$status", "expired"] }, "cancelled", "$status"] } } }, { $group: { _id: "$normalizedStatus", count: { $sum: 1 } } }]);
    }

    res.json({
      metrics,
      graphs,
      topServices,
      orderDistribution
    });
  } catch (err) { 
    console.error("Analytics Error:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

/* ─── USERS ────────────────────────────────────────────────────── */
router.get("/users", async (req, res) => {
  try {
    const { q, page = 1, limit = 30, banned } = req.query;
    const filter = {};
    
    if (q) {
      if (DB_TYPE === "mysql") {
        const { Op } = require("sequelize");
        filter[Op.or] = [
          { username:     { [Op.like]: `%${q}%` } },
          { email:        { [Op.like]: `%${q}%` } },
          { display_name: { [Op.like]: `%${q}%` } }
        ];
        if (q.match(/^\d+$/)) filter[Op.or].push({ id: q });
      } else {
        const orClauses = [
          { username:     new RegExp(q, "i") },
          { email:        new RegExp(q, "i") },
          { display_name: new RegExp(q, "i") },
        ];
        if (mongoose.Types.ObjectId.isValid(q)) {
          orClauses.push({ _id: new mongoose.Types.ObjectId(q) });
        }
        filter.$or = orClauses;
      }
    }
    if (banned !== undefined) filter.is_banned = banned === "true";

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select("-password_hash")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ users, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

router.post("/users", async (req, res) => {
  try {
    const { username, email, password, is_admin } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: "Username, email and password are required" });

    // Check if user exists
    let existing;
    if (DB_TYPE === "mysql") {
      const { Op } = require("sequelize");
      existing = await User.findOne({ where: { [Op.or]: [{ email }, { username }] } });
    } else {
      existing = await User.findOne({ $or: [{ email }, { username }] });
    }
    if (existing) return res.status(400).json({ error: "Email or username already in use" });

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);
    
    const user = await User.create({
      username,
      email,
      password_hash,
      is_admin: is_admin === true,
      balance: 0,
      total_spent: 0,
      avatar_color: '#' + Math.floor(Math.random()*16777215).toString(16)
    });

    res.status(201).json({ user: { id: user._id || user.id, username: user.username, email: user.email } });
  } catch (err) {
    console.error("ADMIN_USER_CREATE_ERROR:", err);
    res.status(500).json({ error: "Failed to create user: " + err.message });
  }
});

router.get("/users/:id", async (req, res) => {
  try {
    const user   = await User.findById(req.params.id).select("-password_hash");
    if (!user) return res.status(404).json({ error: "User not found" });
    const orders       = await Order.find({ user_id: req.params.id }).sort({ createdAt: -1 }).limit(10);
    const transactions = await Transaction.find({ user_id: req.params.id }).sort({ createdAt: -1 }).limit(10);
    res.json({ user, recent_orders: orders, recent_transactions: transactions });
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

router.patch("/users/:id", async (req, res) => {
  try {
    const { balance, is_banned, notes, is_admin } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Protect Super Admin from demotion/ban
    const superAdminEmails = (process.env.ADMIN_EMAILS || "").toLowerCase().split(",").map(e => e.trim());
    const isSuperAdmin = superAdminEmails.includes(user.email.toLowerCase());

    if (isSuperAdmin) {
      if (is_admin === false) {
        return res.status(403).json({ error: "Security Restriction: Super Admin privileges cannot be revoked." });
      }
      if (is_banned === true) {
        return res.status(403).json({ error: "Security Restriction: Super Admin account cannot be banned." });
      }
    }

    if (balance   !== undefined) user.balance   = parseFloat(balance);
    if (is_banned !== undefined) user.is_banned = is_banned;
    if (is_admin  !== undefined) user.is_admin  = is_admin;
    if (notes     !== undefined) user.notes     = notes;
    await user.save();
    res.json({ user });
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
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
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
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
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

router.patch("/orders/:id", async (req, res) => {
  try {
    const { status, otp } = req.body;
    const order = await Order.findOne({ order_id: req.params.id });
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (status === "refunded" && order.status !== "refunded") {
      const user = await User.findById(order.user_id);
      if (user) {
        user.balance = parseFloat((user.balance + order.cost).toFixed(4));
        await user.save();
      }
      await Transaction.create({
        user_id: order.user_id, type: "refund", amount: order.cost,
        description: `Refund for order ${order.order_id}`, order_id: order.order_id,
      });
    }
    if (status) order.status = status;
    if (otp)    { order.otp = otp; order.all_otps = [...order.all_otps, otp]; }
    await order.save();
    emitToUser(String(order.user_id), "order", { orderId: order.order_id, status: order.status, otp: order.otp, all_otps: order.all_otps });
    res.json({ order });
  } catch (err) { 
    console.error("Admin order update error:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

/* ─── SERVICES ─────────────────────────────────────────────────── */
router.get("/services", async (req, res) => {
  try {
    const { server_id, min_price, max_price, auto_added, name } = req.query;
    const filter = {};
    if (name) filter.name = { $regex: name, $options: "i" };
    if (server_id) filter.server_id = server_id;
    if (min_price || max_price) {
      filter.price = {};
      if (min_price) filter.price.$gte = parseFloat(min_price);
      if (max_price) filter.price.$lte = parseFloat(max_price);
    }
    if (auto_added === "true") filter.is_auto = true;
    else if (auto_added === "false") filter.is_auto = false;

    const services = await Service.find(filter)
      .sort({ name: 1 })
      .populate({
        path: "server_id",
        populate: { path: "country_id" }
      });
      
    return res.json(services);
  } catch (err) {
    console.error("[Admin/Services] Fetch Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

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
    
    // Check for existing service on this server with same code or name
    const existing = await Service.findOne({
      server_id,
      $or: [
        { service_code: service_code },
        { name: { $regex: new RegExp(`^${name}$`, "i") } }
      ]
    });
    if (existing) {
       return res.status(400).json({ error: `Service already exists on this server (Code/Name match)` });
    }

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
      check_interval: parseInt(req.body.check_interval) || 3,
      is_auto: false
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

    // Duplicate check for updates
    const checkServer = server_id || service.server_id;
    const checkName = name || service.name;
    const checkCode = service_code || service.service_code;

    const existing = await Service.findOne({
      _id: { $ne: req.params.id },
      server_id: checkServer,
      $or: [
        { service_code: checkCode },
        { name: { $regex: new RegExp(`^${checkName}$`, "i") } }
      ]
    });
    if (existing) {
      return res.status(400).json({ error: "Another service with same Name/Code exists on this server" });
    }

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
        service.server_id_attr = server_id;
        service.server_id = server_id;
     }

    if (name) service.name = name;
    if (service_code) service.service_code = service_code;
    if (price !== undefined) service.price = parseFloat(price);
    if (is_active !== undefined) service.is_active = String(is_active) === "true";
    if (icon_color !== undefined) service.icon_color = icon_color;
    if (req.body.check_interval !== undefined) service.check_interval = parseInt(req.body.check_interval) || 3;
    
    // Once manually edited, it's no longer 'auto'
    service.is_auto = false;

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

router.delete("/services/bulk/:server_id", async (req, res) => {
  try {
    const { server_id } = req.params;
    const { min, max, is_auto, auto_only } = req.query;
    let deletedCount = 0;
    
    if (DB_TYPE === "mysql") {
      const { Op } = require("sequelize");
      const where = { server_id_attr: server_id };
      if (min || max) {
        where.price = {};
        if (min) where.price[Op.gte] = parseFloat(min);
        if (max) where.price[Op.lte] = parseFloat(max);
      }
      if (is_auto === "true" || auto_only === "true") where.is_auto = 1;
      else if (is_auto === "false") where.is_auto = 0;
      
      deletedCount = await Service.destroy({ where });
    } else {
      const filter = { server_id };
      if (min || max) {
        filter.price = {};
        if (min) filter.price.$gte = parseFloat(min);
        if (max) filter.price.$lte = parseFloat(max);
      }
      if (is_auto === "true" || auto_only === "true") filter.is_auto = true;
      else if (is_auto === "false") filter.is_auto = false;
      const result = await Service.deleteMany(filter);
      deletedCount = result.deletedCount;
    }
    res.json({ ok: true, deletedCount });
  } catch (err) {
    console.error("[Admin/Services] Bulk Delete Error:", err.message);
    res.status(500).json({ error: "Failed to bulk delete services: " + err.message });
  }
});

/* ─── COUNTRIES ────────────────────────────────────────────────── */
router.get("/countries", async (_, res) => {
  try {
    const countries = await Country.find().sort({ sort_order: 1, name: 1 });
    res.json(countries);
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
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
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

/* ─── SERVERS ──────────────────────────────────────────────────── */
router.get("/servers", async (_, res) => res.json(await Server.find().sort({ name: 1 }).populate("country_id")));

router.post("/servers", async (req, res) => {
  try { 
    if (DB_TYPE === "mysql" && req.body.country_id) {
       req.body.country_id_attr = req.body.country_id;
    }
    const server = await Server.create(req.body); 
    
    if (req.body.auto_add_services) {
      const fs = require('fs');
      const path = require('path');
      const servicesPath = path.join(__dirname, "../services.json");
      
      if (fs.existsSync(servicesPath)) {
        const servicesData = JSON.parse(fs.readFileSync(servicesPath, 'utf-8'));
        
        let countryCode = "IN";
        const Country = require("../models/Country");
        const Service = require("../models/Service");
        
        if (server.country_id_attr || server.country_id) {
           const country = await Country.findById(server.country_id_attr || server.country_id);
           if (country) countryCode = country.code;
        }

        const sFindQuery = DB_TYPE === "mysql" ? { server_id_attr: server.id } : { server_id: server._id }; const existingServices = await Service.find(sFindQuery);
        const existingCodes = new Set(existingServices.map(s => s.service_code));
        const existingNames = new Set(existingServices.map(s => s.name.toLowerCase()));

        const servicesToCreate = [];
        const extraProfit = parseFloat(req.body.extra_profit || 0);
        for (const item of servicesData) {
           if (existingCodes.has(item.code) || existingNames.has(item.name.toLowerCase())) continue;
           
           servicesToCreate.push({
             name: item.name,
             server_id: server.id || server._id,      // Virtual/Legacy
             server_id_attr: server.id || server._id, // Real Sequelize Attribute
             service_code: item.code,
             country_code: countryCode,
             price: (item.price || 5.0) + extraProfit,
             is_active: true,
             icon_color: item.color,
             is_auto: true
           });
        }
        if (servicesToCreate.length > 0) {
           console.log(`[Admin/Servers] Auto-adding ${servicesToCreate.length} for server: ${server.id || server._id}`);
           await Service.insertMany(servicesToCreate);
           console.log(`[Admin/Servers] Auto-added ${servicesToCreate.length} NEW services to server`);
        }
      }
    }

    res.status(201).json(server); 
  }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put("/servers/:id", async (req, res) => {
  try { 
    console.log("[DEBUG] Update Server Body:", req.body);
    if (DB_TYPE === "mysql" && req.body.country_id) req.body.country_id_attr = req.body.country_id;
    const server = await Server.findByIdAndUpdate(req.params.id, req.body, { new: true }); 
    
    if (req.body.auto_add_services) {
      const fs = require('fs');
      const path = require('path');
      const servicesPath = path.join(__dirname, "../services.json");
      
      if (fs.existsSync(servicesPath)) {
        const servicesData = JSON.parse(fs.readFileSync(servicesPath, 'utf-8'));
        
        let countryCode = "IN";
        const Country = require("../models/Country");
        const Service = require("../models/Service");
        
        if (server.country_id_attr || server.country_id) {
           const country = await Country.findById(server.country_id_attr || server.country_id);
           if (country) countryCode = country.code;
        }

        const sFindQuery2 = DB_TYPE === "mysql" ? { server_id_attr: server.id } : { server_id: server._id }; const existingServices = await Service.find(sFindQuery2);
        const existingCodes = new Set(existingServices.map(s => s.service_code));
        const existingNames = new Set(existingServices.map(s => s.name.toLowerCase()));

        const servicesToCreate = [];
        const extraProfit = parseFloat(req.body.extra_profit || 0);
        for (const item of servicesData) {
           if (existingCodes.has(item.code) || existingNames.has(item.name.toLowerCase())) continue;

           servicesToCreate.push({
             name: item.name,
             server_id: server.id || server._id,
             server_id_attr: server.id || server._id,
             service_code: item.code,
             country_code: countryCode,
             price: (item.price || 5.0) + extraProfit,
             is_active: true,
             icon_color: item.color,
             is_auto: true
           });
        }
        if (servicesToCreate.length > 0) {
           console.log(`[Admin/Servers] Auto-adding ${servicesToCreate.length} for EXISTING server: ${server.id || server._id}`);
           await Service.insertMany(servicesToCreate);
           console.log(`[Admin/Servers] Auto-added ${servicesToCreate.length} NEW services to existing server`);
        }
      }
    }

    res.json(server); 
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
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
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
    emitToUser(String(user_id), "balance", { balance: user.balance }); // Real-time balance push
    res.json({ balance: user.balance });
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

/* ─── SETTINGS ─────────────────────────────────────────────────── */
router.get("/settings", async (_, res) => {
  try {
    const settings = await Setting.find();
    const obj = {};
    settings.forEach((s) => (obj[s.key] = s.value));
    res.json(obj);
  } catch (err) {
    console.error("ADMIN_SETTINGS_GET_ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/settings", async (req, res) => {
  try {
    if (DB_TYPE === "mysql") {
      for (const [key, value] of Object.entries(req.body)) {
        await Setting.findOne({ where: { key } }).then(async s => {
          if (s) await s.update({ value });
          else await Setting.create({ key, value });
        });
      }
    } else {
      const ops = Object.entries(req.body).map(([key, value]) => ({
        updateOne: { filter: { key }, update: { $set: { key, value } }, upsert: true },
      }));
      await Setting.bulkWrite(ops);
    }
    clearSettingsCache();
    emitToAll("settings", {});
    res.json({ ok: true });
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
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
    emitToAll("broadcast", entry); // Push broadcast message to all users instantly
    res.json({ success: true, message: "Broadcast saved!" });
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
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
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
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
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

/* ─── REFERRALS ────────────────────────────────────────────────── */
router.get("/referrals-stats", async (req, res) => {
  try {
    const totalReferrals = await User.countDocuments({ referred_by: { [DB_TYPE === "mysql" ? require("sequelize").Op.ne : "$ne"]: null } });
    let totalEarnings = 0;
    
    if (DB_TYPE === "mysql") {
      const { fn, col } = require("sequelize");
      const res = await User.findAll({ attributes: [[fn("SUM", col("referral_earnings")), "total"]], raw: true });
      totalEarnings = parseFloat(res[0]?.total || 0);
    } else {
      const e = await User.aggregate([{ $group: { _id: null, total: { $sum: "$referral_earnings" } } }]);
      totalEarnings = e[0]?.total || 0;
    }
    
    const topReferrers = await User.find({ referral_count: { [DB_TYPE === "mysql" ? require("sequelize").Op.gt : "$gt"]: 0 } })
      .sort({ referral_count: -1 })
      .limit(10)
      .select("username referral_count referral_earnings email");

    const recentCommissions = await Transaction.find({ type: "bonus", description: { [DB_TYPE === "mysql" ? require("sequelize").Op.like : "$regex"]: "%Referral bonus%" } })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("user_id", "username");

    res.json({
      metrics: {
        total_referrals: totalReferrals,
        total_earnings:  totalEarnings,
      },
      top_referrers: topReferrers,
      recent_commissions: recentCommissions
    });
  } catch (err) {
    console.error("Admin referral stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
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

router.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ url: "/uploads/" + req.file.filename });
});

module.exports = router;
