const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, required: true },
    value: { type: mongoose.Schema.Types.Mixed },
    label: { type: String, default: "" },
    group: { type: String, default: "general" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Setting", settingSchema);
