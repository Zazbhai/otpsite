const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let PromoCode;

if (DB_TYPE === "mysql") {
  PromoCode = sequelize.define("PromoCode", {
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    amount: { type: DataTypes.FLOAT, allowNull: false },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    usage_limit: { type: DataTypes.INTEGER, defaultValue: 1 },
    used_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    used_by: { 
      type: DataTypes.TEXT, 
      defaultValue: "[]",
      get() {
        const val = this.getDataValue('used_by');
        try { return JSON.parse(val || "[]"); } catch (e) { return []; }
      },
      set(val) {
        this.setDataValue('used_by', JSON.stringify(val || []));
      }
    },
  });

  applyMongooseShims(PromoCode);
} else {
  const promoCodeSchema = new mongoose.Schema(
    {
      code: { type: String, required: true, unique: true, uppercase: true },
      amount: { type: Number, required: true },
      is_active: { type: Boolean, default: true },
      usage_limit: { type: Number, default: 1 }, 
      used_count: { type: Number, default: 0 },
      used_by: { type: [String], default: [] },
    },
    { timestamps: true }
  );
  PromoCode = mongoose.model("PromoCode", promoCodeSchema);
}

module.exports = PromoCode;
