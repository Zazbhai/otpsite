const indexes = [
  ["User", "Users", "idx_users_api_key", { api_key: 1 }],
  ["Order", "Orders", "idx_orders_user_external", { user_id: 1, external_order_id: 1, createdAt: -1 }],
  ["Service", "Services", "idx_services_allocation", { service_code: 1, country_code: 1, is_active: 1, price: 1 }],
  ["Order", "Orders", "idx_orders_due_queue", { status: 1, next_check_at: 1, _id: 1 }],
  ["Order", "Orders", "idx_orders_server_provider", { server_id: 1, provider_order_id: 1 }],
];

// Add only the indexes used by authentication, status lookup and allocation.
// Never sync/alter existing columns or replace any index in production.
async function ensureApiQueryIndexes({ DB_TYPE, sequelize, models }) {
  if (DB_TYPE === "mysql") {
    const { QueryTypes } = require("sequelize");
    for (const [, table, name, fields] of indexes) {
      const existing = await sequelize.query("SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND INDEX_NAME = :name", {
        replacements: { table, name }, type: QueryTypes.SELECT,
      });
      if (!existing.length) await sequelize.query(`CREATE INDEX \`${name}\` ON \`${table}\` (${Object.keys(fields).map(field => `\`${field === "_id" ? "id" : field}\``).join(", ")})`);
    }
  } else {
    for (const [model, , name, fields] of indexes) await models[model].collection.createIndex(fields, { name });
  }
}

module.exports = { ensureApiQueryIndexes };
