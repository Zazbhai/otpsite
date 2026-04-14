const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let User;

if (DB_TYPE === "mysql") {
  User = sequelize.define("User", {
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    email: { type: DataTypes.STRING, unique: true, allowNull: false },
    password_hash: { type: DataTypes.STRING, allowNull: false },
    display_name: { type: DataTypes.STRING, defaultValue: "" },
    avatar_color: { type: DataTypes.STRING, defaultValue: "#3b82f6" },
    balance: { type: DataTypes.FLOAT, defaultValue: 0 },
    is_banned: { type: DataTypes.BOOLEAN, defaultValue: false },
    is_admin: { type: DataTypes.BOOLEAN, defaultValue: false },
    total_spent: { type: DataTypes.FLOAT, defaultValue: 0 },
    total_orders: { type: DataTypes.INTEGER, defaultValue: 0 },
    notes: { type: DataTypes.TEXT, defaultValue: "" },
    api_key: { type: DataTypes.STRING, defaultValue: "" },
    _id: {
      type: DataTypes.VIRTUAL,
      get() { return this.id; }
    }
  });

  applyMongooseShims(User);
} else {
  const userSchema = new mongoose.Schema(
    {
      username: { type: String, unique: true, required: true, trim: true, minlength: 3, maxlength: 30 },
      email:    { type: String, unique: true, required: true, lowercase: true, trim: true },
      password_hash: { type: String, required: true },
      display_name:  { type: String, default: "" },
      avatar_color:  { type: String, default: "#3b82f6" }, 
      balance:       { type: Number, default: 0 },
      is_banned:     { type: Boolean, default: false },
      is_admin:      { type: Boolean, default: false },
      total_spent:   { type: Number, default: 0 },
      total_orders:  { type: Number, default: 0 },
      notes:         { type: String, default: "" },
      api_key:       { type: String, default: "" },
    },
    { timestamps: true }
  );
  User = mongoose.model("User", userSchema);
}

module.exports = User;
