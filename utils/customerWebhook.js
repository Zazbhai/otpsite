const { createHmac } = require("node:crypto");
const dns = require("node:dns").promises;
const https = require("node:https");
const net = require("node:net");
const ipaddr = require("ipaddr.js");

const EVENT = "sms.received";
const TIMEOUT = 10000;

function parseWebhookUrl(value) {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("Enter a public HTTPS URL up to 2,048 characters.");
  }
  let url;
  try { url = new URL(value); }
  catch { throw new Error("Enter a valid public HTTPS URL."); }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      !host.includes(".") || net.isIP(host) || host.endsWith(".") || url.port ||
      /\.(localhost|local|internal|home\.arpa)$/i.test(host)) {
    throw new Error("Enter a public HTTPS URL without a custom port, credentials, or a fragment.");
  }
  return url;
}

function isPublicAddress(address) {
  if (!ipaddr.isValid(address)) return false;
  const ip = ipaddr.process(address);
  if (ip.range() !== "unicast") return false;
  // Limit IPv6 to global unicast addresses and exclude local translation prefixes.
  return ip.kind() === "ipv4" || ip.match(ipaddr.parse("2000::"), 3);
}

function buildSmsPayload(order, message, country = order.country) {
  const sms = String(message).trim();
  const code = sms.match(/\b(?:otp|(?:verification |security )?code)\s*(?:is\s*)?[:=-]?\s*(\d{4,8})\b/i)?.[1]
    || sms.match(/\b\d{4,8}\b/)?.[0]
    || sms;
  const digits = String(order.phone || "").replace(/\D/g, "");
  return {
    event: EVENT,
    orderId: order.order_id,
    service: order.service_name,
    country: country || "",
    number: digits ? "+" + digits : "",
    code,
    message: sms,
    customer: order.customer_ref || null,
    price: Number(order.cost),
    at: new Date().toISOString(),
  };
}

async function deliverWebhook(value, apiKey, payload) {
  if (!value || !apiKey) return { ok: false, error: "Save a URL and generate an API key first." };
  const controller = new AbortController();
  let timer;
  try {
    const url = parseWebhookUrl(value);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Callback timed out."));
      }, TIMEOUT);
    });
    return await Promise.race([timeout, (async () => {
      const addresses = await dns.lookup(url.hostname, { all: true });
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
        return { ok: false, error: "The callback hostname must resolve to public addresses." };
      }
      if (controller.signal.aborted) return { ok: false, error: "Callback timed out." };
      const { address, family } = addresses[0];
      const body = JSON.stringify(payload);
      const signature = createHmac("sha256", apiKey).update(body).digest("hex");
      return new Promise((resolve, reject) => {
        const request = https.request(url, {
          method: "POST",
          signal: controller.signal,
          agent: false,
          // Connect to the verified address while using the original TLS hostname.
          lookup: (_host, options, callback) => options.all
            ? callback(null, [{ address, family }])
            : callback(null, address, family),
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            "X-SmsCandy-Event": EVENT,
            "X-SmsCandy-Signature": signature,
          },
        }, response => {
          const status = response.statusCode;
          // The status is sufficient. Discard the response without buffering its body.
          resolve({ ok: status >= 200 && status < 300, status });
          response.destroy();
        });
        request.once("error", reject);
        request.end(body);
      });
    })()]);
  } catch {
    return { ok: false, error: controller.signal.aborted
      ? "Callback timed out."
      : "Could not connect to the callback over HTTPS." };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { parseWebhookUrl, isPublicAddress, buildSmsPayload, deliverWebhook };
