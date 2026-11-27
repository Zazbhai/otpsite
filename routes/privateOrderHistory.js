const express = require("express");
const crypto = require("node:crypto");
const Order = require("../models/Order");

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;

function dateStart(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000+05:30`);
  if (!Number.isFinite(date.getTime())) return null;
  const normalized = new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10);
  return normalized === value ? date : null;
}

function keyMatches(supplied, expected) {
  if (typeof supplied !== "string" || !expected || expected.length < 32) return false;
  const left = crypto.createHash("sha256").update(supplied).digest();
  const right = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(left, right);
}

router.get("/", async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");

  if (!keyMatches(req.query?.key, process.env.ORDER_HISTORY_SECRET)) {
    return res.status(process.env.ORDER_HISTORY_SECRET ? 401 : 503).json({ error: "Unavailable" });
  }

  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 ||
      !Number.isSafeInteger((page - 1) * Math.min(limit, 500))) {
    return res.status(400).json({ error: "Invalid pagination" });
  }

  const fromValue = req.query.date || req.query.from;
  const toValue = req.query.date || req.query.to;
  const from = fromValue === undefined ? null : dateStart(fromValue);
  const to = toValue === undefined ? null : dateStart(toValue);
  if ((fromValue !== undefined && !from) || (toValue !== undefined && !to)) {
    return res.status(400).json({ error: "Use valid India Standard Time dates in YYYY-MM-DD format" });
  }
  if (from && to && from > to) return res.status(400).json({ error: "from must be on or before to" });

  const filter = {};
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lt = new Date(to.getTime() + DAY_MS);
  }
  const pageSize = Math.min(limit, 500);

  try {
    const [total, orders] = await Promise.all([
      Order.countDocuments(filter),
      Order.find(filter).select("order_id external_order_id status").sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize).limit(pageSize).lean(),
    ]);
    const publicOrders = orders.map(order => ({ order_id: order.external_order_id || order.order_id, status: order.status }));
    return res.json({ orders: publicOrders, total, page, limit: pageSize, pages: Math.ceil(total / pageSize) });
  } catch (error) {
    console.error("[Private order history]", error.message);
    return res.status(500).json({ error: "Could not load order history" });
  }
});

module.exports = router;
