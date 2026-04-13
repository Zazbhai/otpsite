const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    order_id:          { type: String, unique: true, required: true },
    user_id:           { type: String, required: true, index: true }, // MongoDB ObjectId string
    service_name:      { type: String, required: true },
    server_name:       { type: String, default: "" },
    country:           { type: String, default: "" },
    phone:             { type: String, default: "" },
    otp:               { type: String, default: "" },
    all_otps:          [{ type: String }],
    status: {
      type: String,
      enum: ["active", "completed", "refunded", "expired", "cancelled"],
      default: "active",
    },
    cost:              { type: Number, required: true },
    expires_at:        { type: Date },
    min_cancel_at:     { type: Date },
    external_order_id: { type: String, default: "" },
    multi_otp_enabled: { type: Boolean, default: false },
    last_check_at:     { type: Date },
    service_image:     { type: String, default: "" },
    service_color:     { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);
