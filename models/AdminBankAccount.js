const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let AdminBankAccount;

if (DB_TYPE === "mysql") {
  AdminBankAccount = sequelize.define("AdminBankAccount", {
    account_name: { type: DataTypes.STRING, allowNull: false },
    account_number: { type: DataTypes.STRING, allowNull: false },
    ifsc: { type: DataTypes.STRING, allowNull: false },
    bank_name: { type: DataTypes.STRING, defaultValue: "" },
    is_default: { type: DataTypes.BOOLEAN, defaultValue: false }
  });

  applyMongooseShims(AdminBankAccount);
} else {
  const adminBankAccountSchema = new mongoose.Schema(
    {
      account_name: { type: String, required: true },
      account_number: { type: String, required: true },
      ifsc: { type: String, required: true, uppercase: true },
      bank_name: { type: String, default: "" },
      is_default: { type: Boolean, default: false }
    },
    { timestamps: true }
  );
  AdminBankAccount = mongoose.model("AdminBankAccount", adminBankAccountSchema);
}

module.exports = AdminBankAccount;
