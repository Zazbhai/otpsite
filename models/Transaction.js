const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let Transaction;

if (DB_TYPE === "mysql") {
  Transaction = sequelize.define("Transaction", {
    user_id: { type: DataTypes.STRING, allowNull: false },
    type: {
      type: DataTypes.ENUM("deposit", "purchase", "refund", "bonus", "deduction"),
      allowNull: false,
    },
    amount: { type: DataTypes.FLOAT, allowNull: false },
    balance_after: { type: DataTypes.FLOAT, defaultValue: 0 },
    description: { type: DataTypes.STRING, defaultValue: "" },
    reference: { type: DataTypes.STRING, defaultValue: "" },
    order_id: { type: DataTypes.STRING, defaultValue: "" },
    status: {
      type: DataTypes.ENUM("pending", "completed", "failed"),
      defaultValue: "completed",
    },
    _id: {
      type: DataTypes.VIRTUAL,
      get() { return this.id; }
    }
  }, {
    indexes: [
      { fields: ["user_id"] }
    ]
  });

  applyMongooseShims(Transaction);
} else {
  const transactionSchema = new mongoose.Schema(
    {
      user_id:       { type: String, required: true, index: true }, 
      type: {
        type: String,
        enum: ["deposit", "purchase", "refund", "bonus", "deduction"],
        required: true,
      },
      amount:        { type: Number, required: true },
      balance_after: { type: Number, default: 0 },
      description:   { type: String, default: "" },
      reference:     { type: String, default: "" },
      order_id:      { type: String, default: "" },
      status: {
        type: String,
        enum: ["pending", "completed", "failed"],
        default: "completed",
      },
    },
    { timestamps: true }
  );
  Transaction = mongoose.model("Transaction", transactionSchema);
}

module.exports = Transaction;
