const INPUT_FIELDS = ["event", "order_id", "orderId", "local_order_id", "activation", "external_order_id",
  "externalOrderId", "provider_order_id", "providerOrderId", "activation_id", "activationId", "id",
  "otp", "code", "sms", "message", "text", "status", "state"];
const OUTPUT_FIELDS = ["received", "duplicate", "ignored", "order_id", "status", "otp", "error", "code"];

function selectFields(value, fields) {
  const result = {};
  for (const field of fields) {
    const item = value?.[field];
    if (["string", "number", "boolean"].includes(typeof item)) {
      result[field] = typeof item === "string" ? item.slice(0, 4000) : item;
    }
  }
  return result;
}

function logProviderWebhook(req, res, next) {
  if (!/^\/api\/provider\/webhook\/[^/]+\/?$/i.test(req.path)) return next();
  const started = Date.now();
  let response;
  const json = res.json;
  res.json = function (body) {
    response = selectFields(body, OUTPUT_FIELDS);
    return json.call(this, body);
  };
  res.once("finish", () => {
    console.info("[Provider webhook]", JSON.stringify({
      method: req.method, path: req.path, http_status: res.statusCode,
      duration_ms: Date.now() - started,
      data: selectFields(req.body, INPUT_FIELDS), response: response || {},
    }));
  });
  next();
}

module.exports = { logProviderWebhook };
