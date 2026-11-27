const wallet = require("../utils/wallet");
const express = require("express");
const router  = express.Router();
const mongoose = require("mongoose");
const fs       = require("fs");
const path     = require("path");
const { loginRequired, optionalLogin } = require("../middleware/auth");
const User        = require("../models/User");
const Order       = require("../models/Order");
const Service     = require("../models/Service");
const Server      = require("../models/Server");
const Transaction = require("../models/Transaction");
const Country     = require("../models/Country");
const Setting     = require("../models/Setting");
const { paymentChecker } = require("../utils/bharatpe");
const { paytmChecker } = require("../utils/paytm");
const omnipay = require("../utils/omnipay");
const heleket = require("../utils/heleket");
const eaglepay = require("../utils/eaglepay");
const providerApi = require("../utils/providerApi");
const { nanoid }  = require("nanoid");
const { emitToUser } = require("../utils/realtimeEmitter");
const rateLimit = require("express-rate-limit");
const UserWebhook = require("../models/UserWebhook");
const { DB_TYPE } = require("../utils/db");
const { parseWebhookUrl, buildSmsPayload, deliverWebhook } = require("../utils/customerWebhook");
const { rebuyCancelledOrder, cancelCompletedOrderForRebuy } = require("../utils/rebuy");

// --- CACHE SYSTEM ---
const { getFromCache, setToCache } = require("../utils/apiCache");
const { calculateUserPrice, parseDiscounts } = require("../utils/pricing");

// --- DISCOUNT HELPER ---
// --- DISCOUNT HELPER ---
async function getUserDiscounts(userId) {
  if (!userId) return [];
  const user = await User.findById(userId).select("discounts");
  if (!user) return [];
  return parseDiscounts(user.discounts);
}

