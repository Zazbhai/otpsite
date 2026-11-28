// New orders use the provider activation/dashboard ID in external_order_id and
// provider_order_id. Older rows may only have external_order_id.
function providerOrderId(order) {
  return String(order?.provider_order_id || order?.external_order_id || "").trim();
}

module.exports = { providerOrderId };
