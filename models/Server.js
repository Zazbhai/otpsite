const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let Server;

if (DB_TYPE === "mysql") {
  Server = sequelize.define("Server", {
    name: { type: DataTypes.STRING, allowNull: false },
    slug: { type: DataTypes.STRING },
    country_id_attr: { type: DataTypes.INTEGER, field: 'country_id' }, // Store ID for compatibility
    api_key: { type: DataTypes.STRING, defaultValue: "" },
    api_get_number_url: { type: DataTypes.STRING, defaultValue: "" },
    api_check_status_url: { type: DataTypes.STRING, defaultValue: "" },
    api_cancel_url: { type: DataTypes.STRING, defaultValue: "" },
    api_retry_url: { type: DataTypes.STRING, defaultValue: "" },
    auto_cancel_minutes: { type: DataTypes.INTEGER, defaultValue: 20 },
    retry_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    min_cancel_minutes: { type: DataTypes.INTEGER, defaultValue: 0 },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    multi_otp_supported: { type: DataTypes.BOOLEAN, defaultValue: false },
    check_interval: { type: DataTypes.INTEGER, defaultValue: 3 },
    auto_add_services: { type: DataTypes.BOOLEAN, defaultValue: false },
    extra_profit: { type: DataTypes.FLOAT, defaultValue: 0 },
    _id: {
      type: DataTypes.VIRTUAL,
      get() { return String(this.id); }
    },
    country_id: {
      type: DataTypes.VIRTUAL,
      get() { return this.country_id_attr; },
      set(val) { this.setDataValue('country_id_attr', val); }
    }
  }, {
    hooks: {
      beforeSave: (server) => {
        if (!server.slug && server.name) {
          server.slug = server.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        }
      }
    }
  });

  applyMongooseShims(Server);

  Server.associate = (models) => {
    Server.belongsTo(models.Country, { foreignKey: 'country_id_attr', as: 'country' });
  };
} else {
  const serverSchema = new mongoose.Schema(
    {
      name: { type: String, required: true },
      slug: { type: String },
      country_id: { type: mongoose.Schema.Types.ObjectId, ref: "Country" },
      api_key: { type: String, default: "" },
      api_get_number_url: { type: String, default: "" },
      api_check_status_url: { type: String, default: "" },
      api_cancel_url: { type: String, default: "" },
      api_retry_url: { type: String, default: "" },
      auto_cancel_minutes: { type: Number, default: 20 },
      retry_count: { type: Number, default: 0 },
      min_cancel_minutes: { type: Number, default: 0 },
      is_active: { type: Boolean, default: true },
      multi_otp_supported: { type: Boolean, default: false },
      check_interval: { type: Number, default: 3 },
      auto_add_services: { type: Boolean, default: false },
      extra_profit: { type: Number, default: 0 }
    },
    { timestamps: true }
  );

  serverSchema.pre("save", function (next) {
    if (!this.slug && this.name) {
      this.slug = this.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    }
    next();
  });

  Server = mongoose.model("Server", serverSchema);
}

module.exports = Server;
