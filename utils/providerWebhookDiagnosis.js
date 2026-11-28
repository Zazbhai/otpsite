// Read-only lookup: no provider calls, order mutations, or wallet adjustments.
const { isProviderWebhookEnabled } = require("../public/js/provider-mode");
async function diagnoseProviderWebhook({ Server, Order, Transaction, Service, dbType }, serverId, suppliedIds) {
  const server = await Server.findById(serverId);
  if (!server) return { error: "SERVER_NOT_FOUND" };
  const results = [];
  for (const id of [...new Set(suppliedIds)]) {
    const alternatives = [{ external_order_id: id }, { order_id: id }];
    if (dbType === "mysql" ? /^[1-9]\d*$/.test(id) : /^[a-f\d]{24}$/i.test(id)) alternatives.push({ _id: id });
    const rows = await Order.find({ $or: alternatives })
      .select("_id order_id external_order_id server_name service_id status createdAt").limit(10);
    const matches = [];
    for (const order of rows) {
      const service = order.service_id ? await Service.findById(order.service_id) : null;
      const purchases = await Transaction.find({ order_id: order.order_id, type: "purchase" })
        .select("status reference").limit(5);
      matches.push({
        local_order_id: order.order_id, external_order_id: order.external_order_id,
        database_id: String(order._id || order.id), server_name: order.server_name,
        status: order.status, created_at: order.createdAt,
        matches_by: [order.external_order_id === id && "external_order_id", order.order_id === id && "order_id",
          String(order._id || order.id) === id && "database_id"].filter(Boolean),
        server_name_matches: order.server_name === server.name,
        service_server_matches: service ? String(service.server_id?._id || service.server_id) === String(server._id || server.id) : null,
        purchase_statuses: purchases.map(tx => tx.status),
      });
    }
    results.push({ supplied_id: id, matches, diagnosis: !matches.length ? "NO_SAVED_ORDER_FOR_THIS_ID"
      : matches.some(row => row.server_name_matches && row.status === "active" && row.matches_by.includes("external_order_id"))
        ? "ACTIVE_EXTERNAL_ORDER_MATCH"
        : matches.some(row => row.service_server_matches && !row.server_name_matches)
          ? "POSSIBLE_SERVER_RENAME" : "CHECK_MATCH_FIELDS_SERVER_AND_STATUS" });
  }
  return { server: { id: String(server._id || server.id), name: server.name,
    active: Boolean(server.is_active), webhook_enabled: isProviderWebhookEnabled(server) }, results };
}

function diagnoseProviderLog(text, ids) {
  const results = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("getNumber |") || !line.includes(" | RESP=")) continue;
    const raw = line.slice(line.indexOf(" | RESP=") + 8).trim();
    let fields = {};
    if (raw.startsWith("ACCESS_NUMBER:")) fields = { text_order_id: raw.split(":")[1] };
    else {
      try {
        const payload = JSON.parse(raw);
        for (const container of [payload, payload.data, payload.order]) {
          for (const key of ["id", "order_id", "orderId", "external_order_id", "activation_id", "activationId"]) {
            if (["string", "number"].includes(typeof container?.[key])) fields[key] = String(container[key]);
          }
        }
      } catch (_) { continue; }
    }
    const matchingIds = ids.filter(id => Object.values(fields).includes(id));
    if (matchingIds.length) results.push({ matched_ids: matchingIds, allocation_ids: fields });
  }
  return results;
}

module.exports = { diagnoseProviderWebhook, diagnoseProviderLog };
