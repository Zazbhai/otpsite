const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let Setting;

if (DB_TYPE === "mysql") {
  Setting = sequelize.define("Setting", {
    key: { type: DataTypes.STRING, unique: true, allowNull: false },
    value: { 
      type: DataTypes.TEXT, 
      get() {
        const val = this.getDataValue('value');
        try { return JSON.parse(val); } catch (e) { return val; }
      },
      set(val) {
        // Always stringify to ensure validity if the DB column is JSON
        try {
          this.setDataValue('value', JSON.stringify(val));
        } catch (e) {
          this.setDataValue('value', val);
        }
      }
    },
    label: { type: DataTypes.STRING, defaultValue: "" },
    group: { type: DataTypes.STRING, defaultValue: "general" },
    _id: {
      type: DataTypes.VIRTUAL,
      get() { return this.id; }
    }
  });

  applyMongooseShims(Setting);
} else {
  const settingSchema = new mongoose.Schema(
    {
      key: { type: String, unique: true, required: true },
      value: { type: mongoose.Schema.Types.Mixed },
      label: { type: String, default: "" },
      group: { type: String, default: "general" },
    },
    { timestamps: true }
  );
  Setting = mongoose.model("Setting", settingSchema);
}

module.exports = Setting;
