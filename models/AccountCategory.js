const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let AccountCategory;

if (DB_TYPE === "mysql") {
  AccountCategory = sequelize.define("AccountCategory", {
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, defaultValue: "" },
    icon: { type: DataTypes.STRING, defaultValue: "🗂️" },
    price: { type: DataTypes.FLOAT, allowNull: false },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
    _id: {
      type: DataTypes.VIRTUAL,
      get() { return this.id; }
    }
  });

  applyMongooseShims(AccountCategory);
} else {
  const accountCategorySchema = new mongoose.Schema(
    {
      name:        { type: String, required: true, trim: true },
      description: { type: String, default: "" },
      icon:        { type: String, default: "🗂️" }, 
      price:       { type: Number, required: true, min: 0 },
      is_active:   { type: Boolean, default: true },
      sort_order:  { type: Number, default: 0 },
    },
    { timestamps: true }
  );
  AccountCategory = mongoose.model("AccountCategory", accountCategorySchema);
}

module.exports = AccountCategory;
