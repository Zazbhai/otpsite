const express = require("express");
const crypto = require("node:crypto");
const { Buffer } = require("node:buffer");
const Server = require("../models/Server");
const Order = require("../models/Order");
const { recordOrderSms } = require("../utils/orderSms");
const { isProviderWebhookEnabled } = require("../public/js/provider-mode");
const { saveUnmatchedCallback } = require("../utils/providerWebhookQueue");

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

function authenticated(req, server) {
  if (server.otp_webhook_secret && equalSecret(suppliedSecret(req), server.otp_webhook_secret)) return true;
  // SMS Candy signs the exact transmitted JSON with the customer's API key.
  // Also allow a dedicated webhook secret when the sender supports one.
  const signature = String(req.headers["x-smscandy-signature"] || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(signature) || typeof req.rawBody !== "string") return false;
  return [server.otp_webhook_secret, server.api_key].filter(key => typeof key === "string" && key.trim()).some(key =>
    crypto.timingSafeEqual(Buffer.from(signature, "hex"), crypto.createHmac("sha256", key).update(req.rawBody).digest())
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

function publicOrderId(order) {
  return order?.provider_order_id || order?.external_order_id || order?.order_id;
}

router.post("/:server", async (req, res) => {
  const reject = (status, code, error) => {
    // Never log credentials, the request body, or the OTP.
    console.warn("[Provider webhook]", code, { server: req.params.server });
    return res.status(status).json({ error, code });
  };
  try {
    const server = await findServer(req.params.server);
    if (!server || !authenticated(req, server)) return reject(401, "INVALID_WEBHOOK_AUTH", "Invalid webhook credentials or signature");
    if (!server.is_active) return reject(403, "SERVER_DISABLED", "Server is disabled");
    if (!isProviderWebhookEnabled(server)) return reject(403, "WEBHOOK_DISABLED", "Select Provider webhook mode in Admin > Servers and save");

    const body = req.body || {};
    if (!body || typeof body !== "object" || Array.isArray(body)) return reject(400, "INVALID_PAYLOAD", "JSON object payload is required");
    const explicitLocalId = value(body, ["local_order_id"]).slice(0, 255);
    const localId = explicitLocalId || value(body, ["order_id", "orderId", "activation"]).slice(0, 255);
    const providerId = value(body, ["external_order_id", "externalOrderId", "provider_order_id", "providerOrderId", "activation_id", "activationId", "id"]).slice(0, 255);
    const message = value(body, ["otp", "code", "sms", "message", "text"]).slice(0, 4000);
    if (!message || (!localId && !providerId)) return reject(400, "INVALID_PAYLOAD", "Order ID and OTP are required");

    const serverId = String(server._id || server.id || req.params.server);
    // Match this exact provider first. Only fall back to server_name for legacy
    // orders without a saved server ID; names can be reused or changed.
    const serverScope = serverId ? { $or: [
      { server_id: serverId },
      { server_name: String(server.name || ""), server_id: { $in: [null, ""] } },
    ] } : { server_name: String(server.name || "") };
    let order = localId ? await Order.findOne({ ...serverScope, order_id: localId }) : null;
    if (order && providerId && ![order.external_order_id, order.provider_order_id, order.order_id].map(String).includes(providerId)) {
      return reject(409, "ORDER_ID_MISMATCH", "Local and provider order IDs refer to different orders");
    }
    // Providers commonly send their activation ID as order_id or orderId.
    const externalId = providerId || (!explicitLocalId ? localId : "");
    if (!order && externalId) {
      const matches = await Order.find({ $and: [serverScope, { status: "active" }, { $or: [
        { external_order_id: externalId }, { provider_order_id: externalId }, { order_id: externalId },
      ] }] })
        .sort({ createdAt: -1, _id: -1 }).limit(2);
      if (matches.length > 1) return reject(409, "AMBIGUOUS_ORDER", "Ambiguous provider activation ID; send the local_order_id");
      order = matches[0] || null;
      if (!order) {
        // Acknowledge retries of an already stored SMS without reviving a
        // completed/refunded order or crediting/debiting the wallet again.
        const previous = await Order.find({ $and: [serverScope, { status: { $ne: "active" } }, { $or: [
          { external_order_id: externalId }, { provider_order_id: externalId }, { order_id: externalId },
        ] }] })
          .sort({ createdAt: -1, _id: -1 }).limit(1);
        const latest = previous[0];
        // MySQL stores all_otps as JSON text; compare decoded history here.
        if (latest) {
          if (latest.otp === message || latest.all_otps?.includes(message)) {
            // A duplicate of a stored SMS is acknowledged with the order's
            // current state; anything else from a finished order is rejected.
            if (latest.status !== "active") {
              return res.json({ received: true, duplicate: true, order_id: publicOrderId(latest), status: latest.status });
            }
            order = latest;
          }
          else return reject(409, "ORDER_NOT_ACTIVE", "Order is no longer active; OTP was not saved");
        }
      }
    }
    if (!order) {
      await saveUnmatchedCallback(server, externalId || localId, message, body);
      return res.status(202).json({ received: true, queued: true, order_id: externalId || localId });
    }
    if (order.status !== "active") {
      if (order.otp !== message && !order.all_otps?.includes(message)) {
        return reject(409, "ORDER_NOT_ACTIVE", "Order is no longer active; OTP was not saved");
      }
      return res.json({ received: true, duplicate: true, order_id: publicOrderId(order), status: order.status });
    }
    if (Array.isArray(order.rebuy_ignored_otps) && order.rebuy_ignored_otps.includes(message)) {
      return res.json({ received: true, duplicate: true, ignored: true, order_id: order.order_id, status: order.status });
    }

    const providerStatus = String(body.status || body.state || "").toLowerCase();
    const waiting = ["waiting", "pending", "processing"].includes(providerStatus);
    const complete = !order.multi_otp_enabled && !waiting;
    const saved = await recordOrderSms(order, message, { complete, checkedAt: new Date() });
    const current = saved || await Order.findById(order._id);
    if (!current) return reject(404, "ORDER_NOT_FOUND", "Order no longer exists");
    if (!saved && current.otp !== message && !current.all_otps?.includes(message)) {
      return reject(409, "OTP_NOT_SAVED", "Order changed while processing the callback; OTP was not saved");
    }
    console.info("[Provider webhook]", saved ? "OTP_SAVED" : "OTP_DUPLICATE", { server: req.params.server, order: publicOrderId(current) });
    return res.json({ received: true, duplicate: !saved, order_id: publicOrderId(current), status: current.status, otp: current.otp });
  } catch (error) {
    console.error("[Provider webhook]", error.message);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

module.exports = router;
