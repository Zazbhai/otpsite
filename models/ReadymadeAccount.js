const mongoose = require("mongoose");
const { DataTypes } = require("sequelize");
const { sequelize, DB_TYPE, applyMongooseShims } = require("../utils/db");

let ReadymadeAccount;

if (DB_TYPE === "mysql") {
  ReadymadeAccount = sequelize.define("ReadymadeAccount", {
    category_id_attr: { type: DataTypes.INTEGER, field: 'category_id', allowNull: false },
    credentials: { type: DataTypes.TEXT, allowNull: false },
    notes: { type: DataTypes.TEXT, defaultValue: "" },
    status: {
      type: DataTypes.ENUM("available", "sold", "reserved"),
      defaultValue: "available",
    },
    sold_to: { type: DataTypes.STRING, defaultValue: null },
    sold_at: { type: DataTypes.DATE, defaultValue: null },
    price_at_sale: { type: DataTypes.FLOAT, defaultValue: null },
    _id: {
      type: DataTypes.VIRTUAL,
      get() { return String(this.id); }
    },
    category_id: {
      type: DataTypes.VIRTUAL,
      get() { return this.category_id_attr; }
    }
  }, {
    indexes: [
      { fields: ["category_id"] },
      { fields: ["status"] },
      { fields: ["sold_to"] }
    ]
  });

  applyMongooseShims(ReadymadeAccount);

  ReadymadeAccount.associate = (models) => {
    ReadymadeAccount.belongsTo(models.AccountCategory, { foreignKey: 'category_id_attr', as: 'category' });
  };
} else {
  const readymadeAccountSchema = new mongoose.Schema(
    {
      category_id: { type: mongoose.Schema.Types.ObjectId, ref: "AccountCategory", required: true, index: true },
      credentials: { type: String, required: true },
      notes:       { type: String, default: "" },   
      status: {
        type: String,
        enum: ["available", "sold", "reserved"],
        default: "available",
        index: true,
      },
      sold_to:   { type: String, default: null },
      sold_at:   { type: Date,   default: null },
      price_at_sale: { type: Number, default: null },
    },
    { timestamps: true }
  );
  ReadymadeAccount = mongoose.model("ReadymadeAccount", readymadeAccountSchema);
}

module.exports = ReadymadeAccount;
