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
    for (const [model, , name, fields] of indexes) {
      const collection = models[model].collection;
      let existingIndexes;
      try {
        existingIndexes = await collection.indexes();
      } catch (error) {
        // listIndexes returns NamespaceNotFound before the first index has
        // created a collection. In that case createIndex below will create it.
        if (error.code !== 26 && error.codeName !== "NamespaceNotFound") throw error;
        existingIndexes = [];
      }

      const expectedKey = Object.entries(fields);
      const sameKey = existingIndexes.find(index => {
        const actualKey = Object.entries(index.key || {});
        return actualKey.length === expectedKey.length &&
          actualKey.every(([field, direction], i) =>
            expectedKey[i][0] === field && expectedKey[i][1] === direction);
      });

      if (sameKey) {
        // Mongoose model indexes may already have created this exact key
        // pattern with MongoDB's generated name (for example,
        // server_id_1_provider_order_id_1). Reuse it; MongoDB rejects an
        // identical key pattern when createIndex supplies a different name.
        if (sameKey.unique || sameKey.sparse || sameKey.expireAfterSeconds != null || sameKey.partialFilterExpression) {
          throw new Error(`Existing MongoDB index ${sameKey.name} on ${model} has options incompatible with ${name}`);
        }
        continue;
      }

      const sameName = existingIndexes.find(index => index.name === name);
      if (sameName) {
        throw new Error(`MongoDB index ${name} on ${model} exists with a different key pattern`);
      }

      await collection.createIndex(fields, { name });
    }
  }
}

module.exports = { ensureApiQueryIndexes };
