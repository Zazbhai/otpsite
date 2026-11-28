// New orders keep the client/API reference in external_order_id and the
// provider activation/dashboard reference separately. Older rows only have
// external_order_id, which remains the provider reference for compatibility.
function providerOrderId(order) {
  return String(order?.provider_order_id || order?.external_order_id || "").trim();
}

module.exports = { providerOrderId };
