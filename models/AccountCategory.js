const mongoose = require("mongoose");

// A "Category" groups readymade accounts (e.g., "Netflix", "Spotify Premium")
const accountCategorySchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    icon:        { type: String, default: "🗂️" },      // emoji or URL
    price:       { type: Number, required: true, min: 0 }, // price per account in ₹
    is_active:   { type: Boolean, default: true },
    sort_order:  { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AccountCategory", accountCategorySchema);
