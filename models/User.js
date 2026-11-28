const { decimalField } = require("../utils/money");
const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let User;

if (DB_TYPE === "mysql") {
  User = sequelize.define("User", {
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    email: { type: DataTypes.STRING, unique: true, allowNull: false },
    password_hash: { type: DataTypes.STRING, allowNull: false },
    display_name: { type: DataTypes.STRING, defaultValue: "" },
    phone: { type: DataTypes.STRING, defaultValue: "" },
    telegram_chat_id: { type: DataTypes.STRING, defaultValue: "" },
    avatar_color: { type: DataTypes.STRING, defaultValue: "#3b82f6" },
    avatar_url: { type: DataTypes.STRING, defaultValue: "" },
    balance: decimalField(DataTypes, "balance", { defaultValue: 0 }),
    is_banned: { type: DataTypes.BOOLEAN, defaultValue: false },
    is_admin: { type: DataTypes.BOOLEAN, defaultValue: false },
    total_spent: decimalField(DataTypes, "total_spent", { defaultValue: 0 }),
    total_orders: { type: DataTypes.INTEGER, defaultValue: 0 },
    notes: { type: DataTypes.TEXT, defaultValue: "" },
    api_key: { type: DataTypes.STRING, defaultValue: "" },
    currency: { type: DataTypes.STRING, defaultValue: "INR" },
    referral_code: { type: DataTypes.STRING, unique: true },
    referred_by: { type: DataTypes.STRING, defaultValue: null },
    referral_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    referral_earnings: decimalField(DataTypes, "referral_earnings", { defaultValue: 0 }),
    has_deposited: { type: DataTypes.BOOLEAN, defaultValue: false },
    discounts: { type: DataTypes.TEXT, defaultValue: "[]" }, // JSON string of [{service_name, percentage}]
    _id: {
      type: DataTypes.VIRTUAL,
      get() { return String(this.id); }
    }
  }, {
    hooks: {
      beforeCreate: (user) => {
        if (!user.avatar_url) {
          const avatars = [
            "/images/avatars/avatar_1.png", "/images/avatars/avatar_2.png", "/images/avatars/avatar_3.png",
            "/images/avatars/avatar_4.png", "/images/avatars/avatar_5.png", "/images/avatars/avatar_6.png",
            "/images/avatars/avatar_7.png", "/images/avatars/avatar_8.png", "/images/avatars/avatar_9.png",
            "/images/avatars/avatar_10.png", "/images/avatars/avatar_11.png", "/images/avatars/avatar_12.png",
            "/images/avatars/avatar_13.png", "/images/avatars/avatar_14.png", "/images/avatars/avatar_15.png",
            "/images/avatars/avatar_16.png", "/images/avatars/avatar_17.png", "/images/avatars/avatar_18.png",
            "/images/avatars/avatar_19.png", "/images/avatars/avatar_20.png"
          ];
          user.avatar_url = avatars[Math.floor(Math.random() * avatars.length)];
        }
      }
    },
    indexes: [
      { name: "idx_users_api_key", fields: ["api_key"] },
      { fields: ["email"], unique: true },
      { fields: ["username"], unique: true },
      { fields: ["referral_code"], unique: true },
      { fields: ["referred_by"] },
      { fields: ["createdAt"] }
    ]
  });

  applyMongooseShims(User);
} else {
  const userSchema = new mongoose.Schema(
    {
      username: { type: String, unique: true, required: true, trim: true, minlength: 3, maxlength: 30 },
      email:    { type: String, unique: true, required: true, lowercase: true, trim: true },
      password_hash: { type: String, required: true },
      display_name:  { type: String, default: "" },
      phone:         { type: String, default: "" },
      telegram_chat_id: { type: String, default: "" },
      avatar_color:  { type: String, default: "#3b82f6" }, 
      avatar_url:    { type: String, default: "" },
      balance:       { type: Number, default: 0 },
      is_banned:     { type: Boolean, default: false },
      is_admin:      { type: Boolean, default: false },
      total_spent:   { type: Number, default: 0 },
      total_orders:  { type: Number, default: 0 },
      notes:         { type: String, default: "" },
      api_key:       { type: String, default: "" },
      currency:      { type: String, default: "INR" },
      referral_code: { type: String, unique: true, sparse: true },
      referred_by:   { type: String, default: null, index: true },
      referral_count: { type: Number, default: 0 },
      referral_earnings: { type: Number, default: 0 },
      has_deposited: { type: Boolean, default: false },
      discounts: [{
        service_name: { type: String, default: "all" },
        server_id: { type: String, default: "all" },
        percentage: { type: Number, default: 0 }
      }],
    },
    { timestamps: true }
  );

  userSchema.index({ api_key: 1 }, { name: "idx_users_api_key" });
  userSchema.pre("save", function(next) {
    if (!this.avatar_url) {
      const avatars = [
        "/images/avatars/avatar_1.png", "/images/avatars/avatar_2.png", "/images/avatars/avatar_3.png",
        "/images/avatars/avatar_4.png", "/images/avatars/avatar_5.png", "/images/avatars/avatar_6.png",
        "/images/avatars/avatar_7.png", "/images/avatars/avatar_8.png", "/images/avatars/avatar_9.png",
        "/images/avatars/avatar_10.png", "/images/avatars/avatar_11.png", "/images/avatars/avatar_12.png",
        "/images/avatars/avatar_13.png", "/images/avatars/avatar_14.png", "/images/avatars/avatar_15.png",
        "/images/avatars/avatar_16.png", "/images/avatars/avatar_17.png", "/images/avatars/avatar_18.png",
        "/images/avatars/avatar_19.png", "/images/avatars/avatar_20.png"
      ];
      this.avatar_url = avatars[Math.floor(Math.random() * avatars.length)];
    }
    next();
  });

  userSchema.pre("findOneAndUpdate", require("../utils/money").roundMongoWalletIncrement);
  User = mongoose.model("User", userSchema);
}

module.exports = User;
