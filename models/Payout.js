const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let Payout;

if (DB_TYPE === "mysql") {
  Payout = sequelize.define("Payout", {
    order_no: { type: DataTypes.STRING, allowNull: false, unique: true },
    trade_no: { type: DataTypes.STRING, defaultValue: "" },
    gateway: { type: DataTypes.STRING, defaultValue: "omnipay" },
    amount: { type: DataTypes.FLOAT, allowNull: false },
    account_name: { type: DataTypes.STRING, allowNull: false },
    account_number: { type: DataTypes.STRING, allowNull: false },
    ifsc: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, defaultValue: "PENDING" }, // PENDING, PROCESSING, SUCCESS, FAILED
    utr: { type: DataTypes.STRING, defaultValue: "" },
    remark: { type: DataTypes.STRING, defaultValue: "" },
    raw_response: { type: DataTypes.TEXT, defaultValue: "{}" }
  });

  applyMongooseShims(Payout);
} else {
  const payoutSchema = new mongoose.Schema(
    {
      order_no: { type: String, required: true, unique: true },
      trade_no: { type: String, default: "" },
      gateway: { type: String, default: "omnipay" },
      amount: { type: Number, required: true },
      account_name: { type: String, required: true },
      account_number: { type: String, required: true },
      ifsc: { type: String, required: true, uppercase: true },
      status: { type: String, default: "PENDING" }, // PENDING, PROCESSING, SUCCESS, FAILED
      utr: { type: String, default: "" },
      remark: { type: String, default: "" },
      raw_response: { type: mongoose.Schema.Types.Mixed, default: {} }
    },
    { timestamps: true }
  );
  Payout = mongoose.model("Payout", payoutSchema);
}

module.exports = Payout;
