const express = require("express");
const router  = express.Router();
const mongoose = require("mongoose");
const { loginRequired } = require("../middleware/auth");
const User        = require("../models/User");
const Order       = require("../models/Order");
const Service     = require("../models/Service");
const Server      = require("../models/Server");
const Transaction = require("../models/Transaction");
const Country     = require("../models/Country");
const providerApi = require("../utils/providerApi");
const { nanoid }  = require("nanoid");

// ── GET /api/user/countries (public for buy page) ─────────────────
router.get("/countries", async (req, res) => {
  try {
    const countries = await Country.find({ is_active: true }).sort({ sort_order: 1, name: 1 });
    res.json(countries);
  } catch (err) { res.status(500).json({ error: "Server error" }); }
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
      const orderObj = order.toObject();
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
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// ── GET /api/user/services ───────────────────────────────────────
router.get("/services", async (req, res) => {
  try {
    const services = await Service.find({ is_active: true })
      .populate({
        path: "server_id",
        select: "name country_id"
      })
      .select("-__v");
    res.json(services);
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// ── POST /api/user/orders  (buy) ─────────────────────────────────
router.post("/orders", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { service_id } = req.body;
    if (!service_id) {
      await session.abortTransaction();
      return res.status(400).json({ error: "service_id is required" });
    }

    const service = await Service.findById(service_id).session(session);
    if (!service || !service.is_active) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Service not found or inactive" });
    }

    const serverConf = await Server.findById(service.server_id).session(session);
    if (!serverConf) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Server not configured" });
    }

    const user = await User.findById(req.userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ error: "User not found" });
    }

    const newBalance = parseFloat((user.balance - service.price).toFixed(4));
    if (newBalance < 0) {
      await session.abortTransaction();
      return res.status(402).json({ error: "Insufficient balance" });
    }

    const providerRes = await providerApi.getNumber(serverConf, service.service_code, service.country_code);
    if (providerRes.error) {
      await session.abortTransaction();
      console.error("\n====================================");
      console.error("❌ PROVIDER API REJECTION ❌");
      console.error("TARGET URL:", providerRes.url || "Unknown URL");
      console.error("ERROR TYPE:", providerRes.error);
      console.error("DETAILS:", providerRes.details);
      console.error("====================================\n");
      return res.status(502).json({ error: `Provider API Rejected Request.\n\nTARGET URL: ${providerRes.url || 'Unknown'}\n\nREASON: ${providerRes.error}\nDETAILS: ${JSON.stringify(providerRes.details||{})}` });
    }

    user.balance      = newBalance;
    user.total_spent  = parseFloat((user.total_spent + service.price).toFixed(4));
    user.total_orders += 1;
    await user.save({ session });

    const orderId   = "ORD-" + nanoid(10).toUpperCase();
    const cancelMinutes = serverConf.auto_cancel_minutes || 20;
    const expiresAt = new Date(Date.now() + cancelMinutes * 60 * 1000);
    const minCancelMinutes = serverConf.min_cancel_minutes || 0;
    const minCancelAt = new Date(Date.now() + minCancelMinutes * 60 * 1000);

    const order = await Order.create([{
      order_id:          orderId,
      user_id:           req.userId,
      service_name:      service.name,
      server_name:       serverConf.name,
      country:           service.country_code,
      phone:             providerRes.phone,
      external_order_id: providerRes.api_order_id,
      cost:              service.price,
      status:            "active",
      expires_at:        expiresAt,
      min_cancel_at:     minCancelAt,
      multi_otp_enabled: serverConf.multi_otp_supported || false
    }], { session });

    await Transaction.create([{
      user_id:      req.userId,
      type:         "purchase",
      amount:       -service.price,
      balance_after: user.balance,
      description:  `Purchased ${service.name} (${service.country_code})`,
      order_id:     orderId,
    }], { session });

    await session.commitTransaction();
    res.json({ order: order[0] });
  } catch (err) {
    await session.abortTransaction();
    console.error("Order error:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    session.endSession();
  }
});

