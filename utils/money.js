// Wallet amounts use four decimal places (including referral commissions).
const SCALE = 10000;
const MAX_AMOUNT = 100000000000;
function money(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") throw new Error("INVALID_AMOUNT");
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > MAX_AMOUNT) throw new Error("INVALID_AMOUNT");
  return Math.round((n + Math.sign(n) * Number.EPSILON) * SCALE) / SCALE;
}
function positiveMoney(value) {
  const n = money(value);
  if (n <= 0) throw new Error("INVALID_AMOUNT");
  return n;
}
function decimalField(DataTypes, name, options = {}) {
  return {
    type: DataTypes.DECIMAL(18, 4), ...options,
    get() {
      const value = this.getDataValue(name);
      return value == null ? value : Number(value);
    },
    set(value) { this.setDataValue(name, value == null && options.defaultValue === null ? null : money(value)); },
  };
}
function roundMongoWalletIncrement(next) {
  const update = this.getUpdate();
  if (!update?.$inc || !Object.keys(update.$inc).some(key => ["balance", "total_spent", "referral_earnings"].includes(key))) return next();
  try {
    if (Object.keys(update).some(key => !["$inc", "$set", "$setOnInsert"].includes(key))) throw new Error("Unsupported wallet update");
    const fields = Object.fromEntries(Object.entries(update.$set || {}).map(([key, value]) => [key, { $literal: value }]));
    for (const [key, value] of Object.entries(update.$inc)) {
      const delta = money(value);
      const addition = { $add: [{ $ifNull: [`$${key}`, 0] }, delta] };
      fields[key] = ["balance", "total_spent", "referral_earnings"].includes(key) ? { $round: [addition, 4] } : addition;
    }
    this.setUpdate([{ $set: fields }]);
    const filter = this.getFilter?.();
    if (filter?.balance?.$gte !== undefined) {
      // Old binary-float balances such as 9.9999999998 still represent 10.0000.
      // Use the same precision for eligibility and the debit itself.
      const minimum = money(filter.balance.$gte);
      delete filter.balance;
      filter.$and = [...(filter.$and || []), { $expr: { $gte: [{ $round: ["$balance", 4] }, minimum] } }];
      this.setQuery(filter);
    }
    next();
  } catch (err) { next(err); }
}
module.exports = { money, positiveMoney, decimalField, roundMongoWalletIncrement };
