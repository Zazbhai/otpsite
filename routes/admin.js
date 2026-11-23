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
const AdminBankAccount = require("../models/AdminBankAccount");
const Payout      = require("../models/Payout");
const omnipay     = require("../utils/omnipay");
const heleket     = require("../utils/heleket");
const multer      = require("multer");
const path        = require("path");
const fs          = require("fs");
const { DB_TYPE } = require("../utils/db");
const { clearSettingsCache } = require("../utils/settingsCache");
const { clearCache } = require("../utils/apiCache");
const { emitToAll, emitToUser } = require("../utils/realtimeEmitter");
const { resolveAnalyticsPeriod } = require("../utils/analyticsPeriod");

const formatServiceName = (name) => {
  if (!name) return "";
  return name.trim().charAt(0).toUpperCase() + name.trim().slice(1).toLowerCase();
};

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
router.get("/events", require("../utils/adminRealtime").streamAdminChanges);

router.get("/services/names", async (req, res) => {
  try {
    const names = await Service.distinct("name");
    res.json(names.sort());
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/* ─── ANALYTICS ────────────────────────────────────────────────── */
router.get("/analytics", async (req, res) => {
  try {
    const now = new Date();
    
    const period = resolveAnalyticsPeriod(req.query, now);
    const todayStart = period.start;
    const periodEnd = period.end;
    const thirtyDaysAgo = new Date(now - 30 * 864e5);
    const fourteenDaysAgo = new Date(now - 14 * 864e5);

    const [totalUsers, todayUsers] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: todayStart, $lt: periodEnd } }),
    ]);
    let metrics = { totalUsers, todayUsers };
    let graphs = { dailyDeposits: [], dailyRevenue: [], userGrowth: [] };
    let topServices = [];
    let orderDistribution = [];

    if (DB_TYPE === "mysql") {
      const { Op, fn, col } = require("sequelize");
      
      const [depRes, todayDepRes, revRes, todayRevRes, liabRes, volRes] = await Promise.all([
        Transaction.findAll({ attributes: [[fn('SUM', col('amount')), 'total']], where: { type: 'deposit', status: 'completed' }, raw: true }),
        Transaction.findAll({ attributes: [[fn('SUM', col('amount')), 'total']], where: { type: 'deposit', status: 'completed', createdAt: { [Op.gte]: todayStart, [Op.lt]: periodEnd } }, raw: true }),
        Order.findAll({ attributes: [[fn('SUM', col('cost')), 'total']], where: { status: 'completed' }, raw: true }),
        Order.findAll({ attributes: [[fn('SUM', col('cost')), 'total']], where: { status: 'completed', createdAt: { [Op.gte]: todayStart, [Op.lt]: periodEnd } }, raw: true }),
        User.findAll({ attributes: [[fn('SUM', col('balance')), 'total']], raw: true }),
        User.findAll({ attributes: [[fn('SUM', col('total_spent')), 'total']], raw: true })
      ]);

      const totalDeposits = parseFloat(depRes[0]?.total || 0);
      const todayDeposits = parseFloat(todayDepRes[0]?.total || 0);
      const totalRevenue  = parseFloat(revRes[0]?.total || 0);
      const todayRevenue  = parseFloat(todayRevRes[0]?.total || 0);
      const totalLiability = parseFloat(liabRes[0]?.total || 0);
      const lifetimeVolume = parseFloat(volRes[0]?.total || 0);

      metrics = { ...metrics, totalDeposits, todayDeposits, totalRevenue, todayRevenue, totalLiability, lifetimeVolume };
      metrics.periodOrders = await Order.count({ where: { createdAt: { [Op.gte]: todayStart, [Op.lt]: periodEnd } } });
      metrics.periodSuccessfulOrders = await Order.count({ where: { status: 'completed', createdAt: { [Op.gte]: todayStart, [Op.lt]: periodEnd } } });
      metrics.periodActiveOrders = await Order.count({ where: { status: 'active', createdAt: { [Op.gte]: todayStart, [Op.lt]: periodEnd } } });

      graphs.dailyDeposits = await Transaction.findAll({
        attributes: [[fn('DATE', col('createdAt')), 'date'], [fn('SUM', col('amount')), 'total']],
        where: { type: 'deposit', status: 'completed', createdAt: { [Op.gte]: fourteenDaysAgo } },
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
        distMap[s] = (distMap[s] || 0) + Number(r.get('count'));
      });
      orderDistribution = Object.entries(distMap).map(([k, v]) => ({ _id: k, count: v }));
    } else {
      // Original MongoDB Aggregations
      const depositPipeline = await Transaction.aggregate([{ $match: { type: "deposit", status: "completed" } },{ $group: { _id: null, total: { $sum: "$amount" }, period: { $sum: { $cond: [{ $and: [{ $gte: ["$createdAt", todayStart] }, { $lt: ["$createdAt", periodEnd] }] }, "$amount", 0] } } } }]);
      const orderPipeline = await Order.aggregate([{ $match: { status: "completed" } },{ $group: { _id: null, total: { $sum: "$cost" }, period: { $sum: { $cond: [{ $and: [{ $gte: ["$createdAt", todayStart] }, { $lt: ["$createdAt", periodEnd] }] }, "$cost", 0] } } } }]);
      const userStats = await User.aggregate([{ $group: { _id: null, totalLiability: { $sum: "$balance" }, totalSpent: { $sum: "$total_spent" } } }]);
      const periodOrderStats = await Order.aggregate([{ $match: { createdAt: { $gte: todayStart, $lt: periodEnd } } }, { $group: { _id: null, orders: { $sum: 1 }, successful: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } }, active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } } } }]);
      metrics = { ...metrics, totalDeposits: depositPipeline[0]?.total || 0, todayDeposits: depositPipeline[0]?.period || 0, totalRevenue: orderPipeline[0]?.total || 0, todayRevenue: orderPipeline[0]?.period || 0, totalLiability: userStats[0]?.totalLiability || 0, lifetimeVolume: userStats[0]?.totalSpent || 0, periodOrders: periodOrderStats[0]?.orders || 0, periodSuccessfulOrders: periodOrderStats[0]?.successful || 0, periodActiveOrders: periodOrderStats[0]?.active || 0 };
      graphs.dailyDeposits = await Transaction.aggregate([{ $match: { type: "deposit", status: "completed", createdAt: { $gte: fourteenDaysAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, total: { $sum: "$amount" } } }, { $sort: { _id: 1 } }]);
      graphs.dailyRevenue = await Order.aggregate([{ $match: { status: "completed", createdAt: { $gte: fourteenDaysAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, total: { $sum: "$cost" } } }, { $sort: { _id: 1 } }]);
      graphs.userGrowth = await User.aggregate([{ $match: { createdAt: { $gte: fourteenDaysAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
      topServices = await Order.aggregate([{ $match: { status: "completed" } }, { $group: { _id: "$service_name", count: { $sum: 1 }, revenue: { $sum: "$cost" } } }, { $sort: { count: -1 } }, { $limit: 6 }]);
      orderDistribution = await Order.aggregate([{ $project: { normalizedStatus: { $cond: [{ $eq: ["$status", "expired"] }, "cancelled", "$status"] } } }, { $group: { _id: "$normalizedStatus", count: { $sum: 1 } } }]);
    }

    const totalOrders = orderDistribution.reduce((sum, row) => sum + row.count, 0);
    const activeOrders = orderDistribution.find(row => row._id === "active")?.count ?? 0;
    const successfulOrders = orderDistribution.find(row => row._id === "completed")?.count ?? 0;
    res.json({
      period: { ...period, orders: metrics.periodOrders || 0, successfulOrders: metrics.periodSuccessfulOrders || 0, activeOrders: metrics.periodActiveOrders || 0, revenue: metrics.todayRevenue || 0, deposits: metrics.todayDeposits || 0, users: todayUsers, successRate: (metrics.periodOrders || 0) ? (metrics.periodSuccessfulOrders || 0) / metrics.periodOrders : 0 },
      metrics: { ...metrics, totalOrders, activeOrders, successfulOrders, successRate: totalOrders ? successfulOrders / totalOrders : 0 },
      graphs,
      topServices,
      orderDistribution
    });
  } catch (err) { 
    console.error("Analytics Error:", err);
    if (/^Invalid analytics date$/.test(err.message)) return res.status(400).json({ error: err.message });
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
      .limit(parseInt(limit))
      .lean();
    
    // Ensure _id consistency
    users.forEach(u => u._id = u._id?.toString() || u.id);

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
    const password_hash = await require("bcryptjs").hash(password, 12);
    const { nanoid } = require("nanoid");
    const referral_code = Math.random().toString(36).substring(2, 10).toUpperCase();

    const user = await User.create({
      username,
      email,
      password_hash,
      display_name: username,
      is_admin: !!is_admin,
      api_key: nanoid(32),
      referral_code,
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
    const userId = req.params.id;
    const historyLimit = Math.min(Math.max(parseInt(req.query.history_limit || "5000", 10) || 5000, 1), 5000);
    const user   = await User.findById(userId).select("-password_hash");
    if (!user) return res.status(404).json({ error: "User not found" });

    const userObj = user.toObject ? user.toObject() : (user.toJSON ? user.toJSON() : user);
    if (userObj._id) userObj._id = userObj._id.toString();

    const [orders, transactions] = await Promise.all([
      Order.find({ user_id: userId }).sort({ createdAt: -1 }).limit(historyLimit),
      Transaction.find({ user_id: userId }).sort({ createdAt: -1 }).limit(historyLimit)
    ]);

    // Calculate detailed deposit & financial breakdown for this user
    let depositStats = {
      successful_deposits: 0,
      successful_deposits_count: 0,
      pending_deposits: 0,
      pending_deposits_count: 0,
      failed_deposits: 0,
      failed_deposits_count: 0,
      total_spent: 0,
      total_refunded: 0,
      total_bonuses: 0
    };

    if (DB_TYPE === "mysql") {
      const allUserTxs = await Transaction.findAll({
        where: { user_id: userId.toString() },
        attributes: ['type', 'status', 'amount'],
        raw: true
      });
      allUserTxs.forEach(tx => {
        const amt = parseFloat(tx.amount || 0);
        const st = (tx.status || 'completed').toLowerCase();
        if (tx.type === 'deposit') {
          if (st === 'pending') {
            depositStats.pending_deposits += amt;
            depositStats.pending_deposits_count++;
          } else if (st === 'failed' || st === 'cancelled') {
            depositStats.failed_deposits += amt;
            depositStats.failed_deposits_count++;
          } else {
            depositStats.successful_deposits += amt;
            depositStats.successful_deposits_count++;
          }
        } else if (tx.type === 'bonus') {
          depositStats.total_bonuses += amt;
          if (st === 'completed') {
            depositStats.successful_deposits += amt;
            depositStats.successful_deposits_count++;
          }
        } else if (tx.type === 'purchase' || tx.type === 'deduction') {
          depositStats.total_spent += Math.abs(amt);
        } else if (tx.type === 'refund') {
          depositStats.total_refunded += amt;
        }
      });
    } else {
      const allUserTxs = await Transaction.find({ user_id: userId.toString() }).select("type status amount").lean();
      allUserTxs.forEach(tx => {
        const amt = parseFloat(tx.amount || 0);
        const st = (tx.status || 'completed').toLowerCase();
        if (tx.type === 'deposit') {
          if (st === 'pending') {
            depositStats.pending_deposits += amt;
            depositStats.pending_deposits_count++;
          } else if (st === 'failed' || st === 'cancelled') {
            depositStats.failed_deposits += amt;
            depositStats.failed_deposits_count++;
          } else {
            depositStats.successful_deposits += amt;
            depositStats.successful_deposits_count++;
          }
        } else if (tx.type === 'bonus') {
          depositStats.total_bonuses += amt;
          if (st === 'completed') {
            depositStats.successful_deposits += amt;
            depositStats.successful_deposits_count++;
          }
        } else if (tx.type === 'purchase' || tx.type === 'deduction') {
          depositStats.total_spent += Math.abs(amt);
        } else if (tx.type === 'refund') {
          depositStats.total_refunded += amt;
        }
      });
    }

    res.json({
      user: userObj,
      recent_orders: orders,
      recent_transactions: transactions,
      history_limit: historyLimit,
      deposit_stats: depositStats
    });
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
    
    if (req.body.discounts !== undefined) {
      if (process.env.DB_TYPE === "mysql") {
        user.discounts = JSON.stringify(req.body.discounts);
      } else {
        user.discounts = req.body.discounts;
        if (typeof user.markModified === 'function') {
          user.markModified('discounts');
        }
      }
      console.log(`[Admin] Updated discounts for user ${user._id}:`, req.body.discounts);
      
      // We will emit and clear cache AFTER saving
      req._pendingDiscountUpdate = true;
    }

    if (req.body.password) {
      const bcrypt = require("bcryptjs");
      user.password_hash = await bcrypt.hash(req.body.password, 10);
    }

    await user.save();

    if (req._pendingDiscountUpdate) {
      const { clearCache } = require("../utils/apiCache");
      clearCache("services"); 
      const { emitToUser } = require("../utils/realtimeEmitter");
      emitToUser(user._id.toString(), "price_update", { msg: "Your personalized pricing has been updated!" });
    }

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
    const { status, page = 1, limit = 30, user_id, q } = req.query;
    const filter = {};
    if (q) {
      const orClauses = [
        { order_id: new RegExp(q, "i") },
        { phone: new RegExp(q, "i") },
        { service_name: new RegExp(q, "i") }
      ];
      if (mongoose.Types.ObjectId.isValid(q)) orClauses.push({ user_id: new mongoose.Types.ObjectId(q) });
      filter.$or = orClauses;
    }

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
      .limit(parseInt(limit))
      .lean();
    
    // 2. Fetch User Names (Manual Join)
    const userIds = [...new Set(orders.map(o => o.user_id).filter(id => !!id))];
    const users = await User.find({ 
      $or: [
        { _id: { $in: userIds.filter(id => mongoose.Types.ObjectId.isValid(id)) } },
        { id: { $in: userIds } } // For potential MySQL compatibility
      ]
    }, "username display_name email").lean();

    const userMap = new Map();
    users.forEach(u => {
      userMap.set(u._id?.toString(), u);
      userMap.set(String(u.id), u);
    });
    
    orders.forEach(o => {
      const u = userMap.get(o.user_id?.toString());
      o.user_name = u ? (u.display_name || u.username) : "Unknown User";
      o.user_email = u ? u.email : "";
    });

    res.json({ orders, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

router.patch("/orders/:id", async (req, res) => {
  const { withTransaction } = require("../utils/db");
  try {
    const { status, otp } = req.body;
    const allowedStatuses = ["active", "completed", "refunded", "cancelled", "expired"];
    if (status !== undefined && !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid order status" });
    }
    if (otp !== undefined && (typeof otp !== "string" || otp.length > 2000)) {
      return res.status(400).json({ error: "Invalid OTP value" });
    }

    const order = await withTransaction(async session => {
      const queryOptions = DB_TYPE === "mysql" ? { transaction: session } : { session };
      const current = await Order.findOne({ order_id: req.params.id }, null, queryOptions);
      if (!current) return null;

      if (status === "refunded" && current.status !== "refunded") {
        if (current.refund_issued || current.otp || (current.all_otps && current.all_otps.length)) {
          const error = new Error("ORDER_NOT_REFUNDABLE");
          throw error;
        }
        const existingRefund = await Transaction.findOne({ order_id: current.order_id, type: "refund" }, null, queryOptions);
        if (existingRefund) throw new Error("ORDER_ALREADY_REFUNDED");

        const updatedOrder = await Order.findOneAndUpdate(
          { _id: current._id, refund_issued: { $ne: true }, status: { $nin: ["cancelled", "expired", "refunded"] } },
          { $set: { status: "refunded", refund_issued: true } },
          { ...queryOptions, new: true }
        );
        if (!updatedOrder) throw new Error("ORDER_ALREADY_REFUNDED");
        const user = await User.findOneAndUpdate(
          { _id: current.user_id },
          { $inc: { balance: current.cost } },
          { ...queryOptions, new: true }
        );
        if (!user) throw new Error("USER_NOT_FOUND");
        const refund = {
          user_id: current.user_id, type: "refund", amount: current.cost,
          balance_after: user.balance,
          description: `Refund for order ${current.order_id}`, order_id: current.order_id,
        };
        if (DB_TYPE === "mysql") await Transaction.create(refund, queryOptions);
        else await Transaction.create([refund], queryOptions);
        current.status = "refunded";
        current.refund_issued = true;
      } else if (status) {
        current.status = status;
      }
      if (otp && otp !== current.otp) {
        current.otp = otp;
        current.all_otps = [...new Set([...(current.all_otps || []), otp])];
        current.refund_issued = true;
      }
      await current.save(queryOptions);
      return current;
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    emitToUser(String(order.user_id), "order", { orderId: order.order_id, status: order.status, otp: order.otp, all_otps: order.all_otps });
    res.json({ order });
  } catch (err) { 
    console.error("Admin order update error:", err);
    if (err.message === "ORDER_NOT_REFUNDABLE") return res.status(409).json({ error: "An order with a received OTP cannot be refunded" });
    if (err.message === "ORDER_ALREADY_REFUNDED") return res.status(409).json({ error: "This order has already been refunded" });
    if (err.message === "USER_NOT_FOUND") return res.status(404).json({ error: "Order owner not found" });
    res.status(500).json({ error: "Server error" }); 
  }
});

/* ─── SERVICES ─────────────────────────────────────────────────── */
router.get("/services", async (req, res) => {
  try {
    // Automatically cleanup services with no server or no country mapped
    try {
      if (DB_TYPE === "mysql") {
        const { Op } = require("sequelize");
        await Service.destroy({ where: { server_id: null } });
        const serverIds = (await Server.findAll({ attributes: ['id'] })).map(s => s.id);
        await Service.destroy({ where: { server_id: { [Op.notIn]: serverIds } } });
      } else {
        // 1. No server_id
        await Service.deleteMany({ $or: [{ server_id: null }, { server_id: { $exists: false } }] });
        // 2. Non-existent server
        const servers = await Server.find({}, { _id: 1, country_id: 1 });
        const validServerIds = servers.filter(s => s.country_id).map(s => s._id);
        await Service.deleteMany({ server_id: { $nin: validServerIds } });
      }
    } catch (cleanupErr) {
      console.warn("[Admin/Cleanup] Silent failure:", cleanupErr.message);
    }

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
        select: "name country_id",
        populate: { path: "country_id", select: "name" }
      })
      .lean();
      
    return res.json(services);
  } catch (err) {
    console.error("[Admin/Services] Fetch Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/services", upload.single("logo"), async (req, res) => {
  try {
    let { server_id, name, service_code, price, is_active, icon_color } = req.body;
    name = formatServiceName(name);
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
      is_trending: String(req.body.is_trending) === "true",
      is_auto: false
    };

    const service = await Service.create(serviceData);
    clearCache("services");
    res.status(201).json(service);
  } catch (err) { 
    console.error("[Admin/Services] Create Error:", err.message);
    res.status(400).json({ error: err.message }); 
  }
});

router.put("/services/:id", upload.single("logo"), async (req, res) => {
  try {
    let { server_id, name, service_code, price, is_active, icon_color } = req.body;
    if (name) name = formatServiceName(name);
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
        service.server_id = server_id;
        service.server_id = server_id;
     }

    if (name) service.name = name;
    if (service_code) service.service_code = service_code;
    if (price !== undefined) service.price = parseFloat(price);
    if (is_active !== undefined) service.is_active = String(is_active) === "true";
    if (req.body.is_trending !== undefined) service.is_trending = String(req.body.is_trending) === "true";
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
    clearCache("services");
    res.json(service);
  } catch (err) { 
    console.error("[Admin/Services] Update Error:", err.message);
    res.status(400).json({ error: err.message }); 
  }
});

router.patch("/services/:id/trending", async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ error: "Service not found" });
    service.is_trending = String(req.body.is_trending) === "true";
    await service.save();
    clearCache("services");
    res.json(service);
  } catch (err) {
    console.error("[Admin/Services] Trending Toggle Error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete("/services/:id", async (req, res) => {
  await Service.findByIdAndDelete(req.params.id);
  clearCache("services");
  res.json({ ok: true });
});

router.delete("/services/bulk/:server_id", async (req, res) => {
  try {
    const { server_id } = req.params;
    const { min, max, is_auto, auto_only } = req.query;
    let deletedCount = 0;
    
    if (DB_TYPE === "mysql") {
      const { Op } = require("sequelize");
      const where = { server_id: server_id };
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
    clearCache("services");
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
    clearCache("countries");
    res.status(201).json(country);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put("/countries/:id", async (req, res) => {
  try {
    const country = await Country.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!country) return res.status(404).json({ error: "Country not found" });
    clearCache("countries");
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
    clearCache("countries");
    res.json({ ok: true });
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

/* ─── SERVERS ──────────────────────────────────────────────────── */
function getRandomColor(index) {
  // Use golden angle for better distribution of hues
  const hue = (index * 137.508) % 360;
  // Convert HSL to HEX
  const h = hue / 360;
  const s = 0.7; // Saturation
  const l = 0.5; // Lightness
  
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  
  const f = (t) => {
    t = t < 0 ? t + 1 : (t > 1 ? t - 1 : t);
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  
  const r = Math.round(f(h + 1/3) * 255);
  const g = Math.round(f(h) * 255);
  const b = Math.round(f(h - 1/3) * 255);
  
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}


async function processAutoAddServices(server, body) {

  const fs = require('fs');
  const path = require('path');
  const Country = require("../models/Country");
  const Service = require("../models/Service");

  let servicesData = [];
  let countryCode = body.provider_country_code || "IN";

  if (!body.provider_country_code && server.country_id) {
    const country = await Country.findById(server.country_id);
    if (country) countryCode = country.code;
  }

  const extraProfit = parseFloat(body.extra_profit || 0);

  if (body.service_source === "url" && body.services_url) {
    try {
      const fetchUrl = body.services_url.replace("$country", countryCode);
      console.log(`[Admin/Servers] Fetching services from: ${fetchUrl}`);
      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error(`Remote URL returned status ${response.status}`);
      
      let remoteData;
      const text = await response.text();
      try {
        remoteData = JSON.parse(text);
      } catch (e) {
        throw new Error(`Provider returned non-JSON response: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      }

      if (!remoteData || typeof remoteData !== 'object') {
         throw new Error("Invalid remote service data format. Expected an object.");
      }
      
      // Determine server index for naming
      const allServers = await require("../models/Server").find().sort({ createdAt: 1 });
      const sIndex = allServers.findIndex(s => s._id.toString() === (server._id || server.id).toString()) + 1;
      const displayIndex = sIndex > 0 ? sIndex : (allServers.length + 1);
 
      // Save raw to server-specific JSON file
      const uploadsDir = path.join(__dirname, "../public/uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const customJsonPath = path.join(uploadsDir, `custom_services${displayIndex}.json`);
      fs.writeFileSync(customJsonPath, JSON.stringify(remoteData, null, 2));
 
      let idx = 0;
      // 1. Check for standard protocol format: {"country": {"service": {"cost": ...}, ...}}
      if (remoteData[countryCode] && typeof remoteData[countryCode] === 'object' && !Array.isArray(remoteData[countryCode])) {
          const services = remoteData[countryCode];
          for (const serviceCode in services) {
              const data = services[serviceCode];
              servicesData.push({
                  name: serviceCode.toUpperCase(), // Best guess at name
                  code: serviceCode,
                  price: parseFloat(data.cost || data.price) || 5.0,
                  color: getRandomColor(idx++)
              });
          }
      } 
      // 2. Check for the custom format: {"ServiceName": [{"service_code":"...", "price":"..."}, ...]}
      else {
          for (const name in remoteData) {
            const list = remoteData[name];
            if (Array.isArray(list) && list.length > 0) {
              const item = list[0];
              servicesData.push({
                name: name,
                code: item.service_code || item.code,
                price: parseFloat(item.price || item.cost) || 5.0,
                color: getRandomColor(idx++)
              });
            }
          }
      }
 
      if (servicesData.length === 0) {
        throw new Error("No valid services found for this country in the remote response.");
      }

      // Save the formatted JSON too
      const formattedJsonPath = path.join(uploadsDir, `formatted_services${displayIndex}.json`);
      fs.writeFileSync(formattedJsonPath, JSON.stringify(servicesData, null, 2));
      console.log(`[Admin/Servers] Saved formatted services to: ${formattedJsonPath}`);


    } catch (err) {
      console.error("[Admin/Servers] Remote URL Error:", err.message);
      throw new Error("Wrong remote URL or invalid response format: " + err.message);
    }


    // Merge local services if requested
    if (body.include_local_services) {
      const localPath = path.join(__dirname, "../services.json");
      if (fs.existsSync(localPath)) {
        console.log(`[Admin/Servers] Merging local services.json for server: ${server.id || server._id}`);
        const localData = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
        servicesData = [...servicesData, ...localData];
      }
    }
  } else {

    // Default to services.json
    const servicesPath = path.join(__dirname, "../services.json");
    if (fs.existsSync(servicesPath)) {
      servicesData = JSON.parse(fs.readFileSync(servicesPath, 'utf-8'));
    }
  }

  if (servicesData.length > 0) {
    const sFindQuery = { server_id: server.id || server._id };
    const existingServices = await Service.find(sFindQuery);
    const existingCodes = new Set(existingServices.map(s => s.service_code));
    const existingNames = new Set(existingServices.map(s => s.name.toLowerCase()));

    const servicesToCreate = [];
    for (const item of servicesData) {
      const code = item.code || item.service_code;
      if (existingCodes.has(code) || existingNames.has(item.name.toLowerCase())) continue;

      servicesToCreate.push({
        name: formatServiceName(item.name),
        server_id: server.id || server._id,
        service_code: code,
        country_code: countryCode,
        price: (parseFloat(item.price) || 5.0) + extraProfit,
        is_active: true,
        icon_color: item.color || item.icon_color || "#3b82f6",
        is_auto: true
      });
    }

    if (servicesToCreate.length > 0) {
      console.log(`[Admin/Servers] Auto-adding ${servicesToCreate.length} for server: ${server.id || server._id}`);
      await Service.insertMany(servicesToCreate);
      console.log(`[Admin/Servers] Auto-added ${servicesToCreate.length} NEW services to server`);
      clearCache("services");
    }
  }
}

router.get("/servers", async (_, res) => res.json(await Server.find().sort({ name: 1 }).populate("country_id")));

router.post("/servers", async (req, res) => {
  try {
    if (req.body.country_id === "0" || !req.body.country_id) {
      return res.status(400).json({ error: "Please select a country" });
    }
    const server = await Server.create(req.body);
    if (req.body.auto_add_services) await processAutoAddServices(server, req.body);
    res.status(201).json(server);
  } catch (err) {
    let msg = err.message;
    if (msg.includes("country_id") && msg.includes("Cast to ObjectId failed")) {
      msg = "Please select a country";
    }
    res.status(400).json({ error: msg });
  }
});

router.put("/servers/:id", async (req, res) => {
  try { 
    if (req.body.country_id === "0" || !req.body.country_id) {
      return res.status(400).json({ error: "Please select a country" });
    }
    const server = await Server.findByIdAndUpdate(req.params.id, req.body, { new: true }); 
    
    if (req.body.auto_add_services) {
      await processAutoAddServices(server, req.body);
    }

    res.json(server); 
  }
  catch (err) {
    let msg = err.message;
    if (msg.includes("country_id") && msg.includes("Cast to ObjectId failed")) {
      msg = "Please select a country";
    }
    res.status(400).json({ error: msg });
  }
});

router.delete("/servers/:id", async (req, res) => {
  try {
    const serverId = req.params.id;
    
    if (DB_TYPE === "mysql") {
      // 1. Delete services linked to this server
      await Service.destroy({ where: { server_id: serverId } });
      // 2. Delete the server itself
      await Server.destroy({ where: { id: serverId } });
      // 3. Cleanup orphaned services (no server_id)
      await Service.destroy({ where: { server_id: null } });
    } else {
      const mongoose = require("mongoose");
      const oid = mongoose.Types.ObjectId.isValid(serverId) ? new mongoose.Types.ObjectId(serverId) : serverId;
      
      // 1. Delete services linked to this server (using explicit ObjectId cast for reliability)
      await Service.deleteMany({ server_id: oid });
      
      // 2. Delete the server itself
      await Server.findByIdAndDelete(serverId);

      // 3. Cleanup orphaned services (no server_id mapped)
      await Service.deleteMany({ 
        $or: [
          { server_id: null }, 
          { server_id: { $exists: false } }
        ] 
      });
    }

    clearCache("services");
    res.json({ ok: true });
  } catch (err) {
    console.error("[Admin/Servers] Delete Error:", err.message);
    res.status(500).json({ error: "Failed to delete server: " + err.message });
  }
});

/* ─── TRANSACTIONS ─────────────────────────────────────────────── */
router.get("/transactions", async (req, res) => {
  try {
    const { type, status, user_id, page = 1, limit = 50, q } = req.query;
    const filter = {};
    if (q) {
      const orClauses = [
        { description: new RegExp(q, "i") },
        { reference: new RegExp(q, "i") }
      ];
      if (mongoose.Types.ObjectId.isValid(q)) orClauses.push({ user_id: new mongoose.Types.ObjectId(q) });
      if (q.match(/^[a-zA-Z0-9_\-]+$/)) orClauses.push({ order_id: q });
      filter.$or = orClauses;
    }

    if (type   && type   !== "all") filter.type   = type;
    if (status && status !== "all") filter.status = status;
    if (user_id)                    filter.user_id = user_id;

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
    user.has_deposited = true;
    await user.save();
    await Transaction.create({
      user_id, type: "deposit", amount: parsedAmount,
      balance_after: user.balance,
      status: "completed",
      description: description || "Manual deposit by admin",
    });

    emitToUser(String(user_id), "balance", { balance: user.balance }); // Real-time balance push
    res.json({ balance: user.balance });
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

router.post("/transactions/deduct", async (req, res) => {
  try {
    const { user_id, amount, description } = req.body;
    if (!user_id || amount == null) return res.status(400).json({ error: "user_id and amount are required" });
    
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }

    const user = await User.findById(user_id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.balance = parseFloat((user.balance - parsedAmount).toFixed(4));
    await user.save();
    
    await Transaction.create({
      user_id,
      type: "deduction",
      amount: -parsedAmount,
      balance_after: user.balance,
      status: "completed",
      description: description || "Manual deduction by admin",
    });

    emitToUser(String(user_id), "balance", { balance: user.balance }); // Real-time balance push
    res.json({ balance: user.balance });
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

router.post("/transactions/:id/approve", async (req, res) => {
  try {
    const txId = req.params.id;
    const tx = await Transaction.findById(txId);
    if (!tx) return res.status(404).json({ error: "Transaction not found" });
    if (tx.status !== "pending") {
      return res.status(400).json({ error: `Transaction is already ${tx.status}` });
    }

    const user = await User.findById(tx.user_id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const creditAmount = parseFloat(tx.amount || 0);
    user.balance = parseFloat((user.balance + creditAmount).toFixed(4));
    user.has_deposited = true;
    await user.save();

    tx.status = "completed";
    tx.balance_after = user.balance;
    if (!tx.description.includes("(Approved)")) {
      tx.description = (tx.description || "Deposit") + " (Approved by Admin)";
    }
    await tx.save();

    emitToUser(String(user._id || user.id), "balance", { balance: user.balance });
    emitToUser(String(user._id || user.id), "wallet_update", { balance: user.balance });

    res.json({ success: true, message: "Deposit approved successfully", balance: user.balance, transaction: tx });
  } catch (err) {
    console.error("Admin approve transaction error:", err);
    res.status(500).json({ error: "Server error approving deposit" });
  }
});

router.post("/transactions/:id/reject", async (req, res) => {
  try {
    const txId = req.params.id;
    const tx = await Transaction.findById(txId);
    if (!tx) return res.status(404).json({ error: "Transaction not found" });
    if (tx.status !== "pending") {
      return res.status(400).json({ error: `Transaction is already ${tx.status}` });
    }

    tx.status = "failed";
    if (!tx.description.includes("(Rejected)")) {
      tx.description = (tx.description || "Deposit") + " (Rejected by Admin)";
    }
    await tx.save();

    res.json({ success: true, message: "Deposit marked as rejected", transaction: tx });
  } catch (err) {
    console.error("Admin reject transaction error:", err);
    res.status(500).json({ error: "Server error rejecting deposit" });
  }
});

/* ─── SETTINGS ─────────────────────────────────────────────────── */
router.get("/settings", async (_, res) => {
  try {
    const settings = await Setting.find();
    const obj = {};
    settings.forEach((s) => {
      // Ensure we handle both Mongoose and Sequelize models correctly
      const data = s.toJSON ? s.toJSON() : s;
      obj[data.key] = data.value;
    });
    res.json(obj);
  } catch (err) {
    console.error("ADMIN_SETTINGS_GET_ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/settings", async (req, res) => {
  try {
    if (DB_TYPE === "mysql") {
      // Deduplicate: ensure old 'maintenance' key doesn't conflict with 'maintenance_mode'
      const { Op } = require("sequelize");
      await Setting.destroy({ where: { key: { [Op.in]: ["maintenance", "isMaintenance"] } } });
      
      for (const [key, value] of Object.entries(req.body)) {
        const found = await Setting.findOne({ where: { key } });
        if (found) {
          await found.update({ value });
        } else {
          await Setting.create({ key, value });
        }
      }
    } else {
      // Deduplicate for MongoDB
      await Setting.deleteMany({ key: { $in: ["maintenance", "isMaintenance"] } });
      
      const updateData = { ...req.body, branding_version: Date.now().toString() };
      const ops = Object.entries(updateData).map(([key, value]) => ({
        updateOne: { filter: { key }, update: { $set: { key, value } }, upsert: true },
      }));
      await Setting.bulkWrite(ops);
    }
    
    const { clearSettingsCache } = require("../utils/settingsCache");
    clearSettingsCache();
    emitToAll("settings", {});
    res.json({ ok: true });
  } catch (err) { 
    console.error("ADMIN_SETTINGS_POST_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

/* ─── BROADCAST ────────────────────────────────────────────────── */
router.get("/broadcast", async (req, res) => {
  try {
    const bc = await Setting.findOne(DB_TYPE === "mysql" ? { where: { key: "site_broadcast" } } : { key: "site_broadcast" });
    if (!bc || !bc.value) return res.json({ active: false, data: [] });
    
    let data;
    try {
      data = JSON.parse(bc.value);
      if (!Array.isArray(data)) data = [data];
    } catch(e) {
      data = [];
    }
    
    // Return newest first
    res.json({ active: data.length > 0, data: [...data].reverse() });
  } catch (err) {
    console.error("GET_BROADCAST_ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/broadcast", async (req, res) => {
  try {
    const { text, btn_text, btn_url } = req.body;
    if (!text) return res.status(400).json({ error: "Broadcast text is required" });

    const newEntry = { 
      text, 
      btn_text, 
      btn_url, 
      id: Date.now().toString(),
      createdAt: new Date()
    };

    const bc = await Setting.findOne(DB_TYPE === "mysql" ? { where: { key: "site_broadcast" } } : { key: "site_broadcast" });
    let list = [];
    if (bc && bc.value) {
      try {
        const parsed = JSON.parse(bc.value);
        list = Array.isArray(parsed) ? parsed : [parsed];
      } catch(e) { list = []; }
    }

    list.push(newEntry);
    if (list.length > 50) list = list.slice(-50);

    const stringified = JSON.stringify(list);

    if (DB_TYPE === "mysql") {
      const found = await Setting.findOne({ where: { key: "site_broadcast" } });
      if (found) {
        await Setting.update({ value: stringified }, { where: { key: "site_broadcast" } });
      } else {
        await Setting.create({ key: "site_broadcast", value: stringified });
      }
    } else {
      await Setting.findOneAndUpdate(
        { key: "site_broadcast" },
        { value: stringified },
        { upsert: true }
      );
    }
    
    emitToAll("broadcast", newEntry);
    res.json({ success: true, message: "Broadcast sent and saved to history!" });
  } catch (err) { 
    console.error("ADMIN_ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

router.delete("/broadcast", async (req, res) => {
  try {
    const { id } = req.query;
    
    if (!id) {
      if (DB_TYPE === "mysql") {
        await Setting.destroy({ where: { key: "site_broadcast" } });
      } else {
        await Setting.deleteOne({ key: "site_broadcast" });
      }
      emitToAll("broadcast_deleted", { id: null });
      return res.json({ success: true, message: "All broadcasts removed" });
    }

    const bc = await Setting.findOne(DB_TYPE === "mysql" ? { where: { key: "site_broadcast" } } : { key: "site_broadcast" });
    if (bc && bc.value) {
      let list = JSON.parse(bc.value);
      if (Array.isArray(list)) {
        list = list.filter(item => item.id !== id);
        const stringified = JSON.stringify(list);
        if (DB_TYPE === "mysql") {
          await Setting.update({ value: stringified }, { where: { key: "site_broadcast" } });
        } else {
          await Setting.findOneAndUpdate({ key: "site_broadcast" }, { value: stringified });
        }
      } else {
        const single = list;
        if (single.id === id) {
          if (DB_TYPE === "mysql") {
            await Setting.destroy({ where: { key: "site_broadcast" } });
          } else {
            await Setting.deleteOne({ key: "site_broadcast" });
          }
        }
      }
    }

    emitToAll("broadcast_deleted", { id });
    res.json({ success: true, message: "Broadcast removed from history" });
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

    let commissionsRaw = await Transaction.find({ 
      type: "bonus", 
      description: { 
        [DB_TYPE === "mysql" ? require("sequelize").Op.like : "$regex"]: DB_TYPE === "mysql" ? "%referral bonus%" : "referral bonus",
        ...(DB_TYPE !== "mysql" ? { $options: "i" } : {})
      } 
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    // Manually populate usernames since user_id is a String in Transaction model
    const userIds = [...new Set(commissionsRaw.map(c => c.user_id))];
    const users = await User.find({ _id: { $in: userIds } }).select("username avatar_color").lean();
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    const recentCommissions = commissionsRaw.map(c => {
      const uId = c.user_id ? c.user_id.toString() : "";
      const user = userMap.get(uId) || { username: "User " + uId.substring(0,8), _id: uId, avatar_color: "#64748b" };
      let source_username = null;
      const match = c.description.match(/Referral bonus from ([^\s(]+)/i);
      if (match && match[1]) source_username = match[1];
      return { ...c, user_id: user, source_username };
    });

    const sourceUsernames = [...new Set(recentCommissions.map(c => c.source_username).filter(Boolean))];
    const sourceUsers = await User.find({ username: { $in: sourceUsernames } }).select("username avatar_color").lean();
    const sourceMap = new Map(sourceUsers.map(u => [u.username, u]));
    const finalCommissions = recentCommissions.map(c => ({
      ...c,
      source_user: c.source_username ? sourceMap.get(c.source_username) : null
    }));

    res.json({
      metrics: {
        total_referrals: totalReferrals,
        total_earnings:  totalEarnings,
      },
      top_referrers: topReferrers,
      recent_commissions: finalCommissions
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

router.get("/heleket-services", async (req, res) => {
  try {
    let hConfig = {};
    if (fs.existsSync(CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      hConfig = config.heleket || {};
    }
    const usdRate = await heleket.getCurrentUsdToInrRate();

    if (hConfig.merchant_id && hConfig.payment_key) {
      try {
        const liveServices = await heleket.getPaymentServices(hConfig);
        if (Array.isArray(liveServices) && liveServices.length > 0) {
          const adminServices = liveServices.map(s => {
            const minUsd = (s.min_amount !== undefined && !isNaN(s.min_amount)) ? parseFloat(s.min_amount) : 1;
            const maxUsd = (s.max_amount !== undefined && !isNaN(s.max_amount)) ? parseFloat(s.max_amount) : 50000;
            return {
              ...s,
              min_amount: minUsd,
              max_amount: maxUsd,
              min_inr: Math.ceil(minUsd * usdRate),
              max_inr: Math.floor(maxUsd * usdRate)
            };
          });
          return res.json({ success: true, services: adminServices, source: "live_api", usd_rate: usdRate });
        }
      } catch (apiErr) {
        console.warn("Could not fetch live Heleket services (`POST /v1/payment/services`), falling back to detailed rates:", apiErr.message);
      }
    }

    const fallbackServices = [
      { currency: "USDT", network: "TRC20", commission_percent: 1.0, min_amount: 1, max_amount: 50000, min_inr: Math.ceil(1 * usdRate), max_inr: Math.floor(50000 * usdRate), is_available: true },
      { currency: "USDT", network: "ERC20", commission_percent: 1.2, min_amount: 5, max_amount: 100000, min_inr: Math.ceil(5 * usdRate), max_inr: Math.floor(100000 * usdRate), is_available: true },
      { currency: "USDT", network: "BEP20", commission_percent: 1.0, min_amount: 1, max_amount: 50000, min_inr: Math.ceil(1 * usdRate), max_inr: Math.floor(50000 * usdRate), is_available: true },
      { currency: "BTC", network: "BITCOIN", commission_percent: 1.5, min_amount: 10, max_amount: 100000, min_inr: Math.ceil(10 * usdRate), max_inr: Math.floor(100000 * usdRate), is_available: true },
      { currency: "ETH", network: "ETHEREUM", commission_percent: 1.5, min_amount: 10, max_amount: 100000, min_inr: Math.ceil(10 * usdRate), max_inr: Math.floor(100000 * usdRate), is_available: true },
      { currency: "TRX", network: "TRON", commission_percent: 1.0, min_amount: 1, max_amount: 25000, min_inr: Math.ceil(1 * usdRate), max_inr: Math.floor(25000 * usdRate), is_available: true },
      { currency: "LTC", network: "LITECOIN", commission_percent: 1.0, min_amount: 2, max_amount: 25000, min_inr: Math.ceil(2 * usdRate), max_inr: Math.floor(25000 * usdRate), is_available: true },
      { currency: "BNB", network: "BSC", commission_percent: 1.0, min_amount: 2, max_amount: 50000, min_inr: Math.ceil(2 * usdRate), max_inr: Math.floor(50000 * usdRate), is_available: true },
      { currency: "SOL", network: "SOLANA", commission_percent: 1.0, min_amount: 2, max_amount: 50000, min_inr: Math.ceil(2 * usdRate), max_inr: Math.floor(50000 * usdRate), is_available: true },
      { currency: "DOGE", network: "DOGECOIN", commission_percent: 1.0, min_amount: 2, max_amount: 10000, min_inr: Math.ceil(2 * usdRate), max_inr: Math.floor(10000 * usdRate), is_available: true },
      { currency: "XRP", network: "RIPPLE", commission_percent: 1.0, min_amount: 2, max_amount: 50000, min_inr: Math.ceil(2 * usdRate), max_inr: Math.floor(50000 * usdRate), is_available: true },
      { currency: "TON", network: "TON", commission_percent: 1.0, min_amount: 1, max_amount: 25000, min_inr: Math.ceil(1 * usdRate), max_inr: Math.floor(25000 * usdRate), is_available: true }
    ];

    res.json({ success: true, services: fallbackServices, source: "fallback", usd_rate: usdRate });
  } catch (err) {
    console.error("Heleket services admin endpoint error:", err);
    res.status(500).json({ error: "Failed to fetch Heleket services" });
  }
});

router.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ url: "/uploads/" + req.file.filename });
});

/* ─── PAYOUT & BANK ACCOUNT MANAGEMENT (ADMIN ONLY) ─────────── */
router.get("/payouts/accounts", async (req, res) => {
  try {
    const accounts = await AdminBankAccount.find ? await AdminBankAccount.find() : await AdminBankAccount.findAll();
    res.json({ success: true, accounts });
  } catch (err) { res.status(500).json({ error: "Failed to load bank accounts" }); }
});

router.post("/payouts/accounts", async (req, res) => {
  try {
    const { account_name, account_number, ifsc, bank_name, is_default } = req.body;
    if (!account_name || !account_number || !ifsc) {
      return res.status(400).json({ error: "Account Name, Account Number, and IFSC are required." });
    }
    const accData = {
      account_name: account_name.trim(),
      account_number: account_number.trim(),
      ifsc: ifsc.trim().toUpperCase(),
      bank_name: (bank_name || "").trim(),
      is_default: !!is_default
    };
    let acc;
    if (AdminBankAccount.create) {
      acc = await AdminBankAccount.create(accData);
    } else {
      acc = new AdminBankAccount(accData);
      await acc.save();
    }
    res.json({ success: true, account: acc });
  } catch (err) { res.status(500).json({ error: "Failed to save bank account" }); }
});

router.delete("/payouts/accounts/:id", async (req, res) => {
  try {
    if (AdminBankAccount.findByIdAndDelete) {
      await AdminBankAccount.findByIdAndDelete(req.params.id);
    } else {
      await AdminBankAccount.destroy({ where: { id: req.params.id } });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Failed to delete bank account" }); }
});

router.get("/payouts", async (req, res) => {
  try {
    const payouts = Payout.find ? await Payout.find().sort({ createdAt: -1 }).limit(100) : await Payout.findAll({ order: [["createdAt", "DESC"]], limit: 100 });
    
    // Calculate total OmniPay deposits collected vs withdrawals (deducting 8% fee)
    const depTxs = Transaction.find ? await Transaction.find({ type: "deposit", status: "completed" }) : await Transaction.findAll({ where: { type: "deposit", status: "completed" } });
    const omniDeposits = depTxs.filter(t => (t.description && t.description.toLowerCase().includes("omnipay")) || (t.reference && String(t.reference).toUpperCase().startsWith("OMNI")));
    const rawOmniTotal = omniDeposits.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const totalDeposits = parseFloat((rawOmniTotal * 0.92).toFixed(2)); // net after deducting 8% fee

    const totalWithdrawn = payouts.filter(p => (p.gateway !== "heleket" && p.ifsc !== "CRYPTO") && p.status === "SUCCESS").reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const pendingWithdrawals = payouts.filter(p => (p.gateway !== "heleket" && p.ifsc !== "CRYPTO") && (p.status === "PENDING" || p.status === "PROCESSING")).reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

    // Also calculate Heleket Crypto statistics
    const heleketDeposits = depTxs.filter(t => (t.description && t.description.toLowerCase().includes("heleket")) || (t.reference && String(t.reference).toUpperCase().startsWith("HEL")));
    const totalCryptoDeposits = heleketDeposits.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const cryptoWithdrawn = payouts.filter(p => (p.gateway === "heleket" || p.ifsc === "CRYPTO") && p.status === "SUCCESS").reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const cryptoPending = payouts.filter(p => (p.gateway === "heleket" || p.ifsc === "CRYPTO") && (p.status === "PENDING" || p.status === "PROCESSING")).reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

    res.json({
      success: true,
      payouts,
      stats: {
        totalDeposits,
        rawOmniTotal,
        totalWithdrawn,
        pendingWithdrawals,
        availablePool: parseFloat((totalDeposits - totalWithdrawn).toFixed(2)),
        crypto: {
          totalDeposits: totalCryptoDeposits,
          withdrawn: cryptoWithdrawn,
          pending: cryptoPending,
          availablePool: parseFloat((totalCryptoDeposits - cryptoWithdrawn).toFixed(2))
        }
      }
    });
  } catch (err) {
    console.error("Payout list error:", err);
    res.status(500).json({ error: "Failed to fetch payouts" });
  }
});

router.post("/payouts/withdraw", async (req, res) => {
  try {
    const { gateway, amount, account_id, account_name, account_number, ifsc, bank_name } = req.body;
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: "Invalid withdrawal amount." });
    }

    if (gateway === "heleket") {
      const { currency = "USDT", network = "TRC20", address, is_subtract = true } = req.body;
      const targetAddress = address || account_number;
      if (!targetAddress) {
        return res.status(400).json({ error: "Crypto wallet address is required for Heleket payout." });
      }

      const cfgPath = path.join(__dirname, "../payment_config.json");
      if (!fs.existsSync(cfgPath)) return res.status(400).json({ error: "Payment configuration missing." });
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      const hConfig = cfg.heleket || {};
      if (!hConfig.enabled || !hConfig.merchant_id || (!hConfig.payout_key && !hConfig.payment_key)) {
        return res.status(400).json({ error: "Heleket Crypto is not enabled or payout API key is missing in payment settings." });
      }

      const orderNo = `HEL-WD-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
      const host = req.headers.host || "localhost:5007";
      const callbackUrl = `${protocol}://${host}/api/payment/heleket/payout-callback`;

      const result = await heleket.createPayout(hConfig, {
        amount,
        currency,
        network,
        order_id: orderNo,
        address: targetAddress,
        is_subtract: !!is_subtract,
        url_callback: callbackUrl
      });

      const statusStr = result && (String(result.status || "").toLowerCase() === "paid" || String(result.status || "").toLowerCase() === "paid_over") 
        ? "SUCCESS" 
        : (result ? "PROCESSING" : "FAILED");
      const tradeNo = result?.uuid || result?.txid || "";
      const remark = result?.message || result?.error || `Crypto payout (${String(currency).toUpperCase()} ${network ? String(network).toUpperCase() : ""}) initiated`;

      const payoutData = {
        order_no: orderNo,
        trade_no: tradeNo,
        gateway: "heleket",
        amount: parseFloat(amount),
        account_name: `${String(currency).toUpperCase()}${network ? ` (${String(network).toUpperCase()})` : ""}`,
        account_number: targetAddress,
        ifsc: "CRYPTO",
        status: statusStr,
        remark: remark,
        raw_response: result || {}
      };

      let newPayout;
      if (Payout.create) {
        newPayout = await Payout.create(payoutData);
      } else {
        newPayout = new Payout(payoutData);
        await newPayout.save();
      }

      if (statusStr === "FAILED") {
        return res.status(400).json({ error: `Heleket rejected payout: ${remark}`, payout: newPayout });
      }

      return res.json({ success: true, payout: newPayout });
    }

    if (amount < 100) {
      return res.status(400).json({ error: "Minimum OmniPay withdrawal amount is ₹100." });
    }

    let accName = account_name;
    let accNum = account_number;
    let accIfsc = ifsc;

    if (account_id) {
      const savedAcc = AdminBankAccount.findById ? await AdminBankAccount.findById(account_id) : await AdminBankAccount.findByPk(account_id);
      if (savedAcc) {
        accName = savedAcc.account_name;
        accNum = savedAcc.account_number;
        accIfsc = savedAcc.ifsc;
      }
    }

    if (!accName || !accNum || !accIfsc) {
      return res.status(400).json({ error: "Valid bank account details (Name, Number, IFSC) required." });
    }

    const cfgPath = path.join(__dirname, "../payment_config.json");
    if (!fs.existsSync(cfgPath)) return res.status(400).json({ error: "Payment configuration missing." });
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const o = cfg.omnipay || {};
    if (!o.enabled || !o.app_id || !o.app_secret) {
      return res.status(400).json({ error: "OmniPay is not configured or enabled." });
    }

    const orderNo = `WD-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers.host || "localhost:5007";
    const callbackUrl = o.callback_url ? o.callback_url.replace("/callback", "/payout-callback") : `${protocol}://${host}/api/payment/omnipay/payout-callback`;

    const omniConfig = {
      appId: o.app_id || o.appId,
      appSecret: o.app_secret || o.appSecret,
      apiBase: o.api_base || o.apiBase || "https://api.omnipay.global"
    };

    const result = await omnipay.createPayout(omniConfig, {
      amount,
      orderNo,
      bankAccount: { accountNumber: accNum, ifsc: accIfsc, accountName: accName },
      callbackUrl,
      uid: req.userId
    });

    const statusStr = result && (result.code === 200 || result.success) ? "PROCESSING" : "FAILED";
    const tradeNo = result?.data?.trade_no || result?.data?.order_no || "";
    const remark = result?.message || result?.error || (statusStr === "PROCESSING" ? "Initiated successfully" : "Failed at gateway");

    const payoutData = {
      order_no: orderNo,
      trade_no: tradeNo,
      gateway: "omnipay",
      amount: parseFloat(amount),
      account_name: accName,
      account_number: accNum,
      ifsc: accIfsc.toUpperCase(),
      status: statusStr,
      remark: remark,
      raw_response: result || {}
    };

    let newPayout;
    if (Payout.create) {
      newPayout = await Payout.create(payoutData);
    } else {
      newPayout = new Payout(payoutData);
      await newPayout.save();
    }

    if (statusStr === "FAILED") {
      return res.status(400).json({ error: `Gateway rejected payout: ${remark}`, payout: newPayout });
    }

    res.json({ success: true, payout: newPayout });
  } catch (err) {
    console.error("Payout withdraw error:", err);
    res.status(500).json({ error: "Server error initiating payout." });
  }
});

router.post("/payouts/check-status", async (req, res) => {
  try {
    const { order_no } = req.body;
    if (!order_no) return res.status(400).json({ error: "Order number required" });

    const payout = Payout.findOne ? await Payout.findOne({ order_no }) : await Payout.findOne({ where: { order_no } });
    if (!payout) return res.status(404).json({ error: "Payout order not found" });

    const cfgPath = path.join(__dirname, "../payment_config.json");
    if (!fs.existsSync(cfgPath)) return res.status(400).json({ error: "Payment configuration missing." });
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));

    if (payout.gateway === "heleket" || payout.ifsc === "CRYPTO" || payout.order_no.startsWith("HEL-WD") || payout.raw_response?.uuid) {
      const hConfig = cfg.heleket || {};
      const data = await heleket.queryPayout(hConfig, { order_id: order_no, uuid: payout.trade_no || payout.raw_response?.uuid });
      if (!data) return res.status(400).json({ error: "Could not fetch details from Heleket right now." });

      const statusStr = String(data.status || "").toLowerCase();
      if (statusStr === "paid" || statusStr === "paid_over") {
        payout.status = "SUCCESS";
        payout.utr = data.txid || data.uuid || payout.utr;
      } else if (statusStr === "fail" || statusStr === "failed" || statusStr === "error" || statusStr === "rejected" || statusStr === "cancel") {
        payout.status = "FAILED";
        payout.remark = data.error || data.message || "Crypto payout failed";
      } else {
        payout.status = data.status || "PROCESSING";
      }

      payout.raw_response = data;
      if (payout.save) await payout.save();
      return res.json({ success: true, payout });
    }

    const o = cfg.omnipay || {};

    const omniConfig = {
      appId: o.app_id || o.appId,
      appSecret: o.app_secret || o.appSecret,
      apiBase: o.api_base || o.apiBase || "https://api.omnipay.global"
    };

    const data = await omnipay.queryPayout(omniConfig, order_no);
    if (!data) return res.status(400).json({ error: "Could not fetch details from gateway right now." });

    const statusStr = String(data.status || "").toUpperCase();
    if (statusStr === "SUCCESS" || statusStr === "COMPLETED" || statusStr === "1" || data.status === 1) {
      payout.status = "SUCCESS";
      payout.utr = data.utr || data.trade_no || payout.utr;
    } else if (statusStr === "FAILED" || statusStr === "REJECTED" || statusStr === "-1" || data.status === -1) {
      payout.status = "FAILED";
      payout.remark = data.remark || data.message || "Payout rejected";
    } else {
      payout.status = statusStr || "PROCESSING";
    }

    payout.raw_response = data;
    if (payout.save) {
      await payout.save();
    }

    res.json({ success: true, payout });
  } catch (err) {
    console.error("Check status error:", err);
    res.status(500).json({ error: "Server error checking status" });
  }
});

module.exports = router;
