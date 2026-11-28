const { decimalField } = require("../utils/money");
const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let Order;

if (DB_TYPE === "mysql") {
  Order = sequelize.define("Order", {
    order_id: { type: DataTypes.STRING, unique: true, allowNull: false },
    user_id: { type: DataTypes.STRING, allowNull: false },
    service_id: { type: DataTypes.STRING, defaultValue: "" },
    service_name: { type: DataTypes.STRING, allowNull: false },
    server_name: { type: DataTypes.STRING, defaultValue: "" },
    country: { type: DataTypes.STRING, defaultValue: "" },
    phone: { type: DataTypes.STRING, defaultValue: "" },
    otp: { type: DataTypes.TEXT, defaultValue: "" },
    all_otps: { 
      type: DataTypes.TEXT, 
      defaultValue: "[]",
      get() {
        const val = this.getDataValue('all_otps');
        try { return JSON.parse(val || "[]"); } catch (e) { return []; }
      },
      set(val) {
        this.setDataValue('all_otps', JSON.stringify(val || []));
      }
    },
    status: {
      type: DataTypes.ENUM("active", "completed", "refunded", "expired", "cancelled"),
      defaultValue: "active",
    },
    cost: decimalField(DataTypes, "cost", { allowNull: false }),
    expires_at: { type: DataTypes.DATE },
    min_cancel_at: { type: DataTypes.DATE },
    external_order_id: { type: DataTypes.STRING, defaultValue: "" },
    rebuy_of: { type: DataTypes.STRING, defaultValue: "" },
    rebuy_order_id: { type: DataTypes.STRING, defaultValue: "" },
    rebuy_cancelled: { type: DataTypes.BOOLEAN, defaultValue: false },
    rebuy_ignored_otps: {
      type: DataTypes.TEXT, defaultValue: "[]",
      get() { try { return JSON.parse(this.getDataValue("rebuy_ignored_otps") || "[]"); } catch { return []; } },
      set(value) { this.setDataValue("rebuy_ignored_otps", JSON.stringify(value || [])); },
    },
    multi_otp_enabled: { type: DataTypes.BOOLEAN, defaultValue: false },
    refund_issued: { type: DataTypes.BOOLEAN, defaultValue: false },
    last_check_at: { type: DataTypes.DATE },
    next_check_at: { type: DataTypes.DATE },
    service_image: { type: DataTypes.STRING, defaultValue: "" },
    service_color: { type: DataTypes.STRING, defaultValue: "" },
    check_interval: { type: DataTypes.INTEGER, defaultValue: 3 },
    verification_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    _id: {
      type: DataTypes.VIRTUAL,
      get() { return String(this.id); }
    }
  }, {
    indexes: [
      { name: "idx_orders_user_external", fields: ["user_id", "external_order_id", "createdAt"] },
      { fields: ['status'] },
      { fields: ['user_id'] },
      { fields: ['user_id', 'createdAt', 'id'] },
      { fields: ['last_check_at'] },
      { fields: ['status', 'next_check_at'] },
      { name: "idx_orders_due_queue", fields: ["status", "next_check_at", "id"] },
      { fields: ['createdAt'] },
      { fields: ['order_id'], unique: true },
      { fields: ['server_name', 'external_order_id'] }
    ]
  });

  applyMongooseShims(Order);
} else {
  const orderSchema = new mongoose.Schema(
    {
      order_id:          { type: String, unique: true, required: true },
      user_id:           { type: String, required: true, index: true }, 
      service_id:        { type: String, default: "" },
      service_name:      { type: String, required: true },
      server_name:       { type: String, default: "" },
      country:           { type: String, default: "" },
      phone:             { type: String, default: "" },
      otp:               { type: String, default: "" },
      all_otps:          [{ type: String }],
      status: {
        type: String,
        enum: ["active", "completed", "refunded", "expired", "cancelled"],
        default: "active",
      },
      cost:              { type: Number, required: true },
      expires_at:        { type: Date },
      min_cancel_at:     { type: Date },
      external_order_id: { type: String, default: "" },
      rebuy_of: { type: String, default: "" },
      rebuy_order_id: { type: String, default: "" },
      rebuy_cancelled: { type: Boolean, default: false },
      rebuy_ignored_otps: { type: [String], default: [] },
      multi_otp_enabled: { type: Boolean, default: false },
      refund_issued:     { type: Boolean, default: false },
      last_check_at:     { type: Date },
      next_check_at:     { type: Date },
      service_image:     { type: String, default: "" },
      service_color:     { type: String, default: "" },
      check_interval:    { type: Number, default: 3 },
      verification_count: { type: Number, default: 0 },
    },
    { timestamps: true }
  );
  orderSchema.index({ server_name: 1, external_order_id: 1 });
  orderSchema.index({ user_id: 1, external_order_id: 1, createdAt: -1 }, { name: "idx_orders_user_external" });
  orderSchema.index({ user_id: 1, createdAt: -1, _id: -1 });
  orderSchema.index({ status: 1, next_check_at: 1 });
  orderSchema.index({ status: 1, next_check_at: 1, _id: 1 }, { name: "idx_orders_due_queue" });
  Order = mongoose.model("Order", orderSchema);
}

module.exports = Order;
