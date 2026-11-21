const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { DB_TYPE, sequelize } = require("../utils/db");

const UserWebhook = DB_TYPE === "mysql"
  ? sequelize.define("UserWebhook", {
      user_id: { type: DataTypes.STRING, primaryKey: true },
      url: { type: DataTypes.TEXT, allowNull: false },
    })
  : mongoose.model("UserWebhook", new mongoose.Schema({
      user_id: { type: String, required: true, unique: true },
      url: { type: String, required: true },
    }, { timestamps: true }));

module.exports = UserWebhook;
