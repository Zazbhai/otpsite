const mongoose = require("mongoose");

// A single pre-made account credential stored by admin
const readymadeAccountSchema = new mongoose.Schema(
  {
    category_id: { type: mongoose.Schema.Types.ObjectId, ref: "AccountCategory", required: true, index: true },
    credentials: { type: String, required: true }, // e.g. "email:password" or any text
    notes:       { type: String, default: "" },     // admin-only notes (e.g. region, plan)
    status: {
      type: String,
      enum: ["available", "sold", "reserved"],
      default: "available",
      index: true,
    },
    sold_to:   { type: String, default: null },   // user_id who purchased
    sold_at:   { type: Date,   default: null },
    price_at_sale: { type: Number, default: null }, // snapshot of price when sold
  },
  { timestamps: true }
);

module.exports = mongoose.model("ReadymadeAccount", readymadeAccountSchema);
