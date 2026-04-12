const mongoose = require("mongoose");

const promoCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    amount: { type: Number, required: true },
    is_active: { type: Boolean, default: true },
    usage_limit: { type: Number, default: 1 }, // Total number of times this code can be used
    used_count: { type: Number, default: 0 },
    used_by: { type: [String], default: [] }, // Array of User IDs
    expired_at: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PromoCode", promoCodeSchema);
