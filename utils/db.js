const mongoose = require("mongoose");
const { Sequelize } = require("sequelize");
require("dotenv").config();

const DB_TYPE = process.env.DB_TYPE || "mongodb";

let sequelize;

const connectDB = async () => {
  if (DB_TYPE === "mysql") {
    sequelize = new Sequelize(
      process.env.DB_NAME || "zaz",
      process.env.DB_USER || "root",
      process.env.DB_PASS || "",
      {
        host: process.env.DB_HOST || "localhost",
        port: process.env.DB_PORT || 3306,
        dialect: "mysql",
        logging: false,
      }
    );

    try {
      await sequelize.authenticate();
      console.log("✅ MySQL connected via Sequelize");
      
      // Load all models to Ensure they are defined before sync
      require("../models/User");
      require("../models/Order");
      require("../models/Service");
      require("../models/Server");
      require("../models/Country");
      require("../models/Transaction");
      require("../models/Setting");
      require("../models/PromoCode");
      require("../models/ReadymadeAccount");
      require("../models/AccountCategory");

      await sequelize.sync({ alter: true });
      console.log("✅ MySQL Models synchronized");
    } catch (err) {
      console.error("❌ MySQL connection error:", err.message);
    }
  } else {
    const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/RapidOTP";
    mongoose.set("strictQuery", false);

    try {
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      console.log("✅ MongoDB connected");
    } catch (err) {
      console.error("❌ MongoDB connection error:", err.message);
    }
  }
};

const applyMongooseShims = (model) => {
  if (DB_TYPE !== "mysql") return model;

  const translateQuery = (query) => {
    if (!query) return {};
    const where = query.where ? { ...query.where } : { ...query };
    
    // Simple translation of $in to Sequelize array format
    for (const key in where) {
      if (where[key] && typeof where[key] === 'object' && where[key].$in) {
        where[key] = where[key].$in;
      }
      if (where[key] && typeof where[key] === 'object' && where[key].$gte) {
        const { Op } = require("sequelize");
        where[key] = { [Op.gte]: where[key].$gte };
      }
    }
    return where;
  };

  const createQueryProxy = (promise, m, where) => {
    promise.sort = (sort) => {
      let order = [];
      if (typeof sort === 'string') {
        const parts = sort.split(' ');
        order.push([parts[0].replace(/^-/, ''), parts[0].startsWith('-') ? 'DESC' : 'ASC']);
      } else if (typeof sort === 'object') {
        for (const k in sort) order.push([k, sort[k] === -1 ? 'DESC' : 'ASC']);
      }
      const newPromise = m.findAll({ where, order });
      return createQueryProxy(newPromise, m, where);
    };
    promise.skip = (n) => {
      const newPromise = m.findAll({ where, offset: parseInt(n) });
      return createQueryProxy(newPromise, m, where);
    };
    promise.limit = (n) => {
      const newPromise = m.findAll({ where, limit: parseInt(n) });
      return createQueryProxy(newPromise, m, where);
    };
    return promise;
  };

  model.findById = (id) => model.findByPk(id);
  model.findOne = (query) => {
    const where = translateQuery(query);
    return model.findOne({ where });
  };
  model.find = (query) => {
    const where = translateQuery(query);
    const promise = model.findAll({ where });
    return createQueryProxy(promise, model, where);
  };
  model.findOneAndUpdate = async (query, update, options) => {
    const where = translateQuery(query);
    const record = await model.findOne({ where });
    if (!record) {
      if (options?.upsert) return model.create({ ...where, ...update });
      return null;
    }
    await record.update(update);
    return record;
  };
  model.deleteMany = (query) => {
    const where = translateQuery(query);
    return model.destroy({ where });
  };
  model.countDocuments = (query) => {
    const where = translateQuery(query);
    return model.count({ where });
  };
  
  model.bulkWrite = async (operations) => {
    const results = [];
    for (const op of operations) {
      if (op.updateOne) {
        const { filter, update, upsert } = op.updateOne;
        const actualUpdate = update.$set ? update.$set : update;
        const res = await model.findOneAndUpdate(filter, actualUpdate, { upsert });
        results.push(res);
      }
    }
    return results;
  };
  
  return model;
};

module.exports = { connectDB, sequelize, DB_TYPE, applyMongooseShims };
