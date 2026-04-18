const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let Order;

if (DB_TYPE === "mysql") {
  Order = sequelize.define("Order", {
    order_id: { type: DataTypes.STRING, unique: true, allowNull: false },
    user_id: { type: DataTypes.STRING, allowNull: false },
    service_name: { type: DataTypes.STRING, allowNull: false },
    server_name: { type: DataTypes.STRING, defaultValue: "" },
    country: { type: DataTypes.STRING, defaultValue: "" },
    phone: { type: DataTypes.STRING, defaultValue: "" },
    otp: { type: DataTypes.STRING, defaultValue: "" },
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
    cost: { type: DataTypes.FLOAT, allowNull: false },
    expires_at: { type: DataTypes.DATE },
    min_cancel_at: { type: DataTypes.DATE },
    external_order_id: { type: DataTypes.STRING, defaultValue: "" },
    multi_otp_enabled: { type: DataTypes.BOOLEAN, defaultValue: false },
    last_check_at: { type: DataTypes.DATE },
    service_image: { type: DataTypes.STRING, defaultValue: "" },
    service_color: { type: DataTypes.STRING, defaultValue: "" },
    check_interval: { type: DataTypes.INTEGER, defaultValue: 3 },
    _id: {
      type: DataTypes.VIRTUAL,
      get() { return this.id; }
    }
  });

  applyMongooseShims(Order);
} else {
  const orderSchema = new mongoose.Schema(
    {
      order_id:          { type: String, unique: true, required: true },
      user_id:           { type: String, required: true, index: true }, 
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
      multi_otp_enabled: { type: Boolean, default: false },
      last_check_at:     { type: Date },
      service_image:     { type: String, default: "" },
      service_color:     { type: String, default: "" },
      check_interval:    { type: Number, default: 3 },
    },
    { timestamps: true }
  );
  Order = mongoose.model("Order", orderSchema);
}

module.exports = Order;
