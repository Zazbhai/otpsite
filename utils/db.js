const mongoose = require("mongoose");
const { Sequelize } = require("sequelize");
require("dotenv").config();

const DB_TYPE = (process.env.DB_TYPE || "mongodb").toLowerCase().trim();

let sequelize;
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
      pool: {
        max: 10,     // Increased for better concurrency (standard for production)
        min: 1,      // Keep at least one connection warm
        idle: 10000, // Close idle connections after 10s
        evict: 5000,
        acquire: 60000 // Wait up to 60s for a connection if pool is full
      }
    }
  );
}

const connectDB = async () => {
  log(`🔌 Attempting to connect to database (Type: ${DB_TYPE})...`);
  if (DB_TYPE === "mysql") {

    try {
      await sequelize.authenticate();
      log("✅ MySQL connected via Sequelize");
      
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
      
      // Initialize Associations
      Object.keys(sequelize.models).forEach(modelName => {
        if (sequelize.models[modelName].associate) {
          sequelize.models[modelName].associate(sequelize.models);
        }
      });

      await sequelize.sync({ alter: false });
      log("✅ MySQL Models synchronized");
    } catch (err) {
      log("❌ MySQL connection error: " + err.message);
      throw err; // Re-throw to prevent server from starting without DB
    }
  } else {
    const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/RapidOTP";
    mongoose.set("strictQuery", false);

    try {
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      log("✅ MongoDB connected");
    } catch (err) {
      log("❌ MongoDB connection error: " + err.message);
      throw err; // Re-throw
    }
  }
};

