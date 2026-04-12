const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, unique: true, required: true, trim: true, minlength: 3, maxlength: 30 },
    email:    { type: String, unique: true, required: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    display_name:  { type: String, default: "" },
    avatar_color:  { type: String, default: "#3b82f6" }, // random accent color per user
    balance:       { type: Number, default: 0 },
    is_banned:     { type: Boolean, default: false },
    is_admin:      { type: Boolean, default: false },
    total_spent:   { type: Number, default: 0 },
    total_orders:  { type: Number, default: 0 },
    notes:         { type: String, default: "" },
    api_key:       { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
