const mongoose = require("mongoose");

const serverSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String },
    country_id: { type: mongoose.Schema.Types.ObjectId, ref: "Country" },
    api_key: { type: String, default: "" },
    api_get_number_url: { type: String, default: "" },
    api_check_status_url: { type: String, default: "" },
    api_cancel_url: { type: String, default: "" },
    api_retry_url: { type: String, default: "" },
    auto_cancel_minutes: { type: Number, default: 20 },
    retry_count: { type: Number, default: 0 },
    min_cancel_minutes: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
    multi_otp_supported: { type: Boolean, default: false }
  },
  { timestamps: true }
);

serverSchema.pre("save", function (next) {
  if (!this.slug && this.name) {
    this.slug = this.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }
  next();
});

module.exports = mongoose.model("Server", serverSchema);
