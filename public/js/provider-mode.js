(function (root) {
  // JSON/forms and older database rows can represent the same flag differently.
  // In particular, the strings "false" and "0" must never enable callbacks.
  function parseWebhookEnabled(value) {
    if (typeof value === "string") value = value.trim().toLowerCase();
    if (value === true || value === 1 || value === "true" || value === "1") return true;
    if (value === false || value === 0 || value === "false" || value === "0" || value == null || value === "") return false;
    throw new Error("Invalid OTP delivery mode; choose Polling or Provider webhook");
  }

  function isProviderWebhookEnabled(server) {
    try { return parseWebhookEnabled(server?.otp_webhook_enabled); }
    catch (_) { return false; }
  }

  if (typeof module === "object" && module.exports) module.exports = { parseWebhookEnabled, isProviderWebhookEnabled };
  else root.ProviderMode = { parseWebhookEnabled, isProviderWebhookEnabled };
})(globalThis);
