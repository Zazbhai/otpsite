const express = require("express");
const crypto = require("node:crypto");
const Server = require("../models/Server");
const Order = require("../models/Order");
const { recordOrderSms } = require("../utils/orderSms");

const router = express.Router();

function suppliedSecret(req) {
  const authorization = String(req.headers.authorization || "");
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, "").trim();
  return String(req.headers["x-provider-webhook-secret"] || "").trim();
}

function equalSecret(actual, expected) {
  return crypto.timingSafeEqual(
    crypto.createHash("sha256").update(String(actual)).digest(),
    crypto.createHash("sha256").update(String(expected)).digest(),
  );
}

async function findServer(id) {
  if (!id) return null;
  try {
    const byId = await Server.findById(id);
    if (byId) return byId;
  } catch (_) {}
  return Server.findOne({ $or: [{ name: String(id) }, { slug: String(id) }] });
}

function value(body, keys) {
  for (const key of keys) {
    const candidate = body?.[key];
    if ((typeof candidate === "string" || typeof candidate === "number") && String(candidate).trim()) return String(candidate).trim();
  }
  return "";
}

router.post("/:server", async (req, res) => {
  try {
    const server = await findServer(req.params.server);
    if (!server || !server.is_active || !server.otp_webhook_secret ||
        !equalSecret(suppliedSecret(req), server.otp_webhook_secret)) {
      return res.status(401).json({ error: "Invalid webhook credentials" });
    }

    const body = req.body || {};
    const localId = value(body, ["order_id", "orderId", "local_order_id", "activation"]).slice(0, 255);
    const providerId = value(body, ["external_order_id", "externalOrderId", "provider_order_id", "providerOrderId", "activation_id", "activationId", "id"]).slice(0, 255);
    const message = value(body, ["otp", "code", "sms", "message", "text"]).slice(0, 4000);
    if (!message || (!localId && !providerId)) return res.status(400).json({ error: "Order ID and OTP are required" });

    let order = localId ? await Order.findOne({ order_id: localId, server_name: server.name }) : null;
    if (!order && providerId) {
      const matches = await Order.find({ external_order_id: providerId, server_name: server.name, status: "active" })
        .sort({ createdAt: -1, _id: -1 }).limit(2);
      if (matches.length > 1) return res.status(409).json({ error: "Ambiguous provider activation ID; send the local order_id" });
      order = matches[0] || null;
    }
    if (!order) return res.status(404).json({ error: "Active order not found" });
    if (order.status !== "active") return res.json({ received: true, duplicate: true, order_id: order.order_id, status: order.status });
    if (Array.isArray(order.rebuy_ignored_otps) && order.rebuy_ignored_otps.includes(message)) {
      return res.json({ received: true, duplicate: true, ignored: true, order_id: order.order_id, status: order.status });
    }

    const providerStatus = String(body.status || body.state || "").toLowerCase();
    const complete = !order.multi_otp_enabled && ["completed", "complete", "success", "successful"].includes(providerStatus);
    const saved = await recordOrderSms(order, message, { complete, checkedAt: new Date() });
    const current = saved || await Order.findById(order._id);
    return res.json({ received: true, duplicate: !saved, order_id: current.order_id, status: current.status, otp: current.otp });
  } catch (error) {
    console.error("[Provider webhook]", error.message);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

module.exports = router;
