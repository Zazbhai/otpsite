// Migrate only the money columns; sequelize.sync({alter:true}) is deliberately
// avoided because it may change unrelated production columns and indexes.
async function ensureReferenceSchema(sequelize) {
  const { QueryTypes } = require("sequelize");
  const columns = await sequelize.query(
    "SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Transactions' AND COLUMN_NAME = 'reference'",
    { type: QueryTypes.SELECT });
  if (!columns.length) return; // New installation; the model creates the table.
  if (columns[0].IS_NULLABLE !== 'YES') {
    await sequelize.query('ALTER TABLE `Transactions` MODIFY COLUMN `reference` VARCHAR(255) NULL DEFAULT NULL');
  }
  // Legacy SQL installations used an empty string for optional references.
  // Multiple NULLs are legal under the unique payment-reference index.
  await sequelize.query("UPDATE `Transactions` SET `reference` = NULL WHERE `reference` = ''");
}
async function ensureWalletSchema(sequelize) {
  const { QueryTypes } = require("sequelize");
  const fields = {
    Users: { balance: 'NOT NULL DEFAULT 0', total_spent: 'NOT NULL DEFAULT 0', referral_earnings: 'NOT NULL DEFAULT 0' },
    Orders: { cost: 'NOT NULL' },
    Transactions: { amount: 'NOT NULL', balance_after: 'NOT NULL DEFAULT 0' },
    Services: { price: 'NOT NULL' },
    AccountCategories: { price: 'NOT NULL' },
    ReadymadeAccounts: { price_at_sale: 'NULL DEFAULT NULL' },
    PromoCodes: { amount: 'NOT NULL' },
  };
  const tables = await sequelize.query(
    'SELECT TABLE_NAME, ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()',
    { type: QueryTypes.SELECT });
  for (const table of tables) {
    if (fields[table.TABLE_NAME] && String(table.ENGINE).toLowerCase() !== 'innodb') {
      throw new Error(`Wallet table ${table.TABLE_NAME} must use InnoDB for transactional balance updates`);
    }
  }
  for (const [table, columns] of Object.entries(fields)) {
    const existing = await sequelize.query(
      'SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table',
      { replacements: { table }, type: QueryTypes.SELECT });
    const changes = Object.entries(columns).filter(([name]) => {
      const column = existing.find(c => c.COLUMN_NAME === name);
      return column && column.COLUMN_TYPE.toLowerCase() !== 'decimal(18,4)';
    }).map(([name, suffix]) => `MODIFY COLUMN \`${name}\` DECIMAL(18,4) ${suffix}`);
    if (changes.length) await sequelize.query(`ALTER TABLE \`${table}\` ${changes.join(', ')}`);
  }
}
async function ensureRebuySchema(sequelize) {
  const { QueryTypes } = require("sequelize");
  for (const [table, column, definition] of [["Servers", "api_rebuy_url", "TEXT NULL"], ["Orders", "rebuy_of", "VARCHAR(255) NOT NULL DEFAULT ''"], ["Orders", "rebuy_order_id", "VARCHAR(255) NULL DEFAULT NULL"], ["Orders", "rebuy_cancelled", "TINYINT(1) NOT NULL DEFAULT 0"]]) {
    const columns = await sequelize.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column", { replacements: { table, column }, type: QueryTypes.SELECT });
    if (!columns.length) await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}
module.exports = { ensureWalletSchema, ensureReferenceSchema, ensureRebuySchema };
