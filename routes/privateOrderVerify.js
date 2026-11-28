const express = require("express");
const crypto = require("node:crypto");
const Order = require("../models/Order");

const router = express.Router();

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

  const id = req.query?.order_id ?? req.query?.id ?? req.query?.external_order_id;
  if (typeof id !== "string" || !id.trim() || id.length > 255) {
    return res.status(400).json({ error: "order_id is required" });
  }

  try {
    const value = id.trim();
    const order = await Order.findOne({
      $or: [
        { order_id: value },
        { external_order_id: value },
        { provider_order_id: value },
      ],
    }).select("order_id external_order_id provider_order_id status").lean();

    if (!order) return res.json({ found: false, order_id: value, status: "NOT_FOUND" });
    return res.json({
      found: true,
      order_id: order.provider_order_id || order.external_order_id || order.order_id,
      status: order.status,
    });
  } catch (error) {
    console.error("[Private order verify]", error.message);
    return res.status(500).json({ error: "Could not verify order" });
  }
});

module.exports = router;
