const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user_id:       { type: String, required: true, index: true }, // MongoDB ObjectId string
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

module.exports = mongoose.model("Transaction", transactionSchema);
