const mongoose = require("mongoose");

const countrySchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    flag: { type: String, default: "🌍" },
    is_active: { type: Boolean, default: true },
    sort_order: { type: Number, default: 0 }
  },
  { timestamps: true }
);

countrySchema.index({ sort_order: 1, name: 1 });

module.exports = mongoose.model("Country", countrySchema);
