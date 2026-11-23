const { decimalField } = require("../utils/money");
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
    amount: decimalField(DataTypes, "amount", { allowNull: false }),
    balance_after: decimalField(DataTypes, "balance_after", { defaultValue: 0 }),
    description: { type: DataTypes.STRING, defaultValue: "" },
    reference: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
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
      { fields: ["user_id"] },
      { fields: ["createdAt"] },
      { fields: ["reference"], unique: true },
      { fields: ["order_id", "type", "status"] },
      { fields: ["type", "status", "createdAt"] }
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
      reference:     { type: String, index: { unique: true, sparse: true } },
      order_id:      { type: String, default: "" },
      status: {
        type: String,
        enum: ["pending", "completed", "failed"],
        default: "completed",
      },
    },
    { timestamps: true }
  );
  transactionSchema.index({ order_id: 1, type: 1, status: 1 });
  transactionSchema.index({ type: 1, status: 1, createdAt: 1 });
  Transaction = mongoose.model("Transaction", transactionSchema);
}

module.exports = Transaction;
