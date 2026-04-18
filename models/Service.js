const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let Service;

if (DB_TYPE === "mysql") {
  Service = sequelize.define("Service", {
    name: { type: DataTypes.STRING, allowNull: false },
    server_id: { type: DataTypes.STRING }, // Store ID as string for compatibility
    service_code: { type: DataTypes.STRING, allowNull: false },
    country_code: { type: DataTypes.STRING, allowNull: false },
    price: { type: DataTypes.FLOAT, allowNull: false },
    image_url: { type: DataTypes.STRING, defaultValue: "" },
    icon_color: { type: DataTypes.STRING, defaultValue: "" },
    success_rate: { type: DataTypes.STRING, defaultValue: "95%" },
    avg_time: { type: DataTypes.STRING, defaultValue: "2m" },
    check_interval: { type: DataTypes.INTEGER, defaultValue: 3 },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    is_auto: { type: DataTypes.BOOLEAN, defaultValue: false },
    _id: {
      type: DataTypes.VIRTUAL,
      get() { return String(this.id); }
    }
  });

  applyMongooseShims(Service);
} else {
  const serviceSchema = new mongoose.Schema(
    {
      name: { type: String, required: true },
      server_id: { type: mongoose.Schema.Types.ObjectId, ref: "Server" },
      service_code: { type: String, required: true },
      country_code: { type: String, required: true },
      price: { type: Number, required: true },
      image_url: { type: String, default: "" },
      icon_color: { type: String, default: "" },
      success_rate: { type: String, default: "95%" },
      avg_time: { type: String, default: "2m" },
      check_interval: { type: Number, default: 3 },
      is_active: { type: Boolean, default: true },
      is_auto: { type: Boolean, default: false }
    },
    { timestamps: true }
  );
  serviceSchema.index({ service_code: 1, country_code: 1, is_active: 1 });
  serviceSchema.index({ server_id: 1 });
  Service = mongoose.model("Service", serviceSchema);
}

module.exports = Service;
