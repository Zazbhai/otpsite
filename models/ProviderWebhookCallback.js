const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let ProviderWebhookCallback;
if (DB_TYPE === "mysql") {
  ProviderWebhookCallback = sequelize.define("ProviderWebhookCallback", {
    dedupe_key: { type: DataTypes.STRING(128), unique: true, allowNull: false },
    server_id: { type: DataTypes.STRING, allowNull: false },
    server_name: { type: DataTypes.STRING, defaultValue: "" },
    external_order_id: { type: DataTypes.STRING, allowNull: false },
    otp: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.STRING, defaultValue: "" },
    payload: { type: DataTypes.TEXT, defaultValue: "{}" },
    state: { type: DataTypes.ENUM("pending", "matched"), defaultValue: "pending" },
    matched_order_id: { type: DataTypes.STRING, defaultValue: "" },
    attempts: { type: DataTypes.INTEGER, defaultValue: 0 },
    matched_at: { type: DataTypes.DATE, allowNull: true },
  }, { indexes: [
    { fields: ["server_id", "external_order_id", "state"] },
    { fields: ["createdAt"] },
  ] });
  applyMongooseShims(ProviderWebhookCallback);
} else {
  const schema = new mongoose.Schema({
    dedupe_key: { type: String, required: true, unique: true },
    server_id: { type: String, required: true },
    server_name: { type: String, default: "" },
    external_order_id: { type: String, required: true },
    otp: { type: String, required: true },
    status: { type: String, default: "" },
    payload: { type: String, default: "{}" },
    state: { type: String, enum: ["pending", "matched"], default: "pending" },
    matched_order_id: { type: String, default: "" },
    attempts: { type: Number, default: 0 },
    matched_at: { type: Date, default: null },
  }, { timestamps: true });
  schema.index({ server_id: 1, external_order_id: 1, state: 1 });
  schema.index({ createdAt: 1 });
  ProviderWebhookCallback = mongoose.model("ProviderWebhookCallback", schema);
}

module.exports = ProviderWebhookCallback;
