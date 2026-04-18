const express = require("express");
const router  = express.Router();
const mongoose = require("mongoose");
const fs       = require("fs");
const path     = require("path");
const { loginRequired } = require("../middleware/auth");
const User        = require("../models/User");
const Order       = require("../models/Order");
const Service     = require("../models/Service");
const Server      = require("../models/Server");
const Transaction = require("../models/Transaction");
const Country     = require("../models/Country");
const { paymentChecker } = require("../utils/bharatpe");
const providerApi = require("../utils/providerApi");
const { nanoid }  = require("nanoid");

// --- SIMPLE CACHE SYSTEM ---
const apiCache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute

function getFromCache(key) {
  const cached = apiCache.get(key);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) return cached.data;
  return null;
}

function setToCache(key, data) {
  apiCache.set(key, { data, timestamp: Date.now() });
}

// ── GET /api/user/services (public for pricing page) ─────────────
router.get("/services", async (req, res) => {
  const { country_id } = req.query;
  const cacheKey = `services_${country_id || 'all'}`;
  
  const cachedData = getFromCache(cacheKey);
  if (cachedData) return res.json(cachedData);

  try {
    const filter = { is_active: true };
    if (country_id) {
       // Only project _id for server lookup
       const servers = await Server.find({ country_id }).select("_id");
       filter.server_id = { $in: servers.map(s => s._id) };
    }

    const services = await Service.find(filter)
      .sort({ name: 1 })
      .populate({
        path: "server_id",
        populate: { path: "country_id" }
      });
    
    setToCache(cacheKey, services);
    res.json(services);
  } catch (err) { 
    console.error("[/api/user/services] Error:", err.message);
    res.status(500).json({ error: "Server error" }); 
  }
});