const applyMongooseShims = (model) => {
  if (DB_TYPE !== "mysql") return model;

  const translateQuery = (query) => {
    if (!query) return {};
    const { Op } = require("sequelize");
    const where = query.where ? { ...query.where } : { ...query };
    
    // Map of MongoDB operators to Sequelize Operators
    const operatorMap = {
      "$or": Op.or,
      "$and": Op.and,
      "$in": Op.in,
      "$nin": Op.nin,
      "$gt": Op.gt,
      "$gte": Op.gte,
      "$lt": Op.lt,
      "$lte": Op.lte,
      "$ne": Op.ne,
      "$regex": Op.regexp
    };

    const processObject = (obj) => {
      const newObj = {};
      for (let key in obj) {
        let val = obj[key];
        // Map _id to id for MySQL compatibility, including table-prefixed instances
        if (key === '_id') key = 'id';
        if (key.endsWith('._id')) key = key.replace('._id', '.id');
        if (operatorMap[key]) {
          if (Array.isArray(val)) {
            newObj[operatorMap[key]] = val.map(v => processObject(v));
          } else {
            newObj[operatorMap[key]] = processObject(val);
          }
          continue;
        }

        // Handle value-level operators (e.g., price: { $gte: 10 })
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const innerObj = {};
          let hasOp = false;
          for (const vKey in val) {
            if (operatorMap[vKey]) {
              let actualVal = val[vKey];
              // Convert JS RegExp to string for SQL Compatibility
              if (vKey === "$regex" && actualVal instanceof RegExp) actualVal = actualVal.source;
              innerObj[operatorMap[vKey]] = actualVal;
              hasOp = true;
            } else if (vKey !== "$options") {
              innerObj[vKey] = val[vKey];
            }
          }
          newObj[key] = hasOp ? innerObj : val;
        } else {
          newObj[key] = val;
        }
      }
      return newObj;
    };

    return processObject(where);
  };

  // Save original methods to avoid infinite recursion
  const originalFindOne = model.findOne.bind(model);
  const originalFindAll = model.findAll.bind(model);
  const originalCount   = model.count.bind(model);
  const originalDestroy = model.destroy.bind(model);

  class Query {
    constructor(m, where, options = {}) {
      this.m = m;
      this.where = where;
      this.options = options;
    }
    select(fields) {
      if (typeof fields === 'string') {
        const parts = fields.split(' ');
        const include = [], exclude = [];
        parts.forEach(p => {
          if (!p) return;
          let field = p;
          if (p === '_id') field = 'id';
          else if (p === '-_id') field = '-id';

          if (field.startsWith('-')) exclude.push(field.slice(1));
          else include.push(field);
        });
        if (include.length > 0) this.options.attributes = include;
        else if (exclude.length > 0) this.options.attributes = { exclude };
      }
      return this;
    }
    sort(sort) {
      let order = [];
      if (typeof sort === 'string') {
        const parts = sort.split(' ');
        parts.forEach(p => {
          if (!p) return;
          let field = p === '_id' ? 'id' : p;
          order.push([field.replace(/^-/, ''), field.startsWith('-') ? 'DESC' : 'ASC']);
        });
      } else if (typeof sort === 'object') {
        for (const k in sort) order.push([k === '_id' ? 'id' : k, sort[k] === -1 ? 'DESC' : 'ASC']);
      }
      this.options.order = order;
      return this;
    }
    skip(n) { this.options.offset = parseInt(n); return this; }
    limit(n) { this.options.limit = parseInt(n); return this; }
    
    populate(params) {
      if (!this.options.include) this.options.include = [];
      
      const processPopulate = (item) => {
        const p = typeof item === 'string' ? { path: item } : item;
        const mappings = { 'server_id': 'server', 'country_id': 'country', 'category_id': 'category' };
        const realPath = mappings[p.path] || p.path;
        const includeObj = { association: realPath };
        if (p.select) {
          includeObj.attributes = p.select.split(' ').map(f => f === '_id' ? 'id' : f);
        }
        if (p.populate) {
          includeObj.include = Array.isArray(p.populate) 
            ? p.populate.map(nested => processPopulate(nested))
            : [processPopulate(p.populate)];
        }
        return includeObj;
      };

      if (Array.isArray(params)) {
        params.forEach(p => this.options.include.push(processPopulate(p)));
      } else {
        this.options.include.push(processPopulate(params));
      }
      return this;
    }
    
    lean() { this.options.raw = true; return this; }
    
    async then(resolve, reject) {
      try {
        if (this.options.forceNull) return resolve(null);
        const finalOptions = { where: { ...this.where }, transaction: this.options.transaction };
        if (this.options.attributes) finalOptions.attributes = this.options.attributes;
        if (this.options.order) finalOptions.order = this.options.order;
        if (this.options.offset) finalOptions.offset = this.options.offset;
        if (this.options.limit) finalOptions.limit = this.options.limit;
        if (this.options.raw !== undefined) finalOptions.raw = this.options.raw;
        if (this.options.include) finalOptions.include = this.options.include;
        
        const result = this.options.single ? await originalFindOne(finalOptions) : await originalFindAll(finalOptions);
        return resolve(result);
      } catch (err) {
        if (reject) return reject(err);
        throw err;
      }
    }
  }

  model.findById = (id, opts = {}) => {
    if (id === undefined || id === null || id === "undefined" || id === "") {
        return new Query(model, { id: null }, { ...opts, single: true, forceNull: true });
    }
    const where = { [model.primaryKeyAttribute || 'id']: id };
    return new Query(model, where, { ...opts, single: true });
  };
  
  model.findOne = (query, opts = {}) => {
    const q = query && query.where ? query.where : query;
    if (!q || (typeof q === 'object' && Object.values(q).every(v => v === undefined))) {
       return new Query(model, { id: null }, { ...opts, single: true, forceNull: true });
    }
    const where = translateQuery(q);
    return new Query(model, where, { ...opts, single: true });
  };

  model.find = (query, opts = {}) => {
    const where = translateQuery(query);
    return new Query(model, where, opts);
  };

  model.findOneAndUpdate = async (query, update, options) => {
    const where = translateQuery(query);
    const record = await originalFindOne({ where, transaction: options?.transaction });
    if (!record) {
      if (options?.upsert) return model.create({ ...where, ...update }, { transaction: options?.transaction });
      return null;
    }
    await record.update(update, { transaction: options?.transaction });
    return record;
  };

  model.findByIdAndUpdate = (id, update, options) => {
    return model.findOneAndUpdate({ [model.primaryKeyAttribute || 'id']: id }, update, options);
  };

  model.findByIdAndDelete = (id, options) => {
    const where = { [model.primaryKeyAttribute || 'id']: id };
    return originalDestroy({ where, transaction: options?.transaction });
  };
  
  model.findByIdAndRemove = model.findByIdAndDelete;

  model.deleteMany = (query, options) => {
    const where = translateQuery(query);
    return originalDestroy({ where, transaction: options?.transaction });
  };

  model.countDocuments = (query, options) => {
    const where = translateQuery(query);
    return originalCount({ where, transaction: options?.transaction });
  };
  
  model.count = model.countDocuments;

  model.updateOne = async (query, update, options) => {
    const actualUpdate = update.$set ? update.$set : update;
    return model.findOneAndUpdate(query, actualUpdate, options);
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
  
  model.insertMany = (docs, options) => {
    return model.bulkCreate(docs, { transaction: options?.transaction });
  };
  
  // Instance method shims
  if (model.prototype) {
    const originalToJSON = model.prototype.toJSON;
    const shimmedToJSON = function() {
        // Use this.get() without plain:true to ensure getters (like JSON parsing for all_otps) are applied
        const obj = this.get();
        const data = {};
        
        // Manual deep clone / cleaning to match lean() behavior but with getters
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                data[key] = obj[key];
            }
        }
        
        // 1. Map renamed associations back to legacy names if populated (High priority)
        if (data.server) data.server_id = data.server;
        if (data.country) data.country_id = data.country;
        if (data.category) data.category_id = data.category;
        
        // 2. Map _attr fields back to original names for the frontend (Lower priority, doesn't overwrite objects)
        for (const key in data) {
            if (key.endsWith('_attr')) {
                const originalKey = key.replace('_attr', '');
                if (data[originalKey] === undefined || data[originalKey] === null) {
                    data[originalKey] = data[key];
                }
            }
        }

        if (this.id && !data._id) data._id = String(this.id);
        
        return data;
    };
    model.prototype.toObject = shimmedToJSON;
    model.prototype.toJSON = shimmedToJSON;
  }
  
  return model;
};