let cachedTrending = [];
let lastTrendingTime = 0;
async function getTopTrendingServices() {
  if (Date.now() - lastTrendingTime < 5 * 60 * 1000) return cachedTrending;
  try {
    const Order = require("../models/Order");
    const { DB_TYPE } = require("../utils/db");
    let names = [];
    if (DB_TYPE === "mysql") {
      const { fn, col } = require("sequelize");
      const top = await Order.findAll({
        attributes: ['service_name', [fn('COUNT', col('id')), 'count']],
        group: ['service_name'],
        order: [[fn('COUNT', col('id')), 'DESC']],
        limit: 6
      });
      names = top.map(t => t.service_name);
    } else {
      const top = await Order.aggregate([
        { $group: { _id: "$service_name", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 }
      ]);
      names = top.map(t => t._id).filter(Boolean);
    }
    
    // Ensure the names actually exist in the Service collection, and we have exactly 6
    const Service = require("../models/Service");
    const validServices = await Service.find({ name: { $in: names } }).select("name").lean();
    const validNames = validServices.map(s => s.name);
    
    if (validNames.length < 6) {
       const needed = 6 - validNames.length;
       const fallbacks = await Service.find({ name: { $nin: validNames } }).limit(needed).lean();
       validNames.push(...fallbacks.map(f => f.name));
    }
    names = validNames;

    cachedTrending = names;
    lastTrendingTime = Date.now();
  } catch(e) {
    console.error("Trending error:", e);
  }
  return cachedTrending;
}

// ── GET /api/user/services (public for pricing page) ─────────────
router.get("/services", optionalLogin, async (req, res) => {
  const { country_id, page = 1, limit = 100, q, pinned } = req.query;
  // If user is logged in, we must vary cache by user_id to show their specific discounts
  const cacheKey = `services_${country_id || 'all'}_p${page}_l${limit}_${q || ''}_pin${pinned || ''}_u${req.userId || 'guest'}`;
  
  const cachedData = getFromCache(cacheKey);
  if (cachedData) return res.json(cachedData);

  try {
    const filter = { is_active: true };
    if (country_id) {
       const servers = await Server.find({ country_id }).select("_id");
       filter.server_id = { $in: servers.map(s => s._id) };
    }
    if (q) {
      filter.name = { $regex: q, $options: "i" };
    }

    const total = await Service.countDocuments(filter);
    const uniqueNames = await Service.distinct("name", filter);
    const uniqueTotal = uniqueNames.length;

    const trendingNames = await getTopTrendingServices();

    let services = await Service.find(filter)
      .select("name price server_id service_code country_code image_url min_stock icon_color category is_multi_otp otp_timeout is_trending")
      .populate({
        path: "server_id",
        select: "name country_id",
        populate: { path: "country_id", select: "name flag" }
      })
      .lean();
    
    // Apply user discounts if logged in
    let userDiscounts = [];
    if (req.userId) {
       userDiscounts = await getUserDiscounts(req.userId);
    }

    services.forEach(s => {
      s._id = s._id?.toString() || s.id;
      // Preserve admin-enabled trending or dynamically apply based on popular order volume
      s.is_trending = Boolean(s.is_trending) || trendingNames.includes(s.name);
      
      if (userDiscounts.length > 0) {
        const oldPrice = s.price;
        const newPrice = calculateUserPrice(oldPrice, s.name, userDiscounts, s.server_id?._id?.toString() || s.server_id?.toString() || s.server_id);
        if (newPrice < oldPrice) {
          s.original_price = oldPrice;
          s.price = newPrice;
        }
      }
    });

    const pinnedNames = (pinned || "").split(",").filter(Boolean);

    // Sort pinned to the top, then trending, then alphabetically by name
    services.sort((a, b) => {
      const aPinned = pinnedNames.includes(a.name);
      const bPinned = pinnedNames.includes(b.name);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      
      if (a.is_trending && !b.is_trending) return -1;
      if (!a.is_trending && b.is_trending) return 1;
      return a.name.localeCompare(b.name);
    });

    // Apply pagination in memory
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);
    const paginatedServices = services.slice(startIndex, endIndex);
    
    const response = {
      services: paginatedServices,
      total,
      unique_total: uniqueTotal,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    };

    setToCache(cacheKey, response);
    res.json(response);
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
    const countries = await Country.find({ is_active: true })
      .select("name flag code sort_order")
      .sort({ sort_order: 1, name: 1 })
      .lean();

    setToCache('countries', countries);
    res.json(countries);
  } catch (err) { 
    console.error("ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

// ── GET /api/user/servers (public for buy page) ──────────────────
router.get("/servers", async (req, res) => {
  try {
    const servers = await Server.find({ is_active: true })
      .select("name country_id")
      .lean();
    
    servers.forEach(s => s._id = s._id?.toString() || s.id);
    res.json(servers);
  } catch (err) {
    console.error("[/api/user/servers] Error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});


router.use(loginRequired);

const webhookFilter = req => ({ user_id: String(req.userId) });
const findWebhook = filter => UserWebhook.findOne(DB_TYPE === "mysql" ? { where: filter } : filter);

router.get("/profile/webhook", async (req, res) => {
  try {
    const prefs = await findWebhook(webhookFilter(req));
    res.json({ url: prefs?.url || "" });
  } catch {
    res.status(500).json({ error: "Could not load webhook settings." });
  }
});

router.put("/profile/webhook", async (req, res) => {
  const value = req.body?.url;
  if (typeof value !== "string") return res.status(400).json({ error: "A callback URL is required. Send an empty URL to disable delivery." });
  let url;
  try {
    url = value.trim() ? parseWebhookUrl(value.trim()).href : "";
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const filter = webhookFilter(req);
    const account = await User.findById(req.userId).select("is_banned");
    if (!account || account.is_banned) return res.status(403).json({ error: "This account cannot change webhook settings." });
    if (DB_TYPE === "mysql") {
      if (url) await UserWebhook.upsert({ ...filter, url });
      else await UserWebhook.destroy({ where: filter });
    } else if (url) {
      await UserWebhook.updateOne(filter, { $set: { url } }, { upsert: true, runValidators: true });
    } else {
      await UserWebhook.deleteOne(filter);
    }
    res.json({ url });
  } catch {
    res.status(500).json({ error: "Could not save webhook settings." });
  }
});

const webhookTestLimit = rateLimit({
  windowMs: 60_000,
  limit: 3,
  keyGenerator: req => String(req.userId),
  message: { error: "Too many webhook tests. Try again in a minute." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/profile/webhook/test", webhookTestLimit, async (req, res) => {
  try {
    const [prefs, user] = await Promise.all([
      findWebhook(webhookFilter(req)),
      User.findById(req.userId).select("api_key is_banned"),
    ]);
    if (!user || user.is_banned) return res.status(403).json({ error: "This account cannot send webhook tests." });
    if (!prefs?.url) return res.status(400).json({ error: "Save a callback URL before sending a test." });
    if (!user.api_key) return res.status(400).json({ error: "Generate an API key before sending a test." });
    const sample = buildSmsPayload(
      { order_id: "test-order", service_name: "WhatsApp", country: "India", phone: "+919000000000", cost: 0 },
      "Your verification code is 123456."
    );
    const result = await deliverWebhook(prefs.url, user.api_key, sample);
    if (!result.ok) {
      return res.status(502).json({ error: result.status ? `Callback returned HTTP ${result.status}.` : result.error });
    }
    res.json(result);
  } catch {
    res.status(500).json({ error: "Could not send the webhook test." });
  }
});

// ── GET /api/user/profile ────────────────────────────────────────
router.get("/profile", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password_hash");
    if (!user) return res.status(404).json({ error: "User not found" });



    const data = user.toJSON ? user.toJSON() : user;
    res.json({ ...data, _id: data._id || data.id });
  } catch (err) {
    console.error("[/api/user/profile]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/user/balance ─────────────────────────────────────────
router.get("/balance", async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("balance");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: req.userId, balance: user.balance });
  } catch (err) {
    console.error("[/api/user/balance]", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ── PATCH /api/user/profile ──────────────────────────────────────
router.patch("/profile", async (req, res) => {
  try {
    const { display_name, username, avatar_url, password } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (username && username !== user.username) {
      // Check if username taken
      const existing = await User.findOne({ username });
      if (existing) return res.status(400).json({ error: "Username already taken" });
      user.username = username;
    }

    if (display_name !== undefined) user.display_name = display_name;
    if (avatar_url   !== undefined) user.avatar_url   = avatar_url;
    
    if (password) {
      const bcrypt = require("bcryptjs");
      user.password_hash = await bcrypt.hash(password, 12);
    }

    await user.save();
    res.json({ success: true, user: { username: user.username, display_name: user.display_name, avatar_url: user.avatar_url } });
  } catch (err) {
    console.error("[/api/user/profile] Update Error:", err.message);
    res.status(500).json({ error: "Failed to update profile: " + err.message });
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
    const recentOrders = await Order.find({ user_id: req.userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const serverNames = [...new Set(recentOrders.map(o => o.server_name).filter(Boolean))];
    const servers = await Server.find({ name: { $in: serverNames } })
      .select("name country_id")
      .populate('country_id', 'name')
      .lean();

    const serverMap = new Map(servers.map(s => [s.name, s]));
    const enrichedRecentOrders = recentOrders.map(order => {
      const server = serverMap.get(order.server_name);
      order.server_country = server?.country_id?.name || order.country;
      return order;
    });

    res.json({
      username:      user.username,
      avatar_url:    user.avatar_url,
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
    const sEnabled = await Setting.findOne({ key: "referral_system_enabled" });

    const isEnabled = sEnabled?.value === true || sEnabled?.value === 'true';

    if (!isEnabled) {
        return res.status(403).json({ error: "Referral system is disabled" });
    }

    const user = await User.findById(req.userId).select("id referral_code referral_count referral_earnings");

    if (!user) return res.status(404).json({ error: "User not found" });

    // Always use User ID for the referral identifier as requested
    const effectiveCode = user._id.toString();

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
const orderLocks = new Set();

router.post("/orders", async (req, res) => {
  if (orderLocks.has(req.userId)) {
    return res.status(429).json({ error: "Please wait before making another order." });
  }
  orderLocks.add(req.userId);

  const { withTransaction } = require("../utils/db");
  
  let balanceDeducted = false;
  const reservedOrderId = "ORD-" + nanoid(16).toUpperCase();
  let finalPrice = 0;
  let orderSaved = false;
  let localServerConf = null;
  let localProviderRes = null;

  try {
    const { service_id } = req.body;
    if (!service_id) return res.status(400).json({ error: "service_id is required" });

    // Prepare trusted service/provider configuration before reserving funds
    const orderResult = await withTransaction(async (session) => {
      const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };
      
      const service = process.env.DB_TYPE === "mysql" 
        ? await Service.findById(service_id, queryOptions)
        : await Service.findById(service_id, null, queryOptions);

      if (!service || !service.is_active) throw new Error("Service not found or inactive");

      // Apply User Discount
      const userDoc = await User.findById(req.userId).select("discounts");
      const d = parseDiscounts(userDoc?.discounts);
      const calculatedPrice = calculateUserPrice(service.price, service.name, d, String(service.server_id?._id || service.server_id || ''));
      if (!Number.isFinite(calculatedPrice) || calculatedPrice <= 0) throw new Error("INVALID_SERVICE_PRICE");

      if (calculatedPrice !== service.price) {
        console.log(`[Order] Discount applied for user ${req.userId}: ${service.name} (${service.price} -> ${calculatedPrice})`);
      }

      const serverConf = process.env.DB_TYPE === "mysql"
        ? await Server.findById(service.server_id, queryOptions)
        : await Server.findById(service.server_id, null, queryOptions);

      if (!serverConf) throw new Error("Server not configured");

      if (!serverConf.is_active) throw new Error("Server not configured");
      // Return configuration needed for API call
      return { service, serverConf, finalPrice: calculatedPrice };
    });

    const { service, serverConf } = orderResult;
    localServerConf = serverConf;
    finalPrice = orderResult.finalPrice;
    const reservedUser = await wallet.reservePurchase({
      userId: req.userId, orderId: reservedOrderId, amount: finalPrice,
      description: `Purchased ${service.name} (${service.country_code})`,
    });
    orderResult.userBalance = reservedUser.balance;
    balanceDeducted = true;

    // 2. Provider API call (OUTSIDE database transaction)
    let providerRes;
    try {
      providerRes = await providerApi.getNumber(serverConf, service.service_code, service.country_code);
    } catch (apiErr) {
      providerRes = { error: apiErr.message || "Provider API Failure" };
    }
    localProviderRes = providerRes;

    if (!providerRes || providerRes.error || !providerRes.api_order_id || !providerRes.phone) {
      console.error("❌ PROVIDER API REJECTION ❌", providerRes?.originalError || providerRes?.error);
      throw new Error("PROVIDER_REJECTION");
    }

    // 4. Success: Create order in final transaction
    const orderId = reservedOrderId;
    const cancelMinutes = serverConf.auto_cancel_minutes || 20;
    const expiresAt = new Date(Date.now() + cancelMinutes * 60 * 1000);
    const minCancelMinutes = serverConf.min_cancel_minutes || 0;
    const minCancelAt = new Date(Date.now() + minCancelMinutes * 60 * 1000);

    const orderData = {
      order_id: orderId,
      user_id: req.userId,
      service_id: service._id || service.id,
      service_name: service.name,
      server_name: serverConf.name,
      country: service.country_code,
      phone: providerRes.phone,
      external_order_id: providerRes.api_order_id,
      cost: finalPrice,
      status: "active",
      expires_at: expiresAt,
      min_cancel_at: minCancelAt,
      service_image: service.image_url || "",
      service_color: service.icon_color || "",
      check_interval: serverConf.check_interval || 3,
      multi_otp_enabled: serverConf.multi_otp_supported || false
    };

    const finalResult = await wallet.finalizePurchase(orderData);
    orderSaved = true;
    emitToUser(String(req.userId), "balance", { balance: orderResult.userBalance });

    res.json({ order: finalResult });
  } catch (err) {
    if (balanceDeducted && !orderSaved) {
      console.log(`[Order/Rollback] Rollback refunding user ${req.userId} amount ${finalPrice}`);
      const reversed = await wallet.reversePurchase(reservedOrderId).catch(refundErr => {
        console.error("[Order/Rollback]", reservedOrderId, refundErr.message);
        return false; // durable pending reservation is retried by recovery
      });

      if (reversed && err.message !== "DUPLICATE_EXTERNAL_ORDER" && localProviderRes?.api_order_id && localServerConf) {
        providerApi.cancelOrder(localServerConf, localProviderRes.api_order_id).catch(() => {});
      }
    }

    if (err.message === "INSUFFICIENT_BALANCE") return res.status(402).json({ error: "Insufficient balance" });
    if (err.message === "INVALID_SERVICE_PRICE") return res.status(409).json({ error: "Service price is invalid" });
    if (err.message === "PROVIDER_REJECTION" || err.message === "PROVIDER_TIMEOUT") {
      return res.status(400).json({ error: "No numbers available", code: "NO_NUMBERS" });
    }
    if (err.message === "Service not found or inactive") return res.status(404).json({ error: err.message });
    
    console.error("Order error:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    orderLocks.delete(req.userId);
  }
});

// ── GET /api/user/orders ─────────────────────────────────────────
router.get("/orders", async (req, res) => {
  try {
    const { status, page = 1, limit = 20, q, rebuy_candidates } = req.query;
    const filter = { user_id: req.userId };
    if (q) {
      filter.$or = [
        { order_id: new RegExp(q, "i") },
        { phone: new RegExp(q, "i") },
        { service_name: new RegExp(q, "i") }
      ];
    }

    if (status && status !== "all") {
      if (status === "cancelled") {
        filter.status = { $in: ["cancelled", "expired"] };
      } else {
        filter.status = status;
      }
    }

    if (rebuy_candidates === "1") {
      filter.status = { $in: ["cancelled", "expired", "refunded", "completed"] };
      filter.$and = [{ $or: [{ rebuy_order_id: "" }, { rebuy_order_id: null }] }];
    }
    const total  = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .select("order_id service_id service_name cost status phone createdAt all_otps otp server_name service_image service_color expires_at min_cancel_at rebuy_order_id rebuy_cancelled refund_issued")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    // Enrich with server_country
    const serverNames = [...new Set(orders.map(o => o.server_name).filter(Boolean))];
    const servers = await Server.find({ name: { $in: serverNames } })
      .select("name country_id is_active api_cancel_url api_rebuy_url")
      .populate('country_id', 'name')
      .lean();
    const serverMap = new Map(servers.map(s => [s.name, s]));
    
    orders.forEach(o => {
      o._id = o._id?.toString() || o.id;
      const srv = serverMap.get(o.server_name);
      o.server_country = srv?.country_id?.name || o.country;
      o.can_rebuy = Boolean(srv?.is_active && srv.api_rebuy_url && ["cancelled", "expired", "refunded"].includes(o.status) &&
        o.refund_issued && !o.otp && !(o.all_otps && o.all_otps.length) && !o.rebuy_order_id);
      o.can_rebuy = o.can_rebuy || Boolean(srv?.is_active && srv.api_rebuy_url && o.status === "completed" && o.rebuy_cancelled &&
        (o.otp || o.all_otps?.length) && !o.rebuy_order_id);
      o.can_rebuy_after_cancel = Boolean(srv?.is_active && srv.api_cancel_url && srv?.api_rebuy_url && o.status === "completed" &&
        !o.rebuy_cancelled && !o.rebuy_order_id && (o.otp || o.all_otps?.length));
    });

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
    
    // Trigger background sync if active (non-blocking)
    if (order.status === "active" && order.external_order_id) {
      const { syncOrder } = require("../utils/orderStatusManager");
      syncOrder(order).catch(err => console.error("BG Sync error:", err.message));
    }

    if (!order) return res.status(404).json({ error: "Order not found" });
    const finalOrder = typeof order.toObject === 'function' ? order.toObject() : typeof order.toJSON === 'function' ? order.toJSON() : { ...order };
    finalOrder.server_country = serverConf?.country_id?.name || order.country;
    finalOrder.can_rebuy = Boolean(serverConf?.is_active && serverConf.api_rebuy_url &&
      ["cancelled", "expired", "refunded"].includes(order.status) && order.refund_issued &&
      !order.otp && !(order.all_otps && order.all_otps.length) && !order.rebuy_order_id);
    finalOrder.can_rebuy = finalOrder.can_rebuy || Boolean(serverConf?.is_active && serverConf.api_rebuy_url && order.status === "completed" &&
      order.rebuy_cancelled && (order.otp || order.all_otps?.length) && !order.rebuy_order_id);
    finalOrder.can_rebuy_after_cancel = Boolean(serverConf?.is_active && serverConf.api_cancel_url && serverConf?.api_rebuy_url &&
      order.status === "completed" && !order.rebuy_cancelled && !order.rebuy_order_id && (order.otp || order.all_otps?.length));
    res.json(finalOrder);

  } catch (err) { 
    console.error("Order fetch error:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

// ── POST /api/user/orders/:id/check ──────────────────────────────
router.post("/orders/:id/check", async (req, res) => {
  try {
    const order = await Order.findOne({ order_id: req.params.id, user_id: req.userId });
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (!order.phone) {
      return res.status(400).json({ error: "Phone number is not assigned yet" });
    }

    const { checkServiceNumber } = require("../utils/serviceChecker");
    const result = await checkServiceNumber(order.service_name, order.phone);
    res.json(result);
  } catch (err) {
    console.error("[/api/user/orders/:id/check] Error:", err.message);
    res.status(500).json({ error: "Checker failed: " + err.message });
  }
});

// ── POST /api/user/checker/check ─────────────────────────────────
router.post("/checker/check", async (req, res) => {
  try {
    const { service, mobile } = req.body;
    if (!service || !mobile) {
      return res.status(400).json({ error: "Service and mobile are required" });
    }

    const { checkServiceNumber } = require("../utils/serviceChecker");
    const result = await checkServiceNumber(service, mobile);
    res.json(result);
  } catch (err) {
    console.error("[/api/user/checker/check] Error:", err.message);
    res.status(500).json({ error: "Checker failed: " + err.message });
  }
});

// ── POST /api/user/orders/:id/cancel ─────────────────────────────
router.post("/orders/:id/cancel", async (req, res) => {
  
  try {
    // ── Step 1: Validate the order (no session needed) ────────────
    let order = await Order.findOne({ order_id: req.params.id, user_id: req.userId });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "active") return res.status(400).json({ error: "Order cannot be cancelled" });

    // Exclusive Locking for Order Isolation
    const { acquireLockWithTimeout, releaseLock } = require("../utils/orderLocks");
    const orderIdStr = String(order._id || order.id);
    if (!(await acquireLockWithTimeout(orderIdStr, 6000))) {
      return res.status(429).json({ error: "Order is currently being synchronized. Please try again in a few seconds." });
    }

    try {
      order = await Order.findById(order._id);
      if (!order || order.status !== "active") return res.json({ success: true, order, refunded: false });
      const hasOtp = !!(order.otp || (order.all_otps && order.all_otps.length > 0));

      // Cooldown check (only when no OTP received yet)
      if (!hasOtp && order.min_cancel_at && Date.now() < new Date(order.min_cancel_at).getTime()) {
        return res.status(400).json({ error: "Cancellation is currently locked. Please try again in a few minutes." });
      }

      // ── Step 2: OTP already received — lock out refund, leave order untouched ──
      // Do NOT change order status. The number may still be waiting for more OTPs.
      // Just ensure refund_issued=true so no refund can ever be issued for this order.
      if (hasOtp) {
        const completed = await Order.findOneAndUpdate(
          { _id: order._id, status: "active" },
          { $set: { refund_issued: true, status: "completed" } },
          { new: true }
        );
        // Order moves to completed — removed from active list
        emitToUser(String(req.userId), "order", { orderId: order.order_id, status: "completed" });
        return res.json({ success: true, order: completed || await Order.findById(order._id), refunded: false });
      }

      // ── Step 3: Atomically claim the refund slot ──────────────────
      const result = await wallet.refundOrder(order._id, "cancelled", `User cancelled order ${order.order_id} (no OTP)`);
      if (!result.refunded) return res.json({ success: true, ...result });

      const serverConf = await Server.findOne({ name: order.server_name });
      if (serverConf && serverConf.api_cancel_url && order.external_order_id) {
         providerApi.cancelOrder(serverConf, order.external_order_id).catch(() => {});
      }

      emitToUser(String(req.userId), "balance", { balance: result.newBalance });
      emitToUser(String(req.userId), "order", { orderId: order.order_id, status: "cancelled" });

      res.json({ success: true, ...result });
    } finally {
      releaseLock(orderIdStr);
    }
  } catch (err) {
    if (err.message === "USER_NOT_FOUND") return res.status(500).json({ error: "User not found" });
    if (["PURCHASE_DEBIT_UNVERIFIED", "PURCHASE_LEDGER_MISSING", "ORDER_COST_MISMATCH"].includes(err.message)) return res.status(409).json({ error: "The original charge needs review before this order can be refunded. Please contact support." });
    console.error("Cancel error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/user/orders/:id/retry ──────────────────────────────
router.post("/orders/:id/retry", async (req, res) => {
  const { acquireLockWithTimeout, releaseLock } = require("../utils/orderLocks");
  let retryLockId;
  try {
    let order = await Order.findOne({ order_id: req.params.id, user_id: req.userId });
    if (!order) return res.status(404).json({ error: "Order not found" });
    retryLockId = String(order._id || order.id);
    if (!(await acquireLockWithTimeout(retryLockId, 6000))) {
      retryLockId = null;
      return res.status(409).json({ error: "Order is busy. Try again" });
    }
    order = await Order.findOne({ order_id: req.params.id, user_id: req.userId });
    if (!order || order.rebuy_cancelled || order.rebuy_order_id) return res.status(400).json({ error: "This activation has been cancelled for rebuy" });
    const hasOtp = !!(order.otp || (order.all_otps && order.all_otps.length > 0));
    if (!hasOtp || !["completed", "active"].includes(order.status)) {
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
    order = await Order.findOneAndUpdate({ _id: order._id, status: { $in: ["active", "completed"] }, rebuy_cancelled: { $ne: true }, $or: [{ rebuy_order_id: "" }, { rebuy_order_id: null }], refund_issued: true }, {
      $set: { status: "active", otp: "", refund_issued: true, expires_at: order.expires_at },
    }, { new: true });
    if (!order) return res.status(409).json({ error: "Order state changed" });

    res.json({ success: true, order });
  } catch (err) { 
    console.error("ROUTE_ERROR:", err);
    res.status(500).json({ error: "Server error" }); 
  } finally {
    if (retryLockId) releaseLock(retryLockId);
  }
});

router.post("/orders/:id/rebuy", async (req, res) => {
  try {
    const result = await rebuyCancelledOrder({ orderId: req.params.id, userId: req.userId });
    emitToUser(String(req.userId), "balance", { balance: result.balance });
    emitToUser(String(req.userId), "order", { orderId: result.order.order_id, status: "active" });
    res.status(201).json({ success: true, order: result.order });
  } catch (err) {
    const messages = {
      ORDER_NOT_FOUND: [404, "Order not found"],
      ORDER_NOT_REBUYABLE: [400, "Cancel the activation before rebuying; orders without an OTP must be refunded"],
      REBUY_NOT_CONFIGURED: [409, "Rebuy is not configured for this server"],
      REBUY_ALREADY_USED: [409, "This order has already been rebought"],
      ORIGINAL_REFUND_UNVERIFIED: [409, "The original refund needs review before rebuy"],
      INSUFFICIENT_BALANCE: [402, "Insufficient balance"],
      PROVIDER_NUMBER_MISMATCH: [502, "Provider returned a different number"],
      PROVIDER_REBUY_FAILED: [400, "Number could not be rebought"],
      REBUY_IN_PROGRESS: [429, "Rebuy is already in progress"],
    };
    const [status, error] = messages[err.message] || [500, "Server error"];
    if (status >= 500) console.error("Rebuy error:", err);
    res.status(status).json({ error });
  }
});

router.post("/orders/:id/cancel-for-rebuy", async (req, res) => {
  try {
    const order = await cancelCompletedOrderForRebuy({ orderId: req.params.id, userId: req.userId });
    emitToUser(String(req.userId), "order", { orderId: order.order_id, status: order.status, rebuy_cancelled: true });
    res.json({ success: true, order, can_rebuy: true });
  } catch (err) {
    const messages = {
      ORDER_NOT_FOUND: [404, "Order not found"],
      ORDER_NOT_CANCELLABLE_FOR_REBUY: [400, "Only completed orders with an OTP can be cancelled for rebuy"],
      REBUY_CANCEL_NOT_CONFIGURED: [409, "Cancel and rebuy endpoints are not configured for this server"],
      PROVIDER_CANCEL_FAILED: [502, "Provider could not cancel this activation"],
      ORDER_STATE_CHANGED: [409, "Order state changed. Refresh and try again"],
      REBUY_IN_PROGRESS: [429, "Rebuy is already in progress"],
    };
    const [status, error] = messages[err.message] || [500, "Server error"];
    if (status >= 500) console.error("Cancel for rebuy error:", err);
    res.status(status).json({ error });
  }
});


// ── GET /api/user/wallet ─────────────────────────────────────────
router.get("/wallet", async (req, res) => {
  try {
    const { page = 1, limit = 30, type = 'all', q } = req.query;
    const filter = { user_id: req.userId };
    
    if (q) {
      filter.$or = [
        { description: new RegExp(q, "i") },
        { order_id: new RegExp(q, "i") }
      ];
    }

    
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
          where: { user_id: userId, status: 'completed', type: { [Op.in]: ['deposit', 'bonus'] } },
          raw: true
        }),
        Transaction.findAll({
          attributes: [[fn('SUM', col('amount')), 'total']],
          where: { user_id: userId, type: { [Op.in]: ['purchase', 'deduction'] } },
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
            total_deposited: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "completed"] }, { $in: ["$type", ["deposit", "bonus"]] }] }, "$amount", 0] } },
            total_spent: { $sum: { $cond: [{ $in: ["$type", ["purchase", "deduction"]] }, { $abs: "$amount" }, 0] } },
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

    const { withTransaction } = require("../utils/db");

    const promoAmount = await withTransaction(async (session) => {
      const queryOptions = process.env.DB_TYPE === "mysql" ? { transaction: session } : { session };

      // Find promo code
      let promo;
      if (process.env.DB_TYPE === "mysql") {
        promo = await PromoCode.findOne({
          where: { code: code.toUpperCase(), is_active: true },
          ...queryOptions,
          lock: session.LOCK?.UPDATE || true
        });
      } else {
        promo = await PromoCode.findOne({ code: code.toUpperCase(), is_active: true }, null, queryOptions);
      }

      if (!promo) throw new Error("INVALID_PROMO");
      require("../utils/money").positiveMoney(promo.amount);

      const usedBy = Array.isArray(promo.used_by) ? promo.used_by : JSON.parse(promo.used_by || "[]");
      if (promo.used_count >= promo.usage_limit) throw new Error("LIMIT_REACHED");
      if (usedBy.map(String).includes(String(req.userId))) throw new Error("ALREADY_REDEEMED");

      // Update user balance atomically
      const updatedUser = await User.findOneAndUpdate(
        { _id: req.userId },
        { $inc: { balance: promo.amount } },
        { ...queryOptions, new: true }
      );
      if (!updatedUser) throw new Error("USER_NOT_FOUND");

      // Update promo stats
      if (process.env.DB_TYPE === "mysql") {
        const newUsedBy = [...usedBy, req.userId];
        await promo.update({
          used_count: promo.used_count + 1,
          used_by: newUsedBy
        }, queryOptions);
      } else {
        // In MongoDB we can update atomically
        const res = await PromoCode.findOneAndUpdate(
          { _id: promo._id, used_count: promo.used_count },
          { 
            $inc: { used_count: 1 }, 
            $push: { used_by: req.userId } 
          },
          { ...queryOptions, new: true }
        );
        if (!res) throw new Error("CONCURRENCY_ERROR");
      }

      // Create transaction
      const txData = {
        user_id: updatedUser._id || updatedUser.id,
        type: "bonus",
        amount: promo.amount,
        balance_after: updatedUser.balance,
        description: `Redeemed promo code: ${promo.code}`,
      };

      if (process.env.DB_TYPE === "mysql") {
        await Transaction.create(txData, queryOptions);
      } else {
        await Transaction.create([txData], queryOptions);
      }

      return promo.amount;
    });

    res.json({ success: true, amount: promoAmount });
  } catch (err) {
    if (err.message === "INVALID_PROMO") {
      return res.status(404).json({ error: "Invalid or inactive promo code" });
    }
    if (err.message === "LIMIT_REACHED") {
      return res.status(400).json({ error: "This promo code has reached its usage limit" });
    }
    if (err.message === "ALREADY_REDEEMED") {
      return res.status(400).json({ error: "You have already redeemed this promo code" });
    }
    console.error("Promo error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/user/wallet/payment-config ──────────────────────────
router.get("/wallet/payment-config", async (req, res) => {
  try {
    const configPath = path.join(__dirname, "..", "payment_config.json");
    if (!fs.existsSync(configPath)) {
      return res.json({ bharatpe: { enabled: false } });
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const b = config.bharatpe || {};
    const p = config.paytm || {};
    const o = config.omnipay || {};
    // Only return non-sensitive info
    res.json({
      bharatpe: {
        enabled: !!b.enabled,
        display_name: b.display_name || b.displayName || "BharatPe",
        upi_id:  b.upi_id || "",
        upi_name: b.upi_name || "Rapid OTP",
        qr_image: b.qr_image || "",
        min_deposit: b.min_deposit || 1,
        commission_percent: b.commission_percent || 0,
        bonus_enabled: !!b.bonus_enabled,
        bonus_type: b.bonus_type || "percent",
        bonus_value: b.bonus_value || 0
      },
      paytm: {
        enabled: !!p.enabled,
        display_name: p.display_name || p.displayName || "Paytm Business",
        upi_id:  p.upi_id || "",
        upi_name: p.upi_name || "Rapid OTP",
        min_deposit: p.min_deposit || 1,
        commission_percent: p.commission_percent || 0,
        bonus_enabled: !!p.bonus_enabled,
        bonus_type: p.bonus_type || "percent",
        bonus_value: p.bonus_value || 0
      },
      omnipay: {
        enabled: !!o.enabled,
        display_name: o.display_name || o.displayName || "OmniPay",
        min_deposit: o.min_deposit || 10,
        commission_percent: o.commission_percent || 0,
        bonus_enabled: !!o.bonus_enabled,
        bonus_type: o.bonus_type || "percent",
        bonus_value: o.bonus_value || 0
      },
      heleket: {
        enabled: !!(config.heleket && config.heleket.enabled),
        display_name: (config.heleket && (config.heleket.display_name || config.heleket.displayName)) || "Crypto (USDT / BTC / ETH)",
        min_deposit: (config.heleket && config.heleket.min_deposit !== undefined) ? config.heleket.min_deposit : 1,
        allow_currencies: (config.heleket && config.heleket.allow_currencies) || "",
        discount_percent: (config.heleket && config.heleket.discount_percent) || 0,
        commission_percent: (config.heleket && config.heleket.commission_percent) || 0,
        bonus_enabled: !!(config.heleket && config.heleket.bonus_enabled),
        bonus_type: (config.heleket && config.heleket.bonus_type) || "percent",
        bonus_value: (config.heleket && config.heleket.bonus_value) || 0,
        usd_rate: await heleket.getCurrentUsdToInrRate()
      },
      eaglepay: {
        enabled: !!(config.eaglepay && config.eaglepay.enabled),
        display_name: (config.eaglepay && (config.eaglepay.display_name || config.eaglepay.displayName)) || "Eagle Pay",
        trade_type: (config.eaglepay && config.eaglepay.trade_type) || "INRUPI",
        currency: (config.eaglepay && config.eaglepay.currency) || "INR",
        min_deposit: (config.eaglepay && config.eaglepay.min_deposit !== undefined) ? config.eaglepay.min_deposit : 100,
        commission_percent: (config.eaglepay && config.eaglepay.commission_percent) || 0,
        bonus_enabled: !!(config.eaglepay && config.eaglepay.bonus_enabled),
        bonus_type: (config.eaglepay && config.eaglepay.bonus_type) || "percent",
        bonus_value: (config.eaglepay && config.eaglepay.bonus_value) || 0
      }
    });
  } catch (err) { res.status(500).json({ error: "Failed to load config" }); }
});

// ── GET /api/user/wallet/heleket-services ────────────────────────
router.get("/wallet/heleket-services", async (req, res) => {
  try {
    const configPath = path.join(__dirname, "..", "payment_config.json");
    let hConfig = {};
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      hConfig = config.heleket || {};
    }
    const usdRate = await heleket.getCurrentUsdToInrRate();

    if (hConfig.merchant_id && hConfig.payment_key) {
      try {
        const liveServices = await heleket.getPaymentServices(hConfig);
        if (Array.isArray(liveServices) && liveServices.length > 0) {
          const publicServices = liveServices.map(({ commission_percent, commission, min_amount, max_amount, ...rest }) => {
            const minUsd = (min_amount !== undefined && !isNaN(min_amount)) ? parseFloat(min_amount) : 1;
            const maxUsd = (max_amount !== undefined && !isNaN(max_amount)) ? parseFloat(max_amount) : 50000;
            return {
              ...rest,
              min_amount: minUsd,
              max_amount: maxUsd,
              min_inr: Math.ceil(minUsd * usdRate),
              max_inr: Math.floor(maxUsd * usdRate)
            };
          });
          return res.json({ success: true, services: publicServices, source: "live_api", usd_rate: usdRate });
        }
      } catch (apiErr) {
        console.warn("Could not fetch live Heleket services (`POST /v1/payment/services`), falling back to detailed rates:", apiErr.message);
      }
    }

    // Comprehensive fallback dataset of Heleket available crypto services with min & max deposit (commission stripped for public view)
    const fallbackServices = [
      { currency: "USDT", network: "TRC20", min_amount: 1, max_amount: 50000, min_inr: Math.ceil(1 * usdRate), max_inr: Math.floor(50000 * usdRate), is_available: true },
      { currency: "USDT", network: "ERC20", min_amount: 5, max_amount: 100000, min_inr: Math.ceil(5 * usdRate), max_inr: Math.floor(100000 * usdRate), is_available: true },
      { currency: "USDT", network: "BEP20", min_amount: 1, max_amount: 50000, min_inr: Math.ceil(1 * usdRate), max_inr: Math.floor(50000 * usdRate), is_available: true },
      { currency: "BTC", network: "BITCOIN", min_amount: 10, max_amount: 100000, min_inr: Math.ceil(10 * usdRate), max_inr: Math.floor(100000 * usdRate), is_available: true },
      { currency: "ETH", network: "ETHEREUM", min_amount: 10, max_amount: 100000, min_inr: Math.ceil(10 * usdRate), max_inr: Math.floor(100000 * usdRate), is_available: true },
      { currency: "TRX", network: "TRON", min_amount: 1, max_amount: 25000, min_inr: Math.ceil(1 * usdRate), max_inr: Math.floor(25000 * usdRate), is_available: true },
      { currency: "LTC", network: "LITECOIN", min_amount: 2, max_amount: 25000, min_inr: Math.ceil(2 * usdRate), max_inr: Math.floor(25000 * usdRate), is_available: true },
      { currency: "BNB", network: "BSC", min_amount: 2, max_amount: 50000, min_inr: Math.ceil(2 * usdRate), max_inr: Math.floor(50000 * usdRate), is_available: true },
      { currency: "SOL", network: "SOLANA", min_amount: 2, max_amount: 50000, min_inr: Math.ceil(2 * usdRate), max_inr: Math.floor(50000 * usdRate), is_available: true },
      { currency: "DOGE", network: "DOGECOIN", min_amount: 2, max_amount: 10000, min_inr: Math.ceil(2 * usdRate), max_inr: Math.floor(10000 * usdRate), is_available: true },
      { currency: "XRP", network: "RIPPLE", min_amount: 2, max_amount: 50000, min_inr: Math.ceil(2 * usdRate), max_inr: Math.floor(50000 * usdRate), is_available: true },
      { currency: "TON", network: "TON", min_amount: 1, max_amount: 25000, min_inr: Math.ceil(1 * usdRate), max_inr: Math.floor(25000 * usdRate), is_available: true }
    ];

    res.json({ success: true, services: fallbackServices, source: "fallback", usd_rate: usdRate });
  } catch (err) {
    console.error("Heleket services endpoint error:", err);
    res.status(500).json({ error: "Failed to fetch Heleket services" });
  }
});

// ── POST /api/user/wallet/eaglepay-payin ─────────────────────────────────────
router.post("/wallet/eaglepay-payin", loginRequired, async (req, res) => {
  try {
    const configPath = path.join(__dirname, "..", "payment_config.json");
    if (!fs.existsSync(configPath)) return res.status(503).json({ error: "Gateway not configured" });
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const epCfg = cfg.eaglepay || {};

    if (!epCfg.enabled) return res.status(503).json({ error: "Eagle Pay is not enabled" });
    if (!epCfg.merchant_id || !epCfg.api_key) {
      return res.status(503).json({ error: "Eagle Pay credentials not configured" });
    }

    const { amount } = req.body;
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    const depositAmount = require("../utils/money").positiveMoney(amount);
    const minDeposit = epCfg.min_deposit || 100;
    if (depositAmount < minDeposit) {
      return res.status(400).json({ error: `Minimum deposit is ₹${minDeposit}` });
    }

    // Apply commission surcharge (user pays extra, wallet credit = original amount)
    const commission = parseFloat(epCfg.commission_percent) || 0;
    const chargeAmount = commission > 0
      ? parseFloat((depositAmount * (1 + commission / 100)).toFixed(2))
      : depositAmount;

    const orderNo = `EP-${nanoid(20)}`;
    const siteHost = process.env.SITE_URL || `https://${req.hostname}`;
    const callbackUrl = epCfg.callback_url || `${siteHost}/api/payment/eaglepay/callback`;
    const returnUrl = epCfg.return_url || `${siteHost}/dashboard/wallet`;

    // Store pending transaction
    await wallet.createTransaction({
      user_id: req.userId,
      type: "deposit",
      amount: depositAmount,
      status: "pending",
      reference: orderNo,
      description: `Eagle Pay Deposit Initiated (Ref: ${orderNo})`
    });

    const result = await eaglepay.createPayin(epCfg, {
      amount: chargeAmount,
      orderNo,
      callbackUrl,
      returnUrl,
      tradeType: epCfg.trade_type || "INRUPI",
      currency: epCfg.currency || "INR"
    });

    if (!result || !result.success) {
      console.error("[EaglePay Payin] Gateway error:", result);
      return res.status(502).json({ error: result?.message || "Gateway error. Please try again." });
    }

    const paymentUrl = result.data?.payment_url || result.data?.pay_url;
    if (!paymentUrl) {
      return res.status(502).json({ error: "Gateway did not return a payment URL." });
    }


    res.json({
      success: true,
      payment_url: paymentUrl,
      order_no: orderNo,
      amount: depositAmount,
      charge_amount: chargeAmount,
      gateway_order_no: result.data?.order_no
    });
  } catch (err) {
    console.error("[EaglePay Payin Error]:", err);
    res.status(500).json({ error: "Failed to initiate Eagle Pay payment" });
  }
});

// ── POST /api/user/wallet/verify-eaglepay ─────────────────────────────────────
router.post("/wallet/verify-eaglepay", loginRequired, async (req, res) => {
  try {
    const { order_no } = req.body;
    if (!order_no) return res.status(400).json({ error: "order_no required" });

    const configPath = path.join(__dirname, "..", "payment_config.json");
    if (!fs.existsSync(configPath)) return res.status(503).json({ error: "Gateway not configured" });
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const epCfg = cfg.eaglepay || {};

    if (!epCfg.enabled) return res.status(503).json({ error: "Eagle Pay is not enabled" });

    // Look up the pending transaction first
    const tx = await Transaction.findOne({ reference: order_no, user_id: String(req.userId), type: "deposit" });
    if (!tx) return res.status(404).json({ error: "Order not found. Please retry or contact support." });

    if (tx.status === "completed") {
      return res.json({ success: true, message: "Already credited", amount: tx.amount });
    }

    // Query Eagle Pay for status
    const queryResult = await eaglepay.queryOrder(epCfg, { orderNo: order_no });

    const status = queryResult?.data?.status || queryResult?.data?.order_status;
    // Accepted statuses from Eagle Pay: "success", "paid", "1" (numeric), "SUCCESS"
    const isPaid = status && ["success","paid","1","SUCCESS","PAID","completed"].includes(String(status).toLowerCase() === "1" ? "1" : String(status).toLowerCase());

    if (!isPaid) {
      return res.status(202).json({
        success: false,
        message: `Payment status: ${status || "pending"}. Please wait and try again.`
      });
    }

    const credited = await wallet.creditDeposit({ transactionId: tx._id, userId: req.userId,
      config: epCfg, description: `Eagle Pay Deposit (Ref: ${tx.reference})` });
    const updatedUser = credited.user;
    const { totalCredit, bonusAmount, base_amount: creditAmount } = credited;

    if (updatedUser) {
      const { emitToUser } = require("../utils/realtimeEmitter");
      emitToUser(req.userId.toString(), "wallet_update", { balance: updatedUser.balance });
    }

    res.json({ success: true, amount: totalCredit, base_amount: creditAmount, bonus_amount: bonusAmount, message: "Payment confirmed and wallet credited!" });
  } catch (err) {
    if (err.message === "ALREADY_CREDITED") return res.json({ success: true, message: "Already credited" });
    console.error("[EaglePay Verify Error]:", err);
    res.status(500).json({ error: "Failed to verify Eagle Pay payment" });
  }
});

// ── POST /api/user/wallet/upi-initiate ─────────────────────────
router.post("/wallet/upi-initiate", loginRequired, async (req, res) => {
  try {
    const { method, amount } = req.body;
    const parsedAmt = Number(amount);
    if (!Number.isFinite(parsedAmt) || parsedAmt < 1) {
      return res.status(400).json({ error: "Invalid deposit amount." });
    }

    const configPath = path.join(__dirname, "..", "payment_config.json");
    let cfg = {};
    if (fs.existsSync(configPath)) {
      cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
    const gatewayKey = method === "paytm" ? "paytm" : "bharatpe";
    const gConfig = cfg[gatewayKey] || {};
    const gatewayName = gConfig.display_name || (gatewayKey === "paytm" ? "Paytm Business" : "BharatPe");

    const prefix = gatewayKey === "paytm" ? "PTM" : "BP";
    const orderNo = `${prefix}-${nanoid(20)}`;

    const txData = {
      user_id: req.userId,
      type: "deposit",
      amount: parsedAmt,
      balance_after: 0,
      description: `Pending ${gatewayName} Deposit (Ref: ${orderNo})`,
      reference: orderNo,
      status: "pending"
    };

    if (process.env.DB_TYPE === "mysql") {
      await Transaction.create(txData);
    } else {
      await Transaction.create([txData]);
    }

    res.json({ success: true, order_no: orderNo, amount: parsedAmt, gateway: gatewayKey });
  } catch (err) {
    console.error("UPI initiate error:", err);
    res.status(500).json({ error: "Server error initiating UPI deposit" });
  }
});

// ── POST /api/user/wallet/verify-bharatpe ─────────────────────────
router.post("/wallet/verify-bharatpe", async (req, res) => {
  try {
    const { utr, order_no } = req.body;
    if (!utr || typeof utr !== "string" || utr.trim().length < 8 || utr.trim().length > 30) {
      return res.status(400).json({ error: "Invalid UTR format. UTR must be between 8 and 30 characters." });
    }

    const cleanUtr = utr.trim();

    // Check 1: Find if already completed with this UTR
    const exists = await Transaction.findOne({ reference: cleanUtr, type: "deposit", status: "completed" });
    if (exists) return res.status(400).json({ error: "This UTR has already been redeemed." });

    const result = await paymentChecker(cleanUtr);
    if (!result.success) {
      if (result.reason === "unavailable") {
        return res.status(503).json({ error: "BharatPe verification is temporarily unavailable. Keep your UTR and try again later." });
      }
      if (result.reason === "search_incomplete") {
        return res.status(503).json({ error: "BharatPe could not finish checking recent payments. Keep your UTR and contact support if the issue persists." });
      }
      // If unconfirmed, update existing pending transaction with submitted UTR if found
      if (order_no) {
        try {
          const pendingTx = await Transaction.findOne({ reference: order_no, user_id: req.userId, type: "deposit", status: "pending" });
          if (pendingTx) {
            pendingTx.description = `Pending BharatPe Deposit (Submitted UTR: ${cleanUtr})`;
            await pendingTx.save();
          }
        } catch (_) {}
      }
      const error = result.reason === "not_confirmed"
        ? "BharatPe has not confirmed this payment. Check its status in your UPI app before retrying."
        : "This UTR was not found in recent BharatPe payments. Check the UTR and try again in a few minutes.";
      return res.status(400).json({ error });
    }

    // Reverse-calculate wallet credit: strip gateway commission so user gets their desired credit amount
    const paidAmount = result.amount;
    let creditAmount = paidAmount;
    let bpCfg = {};
    try {
      const cfgPath = path.join(__dirname, "..", "payment_config.json");
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        bpCfg = cfg.bharatpe || {};
        const commission = parseFloat(bpCfg.commission_percent) || 0;
        if (commission > 0) {
          creditAmount = parseFloat((paidAmount / (1 + commission / 100)).toFixed(2));
        }
      }
    } catch (_) {}

    const credited = await wallet.creditReceipt({
      reference: cleanUtr, userId: req.userId, amount: creditAmount,
      config: bpCfg, description: `UPI Deposit (UTR: ${cleanUtr})`, orderNo: order_no,
    });
    const { totalCredit, bonusAmount } = credited;

    res.json({ success: true, amount: totalCredit, base_amount: creditAmount, bonus_amount: bonusAmount });
  } catch (err) {
    if (err.message === "PAYMENT_ORDER_NOT_FOUND") return res.status(404).json({ error: "Payment order not found" });
    if (err.message === "ALREADY_CREDITED") return res.json({ success: true, message: "Already credited" });
    if (err.message === "ALREADY_REDEEMED" || err.name === "SequelizeUniqueConstraintError" || err.code === 11000) {
      return res.status(400).json({ error: "This UTR has already been redeemed." });
    }
    console.error("BharatPe verify error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/user/wallet/verify-paytm ───────────────────────────
router.post("/wallet/verify-paytm", async (req, res) => {
  try {
    const { utr, order_no } = req.body;
    if (!utr || typeof utr !== "string" || utr.trim().length < 8 || utr.trim().length > 30) {
      return res.status(400).json({ error: "Invalid UTR format. UTR must be between 8 and 30 characters." });
    }

    const cleanUtr = utr.trim();

    // Check 1: Find if already completed with this UTR
    const exists = await Transaction.findOne({ reference: cleanUtr, type: "deposit", status: "completed" });
    if (exists) {
      return res.status(400).json({ error: "This UTR has already been redeemed." });
    }

    const result = await paytmChecker(cleanUtr);
    if (!result.success) {
      // If unconfirmed, update existing pending transaction with submitted UTR if found
      if (order_no) {
        try {
          const pendingTx = await Transaction.findOne({ reference: order_no, user_id: String(req.userId), type: "deposit", status: "pending" });
          if (pendingTx && pendingTx.status === "pending") {
            pendingTx.description = `Pending Paytm Deposit (Submitted UTR: ${cleanUtr})`;
            await pendingTx.save();
          }
        } catch (_) {}
      }
      return res.status(400).json({ error: "Payment not found or not yet confirmed. Please try again after 2 minutes." });
    }

    // Reverse-calculate wallet credit: strip gateway commission so user gets their desired credit amount
    const paidAmount = result.amount;
    let creditAmount = paidAmount;
    let ptCfg = {};
    try {
      const cfgPath = path.join(__dirname, "..", "payment_config.json");
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        ptCfg = cfg.paytm || {};
        const commission = parseFloat(ptCfg.commission_percent) || 0;
        if (commission > 0) {
          creditAmount = parseFloat((paidAmount / (1 + commission / 100)).toFixed(2));
        }
      }
    } catch (_) {}

    const credited = await wallet.creditReceipt({
      reference: cleanUtr, userId: req.userId, amount: creditAmount,
      config: ptCfg, description: `Paytm Deposit (UTR: ${cleanUtr})`, orderNo: order_no,
    });
    const { totalCredit, bonusAmount } = credited;

    res.json({ success: true, amount: totalCredit, base_amount: creditAmount, bonus_amount: bonusAmount });
  } catch (err) {
    if (err.message === "PAYMENT_ORDER_NOT_FOUND") return res.status(404).json({ error: "Payment order not found" });
    if (err.message === "ALREADY_CREDITED") return res.json({ success: true, message: "Already credited" });
    if (err.message === "ALREADY_REDEEMED" || err.name === "SequelizeUniqueConstraintError" || err.code === 11000) {
      return res.status(400).json({ error: "This UTR has already been redeemed." });
    }
    console.error("Paytm verify error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/user/wallet/omnipay-create ────────────────────────
router.post("/wallet/omnipay-create", async (req, res) => {
  try {
    const { amount } = req.body;
    if (!Number.isFinite(Number(amount)) || Number(amount) < 1) {
      return res.status(400).json({ error: "Invalid deposit amount." });
    }

    const configPath = path.join(__dirname, "..", "payment_config.json");
    if (!fs.existsSync(configPath)) return res.status(400).json({ error: "Payment gateway disabled." });
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const o = cfg.omnipay || {};
    if (!o.enabled) return res.status(400).json({ error: "OmniPay is currently disabled." });

    if (amount < (o.min_deposit || 10)) {
      return res.status(400).json({ error: `Minimum deposit for OmniPay is ₹${o.min_deposit || 10}` });
    }

    const orderNo = `OMNI-${nanoid(20)}`;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers.host || "localhost:5007";
    let callbackUrl = o.callback_url || `${protocol}://${host}/api/payment/omnipay/callback`;
    let jumpUrl = o.jump_url || o.redirect_url || `${protocol}://${host}/dashboard/wallet?omnipay_order=${orderNo}`;
    if (callbackUrl.includes("{order_no}")) callbackUrl = callbackUrl.replace(/{order_no}/g, orderNo);
    if (jumpUrl.includes("{order_no}")) jumpUrl = jumpUrl.replace(/{order_no}/g, orderNo);

    const omniConfig = {
      appId: o.app_id || o.appId,
      appSecret: o.app_secret || o.appSecret,
      apiBase: o.api_base || o.apiBase || "https://api.omnipay.global"
    };

    // Calculate pay amount: original credit amount + gateway commission surcharge
    const commission = parseFloat(o.commission_percent) || 0;
    const creditAmount = require("../utils/money").positiveMoney(amount);
    const payAmount = commission > 0
      ? parseFloat((creditAmount * (1 + commission / 100)).toFixed(2))
      : creditAmount;

    const txData = {
      user_id: req.userId,
      type: "deposit",
      amount: creditAmount,
      balance_after: 0,
      description: `Pending OmniPay Deposit (Ref: ${orderNo})`,
      reference: orderNo,
      status: "pending"
    };
    if (process.env.DB_TYPE === "mysql") {
      await Transaction.create(txData);
    } else {
      await Transaction.create([txData]);
    }

    const result = await omnipay.createOrder(omniConfig, {
      amount: payAmount,
      orderNo,
      callbackUrl,
      jumpUrl,
      userId: req.userId
    });

    if (result && (result.code === 200 || result.success)) {
      const details = result.data?.details || {};
      const paymentUrl = details.redirect_url || details.redirect_uri || result.data?.payment_url || result.data?.pay_url || result.data?.intent_url || result.data?.qr_code || result.payment_url || null;
      const upiUri = details.redirect_uri || details.qr_code || (typeof result.data?.qr_code === 'string' && result.data.qr_code.startsWith('upi://') ? result.data.qr_code : null);

      return res.json({
        success: true,
        order_no: orderNo,
        trade_no: result.data?.trade_no || null,
        amount: creditAmount,
        pay_amount: payAmount,
        commission_percent: commission,
        payment_url: paymentUrl,
        upi_uri: upiUri,
        qr_code: details.qr_code || result.data?.qr_code || null,
        data: result.data || result
      });
    }

    return res.status(400).json({ error: result?.message || "Failed to initiate payment. Please try again." });
  } catch (err) {
    console.error("OmniPay create error:", err);
    res.status(500).json({ error: "Server error creating payment." });
  }
});

// ── POST /api/user/wallet/verify-omnipay ────────────────────────
router.post("/wallet/verify-omnipay", async (req, res) => {
  try {
    const { order_no, utr } = req.body;
    const lookupKey = (order_no || utr || "").trim();
    if (!lookupKey) return res.status(400).json({ error: "Order number or UTR required." });

    // Check if already redeemed or completed
    const exists = await Transaction.findOne({ reference: lookupKey, user_id: String(req.userId), type: "deposit" });
    if (!exists) return res.status(404).json({ error: "Payment order not found" });
    if (exists && exists.status === "completed") {
      return res.status(400).json({ error: "This transaction has already been redeemed." });
    }

    const configPath = path.join(__dirname, "..", "payment_config.json");
    if (!fs.existsSync(configPath)) return res.status(400).json({ error: "Payment configuration missing." });
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const o = cfg.omnipay || {};

    const omniConfig = {
      appId: o.app_id || o.appId,
      appSecret: o.app_secret || o.appSecret,
      apiBase: o.api_base || o.apiBase || "https://api.omnipay.global"
    };

    const data = await omnipay.queryOrder(omniConfig, lookupKey);
    if (!data) {
      return res.status(400).json({ error: "Payment not found or not yet confirmed by gateway. Please wait 1-2 minutes and try checking again." });
    }

    const statusStr = String(data.status || "").toUpperCase();
    const isSuccess = statusStr === "SUCCEEDED" || statusStr === "SUCCESS" || statusStr === "PAID" || statusStr === "COMPLETED" || statusStr === "1" || data.status === 1 || statusStr === "2" || data.status === 2;

    if (!isSuccess) {
      return res.status(400).json({ error: `Payment is currently ${data.status || "PENDING"}. Once paid, please check again.` });
    }

    const credited = await wallet.creditDeposit({ transactionId: exists._id, userId: req.userId,
      config: o, description: `OmniPay Deposit (Ref: ${exists.reference})` });
    const updatedUser = credited.user;
    const { totalCredit, bonusAmount, base_amount: creditAmount } = credited;

    res.json({ success: true, amount: totalCredit, base_amount: creditAmount, bonus_amount: bonusAmount });
  } catch (err) {
    if (err.message === "ALREADY_CREDITED") return res.json({ success: true, message: "Already credited" });
    if (err.message === "ALREADY_REDEEMED" || err.name === "SequelizeUniqueConstraintError" || err.code === 11000) {
      return res.status(400).json({ error: "This transaction has already been redeemed." });
    }
    console.error("OmniPay verify error:", err);
    res.status(500).json({ error: "Server error verifying payment." });
  }
});

// ── POST /api/user/wallet/heleket-create ────────────────────────
router.post("/wallet/heleket-create", loginRequired, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!Number.isFinite(Number(amount)) || Number(amount) < 1) {
      return res.status(400).json({ error: "Invalid deposit amount." });
    }

    const configPath = path.join(__dirname, "..", "payment_config.json");
    if (!fs.existsSync(configPath)) return res.status(400).json({ error: "Payment gateway disabled." });
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const hConfig = cfg.heleket || {};
    if (!hConfig.enabled) return res.status(400).json({ error: "Crypto gateway is currently disabled." });

    const minDep = (hConfig.min_deposit !== undefined) ? hConfig.min_deposit : 1;
    if (amount < minDep) {
      return res.status(400).json({ error: `Minimum deposit for Crypto is ₹${minDep}` });
    }

    const orderNo = `HEL-${nanoid(20)}`;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers.host || "localhost:5007";
    const callbackUrl = `${protocol}://${host}/api/payment/heleket/callback`;
    const returnUrl = `${protocol}://${host}/dashboard/wallet?heleket_order=${orderNo}`;

    // Calculate pay amount: original credit amount + gateway commission surcharge
    const commission = parseFloat(hConfig.commission_percent) || 0;
    const creditAmount = require("../utils/money").positiveMoney(amount);
    const payAmount = commission > 0
      ? parseFloat((creditAmount * (1 + commission / 100)).toFixed(2))
      : creditAmount;

    // Record pending transaction for the CREDIT amount (not the pay amount)
    const txData = {
      user_id: req.userId,
      type: "deposit",
      amount: creditAmount,
      balance_after: 0,
      description: `Pending Heleket Crypto Deposit (Ref: ${orderNo})`,
      reference: orderNo,
      status: "pending"
    };
    if (process.env.DB_TYPE === "mysql") {
      await Transaction.create(txData);
    } else {
      await Transaction.create([txData]);
    }

    const invoice = await heleket.createInvoice(hConfig, {
      amount: payAmount.toFixed(2),
      currency: "INR",
      order_id: orderNo,
      url_callback: callbackUrl,
      url_return: returnUrl,
      url_success: returnUrl
    });

    return res.json({
      success: true,
      order_id: orderNo,
      uuid: invoice.uuid,
      url: invoice.url,
      amount: creditAmount,
      pay_amount: payAmount,
      commission_percent: commission,
      currency: invoice.currency || "INR"
    });
  } catch (err) {
    console.error("Heleket create invoice error:", err);
    res.status(500).json({ error: err.message || "Server error creating crypto invoice." });
  }
});

// ── POST /api/user/wallet/verify-heleket ────────────────────────
router.post("/wallet/verify-heleket", loginRequired, async (req, res) => {
  try {
    const { order_id, uuid } = req.body;
    const lookupId = (order_id || uuid || "").trim();
    if (!lookupId) return res.status(400).json({ error: "Order ID or UUID required." });

    let tx = await Transaction.findOne({ reference: lookupId, user_id: String(req.userId), type: "deposit" });
    if (tx && tx.status === "completed") {
      return res.json({ success: true, status: "PAID", message: "Deposit already completed and credited!" });
    }

    const configPath = path.join(__dirname, "..", "payment_config.json");
    if (!fs.existsSync(configPath)) return res.status(400).json({ error: "Payment configuration missing." });
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const hConfig = cfg.heleket || {};

    const info = await heleket.getInvoiceInfo(hConfig, lookupId.startsWith("HEL-") ? { order_id: lookupId } : { uuid: lookupId });
    if (!info) {
      return res.status(400).json({ error: "Could not retrieve status from Heleket gateway right now." });
    }

    if (!tx && info.order_id) tx = await Transaction.findOne({ reference: info.order_id, user_id: String(req.userId), type: "deposit" });
    if (!tx) return res.status(404).json({ error: "Payment order not found" });
    if (heleket.isPaymentPaid(info)) {
      // If paid and webhook hasn't fired or completed it yet, credit it right now!
      if (["pending", "failed"].includes(tx.status)) {
        const credited = await wallet.creditDeposit({ transactionId: tx._id, userId: req.userId,
          config: hConfig, description: `Heleket Crypto Deposit (Ref: ${tx.reference})` });
        return res.json({ success: true, status: "PAID", credited_amount: credited.totalCredit,
          base_amount: credited.base_amount, bonus_amount: credited.bonusAmount });
      } else if (!tx) {
        return res.status(400).json({ error: "Transaction record not found locally." });
      }
      return res.json({ success: true, status: "PAID" });
    }

    return res.status(400).json({ error: `Crypto payment is currently ${info.payment_status || info.status || "PENDING"}. Please complete the payment on Heleket and check again.` });
  } catch (err) {
    if (err.message === "ALREADY_CREDITED") {
      return res.json({ success: true, status: "PAID", message: "Already credited!" });
    }
    console.error("Verify heleket error:", err);
    res.status(500).json({ error: err.message || "Server error verifying payment." });
  }
});

module.exports = router;