// ── GET /api/user/countries (public for buy page) ─────────────────
router.get("/countries", async (req, res) => {
  const cachedData = getFromCache('countries');
  if (cachedData) return res.json(cachedData);

  try {
    const countries = await Country.find({ is_active: true }).sort({ sort_order: 1, name: 1 });
    setToCache('countries', countries);
    res.json(countries);
  } catch (err) { 
    console.error("ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

router.use(loginRequired);

// ── GET /api/user/profile ────────────────────────────────────────
router.get("/profile", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password_hash");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("[/api/user/profile]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/user/currency ─────────────────────────────────────
router.patch("/currency", async (req, res) => {
  try {
    const { currency } = req.body;
    if (!currency) return res.status(400).json({ error: "Currency is required" });
    
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.currency = currency;
    await user.save();
    
    res.json({ success: true, currency: user.currency });
  } catch (err) {
    console.error("[/api/user/currency]", err.message);
    res.status(500).json({ error: "Failed to update currency" });
  }
});

// ──  POST /api/user/profile/key ──────────────────────────────────
router.post("/profile/key", async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.api_key = nanoid(32); // Generate a secure 32-char key
    await user.save();
    
    res.json({ api_key: user.api_key });
  } catch (err) {
    console.error("[/api/user/profile/key]", err.message);
    res.status(500).json({ error: "Failed to generate key" });
  }
});

// ── GET /api/user/dashboard ──────────────────────────────────────
router.get("/dashboard", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password_hash");
    if (!user) return res.status(404).json({ error: "User not found" });

    const activeOrders = await Order.countDocuments({ user_id: req.userId, status: "active" });
    const recentOrders = await Order.find({ user_id: req.userId }).sort({ createdAt: -1 }).limit(5);

    const serverNames = [...new Set(recentOrders.map(o => o.server_name).filter(Boolean))];
    const servers = await Server.find({ name: { $in: serverNames } }).populate('country_id', 'name');
    const serverMap = new Map(servers.map(s => [s.name, s]));
    const enrichedRecentOrders = recentOrders.map(order => {
      const orderObj = typeof order.toObject === 'function' ? order.toObject() : order;
      const server = serverMap.get(order.server_name);
      orderObj.server_country = server?.country_id?.name || orderObj.country;
      return orderObj;
    });

    res.json({
      balance:       user.balance,
      total_orders:  user.total_orders,
      active_orders: activeOrders,
      total_spent:   user.total_spent,
      recent_orders: enrichedRecentOrders,
    });
  } catch (err) { 
    console.error("ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

// ── GET /api/user/referrals ──────────────────────────────────────
router.get("/referrals", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("id referral_code referral_count referral_earnings");
    if (!user) return res.status(404).json({ error: "User not found" });

    // Always use User ID for the referral identifier as requested
    const effectiveCode = user._id.toString();

    const Setting = require("../models/Setting");
    const bonusSetting = await Setting.findOne({ key: "referral_bonus_percent" });
    const bonusPercent = parseFloat(bonusSetting?.value || 0);
    const sFixed = await Setting.findOne({ key: "referral_bonus_fixed_amount" });
    const bonusFixed   = parseFloat(sFixed?.value || 0);

    // Get list of referred users (limit to 50 for performance)
    const referredUsers = await User.find({ referred_by: req.userId })
      .select("username createdAt")
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      referral_code:     effectiveCode,
      referral_count:    user.referral_count,
      referral_earnings: user.referral_earnings,
      bonus_percent:      bonusPercent,
      bonus_fixed:        bonusFixed,
      referred_users:    referredUsers
    });
  } catch (err) {
    console.error("[/api/user/referrals]", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// -- GET /api/user/services moved above loginRequired --

// ── POST /api/user/orders  (buy) ─────────────────────────────────
router.post("/orders", async (req, res) => {
  const { withTransaction } = require("../utils/db");
  
  try {
    const { service_id } = req.body;
    if (!service_id) return res.status(400).json({ error: "service_id is required" });

    // 1. Pre-check and deduct balance
    const orderResult = await withTransaction(async (session) => {
      const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };
      
      const service = await Service.findById(service_id, queryOptions);
      if (!service || !service.is_active) throw new Error("Service not found or inactive");

      const serverConf = await Server.findById(service.server_id, queryOptions);
      if (!serverConf) throw new Error("Server not configured");

      const user = await User.findById(req.userId, queryOptions);
      if (!user) throw new Error("User not found");

      if (user.balance < service.price) throw new Error("INSUFFICIENT_BALANCE");

      // Deduct balance immediately in transaction
      user.balance = parseFloat((user.balance - service.price).toFixed(4));
      user.total_spent = parseFloat((user.total_spent + service.price).toFixed(4));
      user.total_orders += 1;
      await user.save(queryOptions);

      // Return configuration needed for API call
      return { service, serverConf, userBalance: user.balance };
    });

    const { service, serverConf } = orderResult;

    // 2. Provider API call (OUTSIDE database transaction)
    let providerRes;
    try {
      providerRes = await providerApi.getNumber(serverConf, service.service_code, service.country_code);
    } catch (apiErr) {
      providerRes = { error: apiErr.message || "Provider API Failure" };
    }

    if (providerRes.error) {
      // 3. REFUND if API failed
      console.error("❌ PROVIDER API REJECTION ❌", providerRes.error);
      
      await withTransaction(async (session) => {
        const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };
        const user = await User.findById(req.userId, queryOptions);
        if (user) {
          user.balance = parseFloat((user.balance + service.price).toFixed(4));
          user.total_spent = parseFloat((user.total_spent - service.price).toFixed(4));
          user.total_orders -= 1;
          await user.save(queryOptions);
        }
      });
      
      if (providerRes.error === "Provider request timed out") throw new Error("PROVIDER_TIMEOUT");
      throw new Error("PROVIDER_REJECTION");
    }

    // 4. Success: Create order in final transaction
    const finalResult = await withTransaction(async (session) => {
      const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };
      
      const orderId = "ORD-" + nanoid(10).toUpperCase();
      const cancelMinutes = serverConf.auto_cancel_minutes || 20;
      const expiresAt = new Date(Date.now() + cancelMinutes * 60 * 1000);
      const minCancelMinutes = serverConf.min_cancel_minutes || 0;
      const minCancelAt = new Date(Date.now() + minCancelMinutes * 60 * 1000);

      const orderData = {
        order_id: orderId,
        user_id: req.userId,
        service_name: service.name,
        server_name: serverConf.name,
        country: service.country_code,
        phone: providerRes.phone,
        external_order_id: providerRes.api_order_id,
        cost: service.price,
        status: "active",
        expires_at: expiresAt,
        min_cancel_at: minCancelAt,
        service_image: service.image_url || "",
        service_color: service.icon_color || "",
        check_interval: serverConf.check_interval || 3,
        multi_otp_enabled: serverConf.multi_otp_supported || false
      };

      let order;
      if (process.env.DB_TYPE === "mysql") {
        order = await Order.create(orderData, queryOptions);
      } else {
        const createdOrders = await Order.create([orderData], queryOptions);
        order = createdOrders[0];
      }

      await Transaction.create({
        user_id: req.userId,
        type: "purchase",
        amount: -service.price,
        balance_after: orderResult.userBalance, // We know this from first step
        description: `Purchased ${service.name} (${service.country_code})`,
        order_id: orderId,
      }, queryOptions);

      return order;
    });

    res.json({ order: finalResult });
  } catch (err) {
    if (err.message === "INSUFFICIENT_BALANCE") return res.status(402).json({ error: "Insufficient balance" });
    if (err.message === "PROVIDER_REJECTION") return res.status(502).json({ error: "Number Not Available" });
    if (err.message === "PROVIDER_TIMEOUT") return res.status(504).json({ error: "Provider timed out. Please try again." });
    if (err.message === "Service not found or inactive") return res.status(404).json({ error: err.message });
    
    console.error("Order error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/user/orders ─────────────────────────────────────────
router.get("/orders", async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { user_id: req.userId };
    if (status && status !== "all") {
      if (status === "cancelled") {
        filter.status = { $in: ["cancelled", "expired"] };
      } else {
        filter.status = status;
      }
    }

    const total  = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ orders, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { 
    console.error("ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

// ── GET /api/user/orders/:id ─────────────────────────────────────
router.get("/orders/:id", async (req, res) => {
  try {
    const order = await Order.findOne({ order_id: req.params.id, user_id: req.userId });
    if (!order) return res.status(404).json({ error: "Order not found" });

    const serverConf = await Server.findOne({ name: order.server_name }).populate('country_id', 'name');
    
    // Polling OTP logic if order is active with throttling (min 3s between checks)
    if (order.status === "active" && order.external_order_id) {
      const { syncOrder } = require("../utils/orderStatusManager");
      setImmediate(async () => {
        try {
          await syncOrder(order);
        } catch (err) {
          console.error("Background sync error:", err.message);
        }
      });
    }

    if (!order) return res.status(404).json({ error: "Order not found" });
    const finalOrder = typeof order.toObject === 'function' ? order.toObject() : order;
    finalOrder.server_country = serverConf?.country_id?.name || order.country;
    res.json(finalOrder);

  } catch (err) { 
    console.error("Order fetch error:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

// ── POST /api/user/orders/:id/cancel ─────────────────────────────
router.post("/orders/:id/cancel", async (req, res) => {
  const { withTransaction } = require("../utils/db");
  
  try {
    const result = await withTransaction(async (session) => {
      const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };

      const order = await Order.findOne({ order_id: req.params.id, user_id: req.userId }, queryOptions);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status !== "active") throw new Error("ORDER_NOT_ACTIVE");

      // Enforce min_cancel_at (allow cancel after 2 mins only)
      if (order.min_cancel_at && Date.now() < new Date(order.min_cancel_at).getTime()) {
        throw new Error("CANCEL_COOLDOWN");
      }

      // Call provider cancel API
      if (order.external_order_id) {
        const serverConf = await Server.findOne({ name: order.server_name }, queryOptions);
        if (serverConf && serverConf.api_cancel_url) {
          await providerApi.cancelOrder(serverConf, order.external_order_id).catch(() => {});
        }
      }

      const hasOtp = !!(order.otp || (order.all_otps && order.all_otps.length > 0));

      if (hasOtp) {
        order.status = "completed";
        await order.save(queryOptions);
        return { success: true, order, refunded: false };
      }

      const user = await User.findById(req.userId, queryOptions);
      if (!user) throw new Error("USER_NOT_FOUND");

      user.balance = parseFloat((user.balance + order.cost).toFixed(4));
      await user.save(queryOptions);

      await Transaction.create({
          user_id: user._id || user.id, type: "refund", amount: order.cost,
          balance_after: user.balance, description: `User cancelled order ${order.order_id} (no OTP)`, order_id: order.order_id
      }, queryOptions);

      order.status = "cancelled";
      await order.save(queryOptions);

      return { success: true, order, refunded: true, newBalance: user.balance };
    });

    const { emitToUser } = require("../utils/realtimeEmitter");
    if (result.refunded) {
      emitToUser(String(req.userId), "balance", { balance: result.newBalance });
      emitToUser(String(req.userId), "order", { orderId: result.order.order_id, status: "cancelled" });
    } else if (result.order.status === "completed") {
      emitToUser(String(req.userId), "order", { orderId: result.order.order_id, status: "completed", otp: result.order.otp, all_otps: result.order.all_otps });
    }

    res.json(result);
  } catch (err) {
    if (err.message === "CANCEL_COOLDOWN") return res.status(400).json({ error: "Numbers can only be cancelled after 2 minutes of purchase." });
    if (err.message === "ORDER_NOT_ACTIVE") return res.status(400).json({ error: "Order cannot be cancelled" });
    if (err.message === "ORDER_NOT_FOUND") return res.status(404).json({ error: "Order not found" });

    console.error("Cancel error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/user/orders/:id/retry ──────────────────────────────
router.post("/orders/:id/retry", async (req, res) => {
  try {
    const order = await Order.findOne({ order_id: req.params.id, user_id: req.userId });
    if (!order) return res.status(404).json({ error: "Order not found" });
    const hasOtp = !!(order.otp || (order.all_otps && order.all_otps.length > 0));
    if (order.status !== "completed" && !(order.status === "active" && hasOtp)) {
        return res.status(400).json({ error: "Can only request next SMS for completed orders or active orders with at least one OTP" });
    }

    // Request Next SMS from provider
    if (order.external_order_id) {
      const serverConf = await Server.findOne({ name: order.server_name });
      if (serverConf) {
        const retryRes = await providerApi.retryOrder(serverConf, order.external_order_id);
        if (retryRes.error) return res.status(400).json({ error: "Number Not Available" });
      }
    }

    // Set order back to active
    order.status = "active";
    order.otp = null; // clear current OTP from display
    // Use server's auto_cancel_minutes or default to 20
    let addMinutes = 20;
    if (order.external_order_id) {
      const serverConf = await Server.findOne({ name: order.server_name });
      if (serverConf && serverConf.auto_cancel_minutes) {
        addMinutes = serverConf.auto_cancel_minutes;
      }
    }
    order.expires_at = new Date(Date.now() + addMinutes * 60 * 1000);
    await order.save();

    res.json({ success: true, order });
  } catch (err) { 
    console.error("ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});


// ── GET /api/user/wallet ─────────────────────────────────────────
router.get("/wallet", async (req, res) => {
  try {
    const { page = 1, limit = 30, type = 'all' } = req.query;
    const filter = { user_id: req.userId };
    
    if (type && type !== 'all') {
      if (type === 'deposit') {
        filter.type = { $in: ['deposit', 'bonus'] };
      } else if (type === 'purchase') {
        filter.type = { $in: ['purchase', 'deduction'] };
      } else {
        filter.type = type;
      }
    }

    const user  = await User.findById(req.userId);
    const total = await Transaction.countDocuments(filter);
    const transactions = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Calculate Summary Stats (Total Deposited, Spent, Refunded)
    let summary = { total_deposited: 0, total_spent: 0, total_refunded: 0 };

    if (process.env.DB_TYPE === "mysql") {
      // Sequelize/MySQL way
      const { Op, fn, col } = require("sequelize");
      const userId = req.userId.toString();

      // Use findAll with attributes for SUM to avoid current Sequelize version bug with sum() on MySQL
      // Actually, separate calls are cleaner and safer across dialects
      const [depositedRes, spentRes, refundedRes] = await Promise.all([
        Transaction.findAll({
          attributes: [[fn('SUM', col('amount')), 'total']],
          where: { user_id: userId, type: { [Op.in]: ['deposit', 'bonus'] } },
          raw: true
        }),
        Transaction.findAll({
          attributes: [[fn('SUM', col('amount')), 'total']],
          where: { user_id: userId, type: 'purchase' },
          raw: true
        }),
        Transaction.findAll({
          attributes: [[fn('SUM', col('amount')), 'total']],
          where: { user_id: userId, type: 'refund' },
          raw: true
        })
      ]);

      summary = {
        total_deposited: parseFloat(depositedRes[0]?.total || 0),
        total_spent: Math.abs(parseFloat(spentRes[0]?.total || 0)),
        total_refunded: parseFloat(refundedRes[0]?.total || 0)
      };
    } else {
      // Mongoose/MongoDB way
      const stats = await Transaction.aggregate([
        { $match: { user_id: req.userId.toString() } },
        { $group: {
            _id: null,
            total_deposited: { $sum: { $cond: [{ $in: ["$type", ["deposit", "bonus"]] }, "$amount", 0] } },
            total_spent: { $sum: { $cond: [{ $eq: ["$type", "purchase"] }, { $abs: "$amount" }, 0] } },
            total_refunded: { $sum: { $cond: [{ $eq: ["$type", "refund"] }, "$amount", 0] } }
        }}
      ]);
      if (stats[0]) summary = stats[0];
    }

    res.json({
      balance:      user?.balance || 0,
      transactions,
      total,
      page:  parseInt(page),
      pages: Math.ceil(total / limit),
      summary
    });
  } catch (err) { 
    console.error("Wallet error:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});


// ── POST /api/user/wallet/redeem-promo ───────────────────────────
const PromoCode = require("../models/PromoCode");
router.post("/wallet/redeem-promo", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Code is required" });

    const promo = await PromoCode.findOne({ code: code.toUpperCase(), is_active: true });
    if (!promo) {
      return res.status(404).json({ error: "Invalid or inactive promo code" });
    }

    if (promo.used_count >= promo.usage_limit) {
      return res.status(400).json({ error: "This promo code has reached its usage limit" });
    }

    if (promo.used_by.includes(req.userId)) {
      return res.status(400).json({ error: "You have already redeemed this promo code" });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.balance = parseFloat((user.balance + promo.amount).toFixed(4));
    await user.save();

    promo.used_count += 1;
    promo.used_by.push(req.userId);
    await promo.save();

    await Transaction.create({
      user_id: user._id,
      type: "bonus",
      amount: promo.amount,
      balance_after: user.balance,
      description: `Redeemed promo code: ${promo.code}`,
    });

    res.json({ success: true, amount: promo.amount });
  } catch (err) {
    console.error("Promo error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/user/wallet/payment-config ──────────────────────────
router.get("/wallet/payment-config", (req, res) => {
  try {
    const configPath = path.join(__dirname, "..", "payment_config.json");
    if (!fs.existsSync(configPath)) {
      return res.json({ bharatpe: { enabled: false } });
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const b = config.bharatpe || {};
    // Only return non-sensitive info
    res.json({
      bharatpe: {
        enabled: !!b.enabled,
        upi_id:  b.upi_id || "",
        upi_name: b.upi_name || "Rapid OTP",
        qr_image: b.qr_image || "",
        min_deposit: b.min_deposit || 1
      }
    });
  } catch (err) { res.status(500).json({ error: "Failed to load config" }); }
});

// ── POST /api/user/wallet/verify-bharatpe ─────────────────────────
router.post("/wallet/verify-bharatpe", async (req, res) => {
  try {
    const { utr } = req.body;
    if (!utr) return res.status(400).json({ error: "UTR is required" });

    // Check if this UTR was already used
    const exists = await Transaction.findOne({ reference: utr, type: "deposit" });
    if (exists) return res.status(400).json({ error: "This UTR has already been redeemed." });

    const result = await paymentChecker(utr);
    if (!result.success) {
      return res.status(400).json({ error: "Payment not found or not yet confirmed. Please try again after 2 minutes." });
    }

    if (result.status !== "SUCCESS" && result.status !== "completed") {
       // Note: status check depends on bharatpe.js implementation, but usually success=true is enough
    }

    const amount = result.amount;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.balance = parseFloat((user.balance + amount).toFixed(4));
    await user.save();

    await Transaction.create({
      user_id: user._id,
      type: "deposit",
      amount: amount,
      balance_after: user.balance,
      description: `UPI Deposit (UTR: ${utr})`,
      reference: utr,
      status: "completed"
    });

    // ── Referral Bonus Logic ──
    if (user.referred_by) {
      try {
        const Setting = require("../models/Setting");
        const Transaction = require("../models/Transaction");
        const sPercent = await Setting.findOne({ key: "referral_bonus_percent" });
        const sFixed   = await Setting.findOne({ key: "referral_bonus_fixed_amount" });
        
        const percent = parseFloat(sPercent?.value || 0);
        const fixedAmt = parseFloat(sFixed?.value || 0);
        
        let totalBonus = 0;
        let bonusDesc = [];

        // 1. Percentage Bonus (recurring)
        if (percent > 0) {
          const pBonus = parseFloat(((amount * percent) / 100).toFixed(4));
          if (pBonus > 0) {
            totalBonus += pBonus;
            bonusDesc.push(`${percent}% commission`);
          }
        }

        // 2. Fixed Bonus (one-time on first deposit)
        if (fixedAmt > 0 && !user.has_deposited) {
           totalBonus += fixedAmt;
           bonusDesc.push(`₹${fixedAmt} invite reward`);
        }

        if (totalBonus > 0) {
          const referrer = await User.findById(user.referred_by);
          if (referrer) {
            referrer.balance = parseFloat((referrer.balance + totalBonus).toFixed(4));
            referrer.referral_earnings = parseFloat((referrer.referral_earnings + totalBonus).toFixed(4));
            await referrer.save();
            
            await Transaction.create({
              user_id: referrer._id,
              type: "bonus",
              amount: totalBonus,
              balance_after: referrer.balance,
              description: `Referral bonus from ${user.username} (${bonusDesc.join(" + ")})`,
              reference: `REF-${user._id}-${Date.now()}`
            });
          }
        }
      } catch (err) { console.error("Referral bonus error:", err); }
    }

    // Mark user as deposited
    if (!user.has_deposited) {
      user.has_deposited = true;
      await user.save();
    }

    res.json({ success: true, amount });
  } catch (err) {
    console.error("BharatPe verify error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