/**
 * A database-agnostic transaction wrapper.
 * Handles Sequelize transactions for MySQL and Mongoose sessions for MongoDB.
 */
const withTransaction = async (callback) => {
  if (DB_TYPE === "mysql") {
    return await sequelize.transaction(async (t) => {
      return await callback(t);
    });
  } else {
    const mongoose = require("mongoose");
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const result = await callback(session);
      await session.commitTransaction();
      return result;
    } catch (err) {
      if (session.inTransaction()) await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  }
};

// Global Logger Redirection for cPanel/Linux debugging
const fs = require("fs");
const path = require("path");
const logFile = path.join(__dirname, "../app.log");

const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);

const logToFile = (msg, isError = false) => {
    const timestamp = new Date().toISOString();
    const prefix = isError ? "[ERROR]" : "[INFO]";
    const line = `[${timestamp}] ${prefix} ${msg}\n`;
    try {
        fs.appendFileSync(logFile, line);
    } catch (e) {}
};

// Overwrite global console methods
console.log = (...args) => {
    const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
    logToFile(msg);
    originalConsoleLog(...args);
};

console.error = (...args) => {
    const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
    logToFile(msg, true);
    originalConsoleError(...args);
};

const log = (msg) => console.log(msg);

module.exports = { connectDB, sequelize, DB_TYPE, applyMongooseShims, withTransaction, log };
