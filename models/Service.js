const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    server_id: { type: mongoose.Schema.Types.ObjectId, ref: "Server" },
    service_code: { type: String, required: true },
    country_code: { type: String, required: true },
    price: { type: Number, required: true },
    image_url: { type: String, default: "" },
    icon_color: { type: String, default: "" },
    success_rate: { type: String, default: "95%" },
    avg_time: { type: String, default: "2m" },
    is_active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Service", serviceSchema);