// ── GET /api/user/orders ─────────────────────────────────────────
router.get("/orders", async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { user_id: req.userId };
    if (status && status !== "all") filter.status = status;

    const total  = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ orders, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// ── GET /api/user/orders/:id ─────────────────────────────────────
router.get("/orders/:id", async (req, res) => {
  try {
    const order = await Order.findOne({ order_id: req.params.id, user_id: req.userId });
    if (!order) return res.status(404).json({ error: "Order not found" });

    const serverConf = await Server.findOne({ name: order.server_name }).populate('country_id', 'name');
    
    // Polling OTP logic if order is active with throttling (min 3s between checks)
    if (order.status === "active" && order.external_order_id) {
      const now = new Date();
      const lastCheck = order.last_check_at || new Date(0);
      
      if (now - lastCheck >= 3000) {
        if (serverConf && serverConf.api_check_status_url) {
          order.last_check_at = now;
          const checkRes = await providerApi.checkStatus(serverConf, order.external_order_id);
          if (!checkRes.error && checkRes.status !== "waiting") {
            if (order.multi_otp_enabled && checkRes.status === "completed") {
              // Stay active for multi-OTP
              order.status = "active";
              if (checkRes.otp && !order.all_otps.includes(checkRes.otp)) {
                order.otp = checkRes.otp;
                order.all_otps.push(checkRes.otp);
                // Auto-calling next OTP if newly received (background)
                providerApi.retryOrder(serverConf, order.external_order_id).catch(() => {});
              }
            } else {
              order.status = checkRes.status;
              if (checkRes.otp) {
                order.otp = checkRes.otp;
                if (!order.all_otps.includes(checkRes.otp)) order.all_otps.push(checkRes.otp);
              }
            }
            await order.save();
          }
        }
      }
    }

    // Auto cancel if expired and still active
    if (order.status === "active" && order.expires_at && order.expires_at < new Date()) {
      order.status = "expired";
      const user = await User.findById(req.userId);
      if (user) {
        user.balance = parseFloat((user.balance + order.cost).toFixed(4));
        await user.save();
        await Transaction.create({
          user_id: user._id, type: "refund", amount: order.cost,
          balance_after: user.balance, description: `Refund expired order ${order.order_id}`, order_id: order.order_id
        });
      }
      await order.save();
    }

    const finalOrder = order.toObject();
    finalOrder.server_country = serverConf?.country_id?.name || order.country;
    res.json(finalOrder);
  } catch (err) { 
    console.error("Order fetch error:", err);
    res.status(500).json({ error: "Server error" }); 
  }
});

// ── POST /api/user/orders/:id/cancel ─────────────────────────────
router.post("/orders/:id/cancel", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findOne({ order_id: req.params.id, user_id: req.userId }).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Order not found" });
    }
    if (order.status !== "active") {
      await session.abortTransaction();
      return res.status(400).json({ error: "Order cannot be cancelled" });
    }

    if (order.external_order_id) {
      const serverConf = await Server.findOne({ name: order.server_name }).session(session);
      if (serverConf && serverConf.api_cancel_url) {
        await providerApi.cancelOrder(serverConf, order.external_order_id);
      }
    }

    const user = await User.findById(req.userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ error: "User not found" });
    }

    user.balance = parseFloat((user.balance + order.cost).toFixed(4));
    await user.save({ session });

    await Transaction.create([{
        user_id: user._id, type: "refund", amount: order.cost,
        balance_after: user.balance, description: `User cancelled order ${order.order_id}`, order_id: order.order_id
    }], { session });

    order.status = "cancelled";
    await order.save({ session });

    await session.commitTransaction();
    res.json({ success: true, order });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: "Server error" });
  } finally {
    session.endSession();
  }
});

// ── POST /api/user/orders/:id/retry ──────────────────────────────
router.post("/orders/:id/retry", async (req, res) => {
  try {
    const order = await Order.findOne({ order_id: req.params.id, user_id: req.userId });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "completed") return res.status(400).json({ error: "Can only request next SMS for completed orders" });

    // Request Next SMS from provider
    if (order.external_order_id) {
      const serverConf = await Server.findOne({ name: order.server_name });
      if (serverConf) {
        const retryRes = await providerApi.retryOrder(serverConf, order.external_order_id);
        if (retryRes.error) return res.status(400).json({ error: retryRes.error });
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
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});


// ── GET /api/user/wallet ─────────────────────────────────────────
router.get("/wallet", async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const user  = await User.findById(req.userId);
    const total = await Transaction.countDocuments({ user_id: req.userId });
    const transactions = await Transaction.find({ user_id: req.userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      balance:      user?.balance || 0,
      transactions,
      total,
      page:  parseInt(page),
      pages: Math.ceil(total / limit),
    });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

module.exports = router;
