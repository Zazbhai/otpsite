const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let Country;

if (DB_TYPE === "mysql") {
  Country = sequelize.define("Country", {
    code: { type: DataTypes.STRING, unique: true, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    flag: { type: DataTypes.STRING, defaultValue: "🌍" },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
    _id: {
      type: DataTypes.VIRTUAL,
      get() { return String(this.id); }
    }
  }, {
    indexes: [
      { fields: ["sort_order", "name"] }
    ]
  });

  applyMongooseShims(Country);
} else {
  const countrySchema = new mongoose.Schema(
    {
      code: { type: String, unique: true, required: true },
      name: { type: String, required: true },
      flag: { type: String, default: "🌍" },
      is_active: { type: Boolean, default: true },
      sort_order: { type: Number, default: 0 }
    },
    { timestamps: true }
  );
  countrySchema.index({ sort_order: 1, name: 1 });
  Country = mongoose.model("Country", countrySchema);
}

module.exports = Country;
