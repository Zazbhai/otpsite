// Read-only; deliberately avoids connectDB(), sync(), migrations and provider calls.
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const { sequelize, DB_TYPE } = require("../utils/db");
const Server = require("../models/Server");
const Order = require("../models/Order");
const Transaction = require("../models/Transaction");
const Service = require("../models/Service");
const { diagnoseProviderWebhook, diagnoseProviderLog } = require("../utils/providerWebhookDiagnosis");

async function main() {
  const [serverId, ...ids] = process.argv.slice(2);
  if (!serverId || !ids.length || ids.length > 20 || ids.some(id => !id || id.length > 255)) {
    throw new Error("Usage: node scripts/diagnose-provider-webhook.js SERVER_ID ORDER_ID [ORDER_ID ...]");
  }
  if (DB_TYPE === "mysql") await sequelize.authenticate();
  else await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
  const report = await diagnoseProviderWebhook({ Server, Order, Transaction, Service, dbType: DB_TYPE }, serverId, ids);
  const logFile = path.join(__dirname, "..", "onlinesim", "onlinesim_log.txt");
  if (fs.existsSync(logFile)) {
    const file = fs.openSync(logFile, "r");
    try {
      const size = fs.fstatSync(file).size;
      const start = Math.max(0, size - 2 * 1024 * 1024);
      const buffer = Buffer.alloc(size - start);
      fs.readSync(file, buffer, 0, buffer.length, start);
      report.provider_log_sampled = start > 0;
      report.provider_allocations = diagnoseProviderLog(buffer.toString("utf8"), ids);
    } finally { fs.closeSync(file); }
  }
  // Direct output so terminal filtering never hides this diagnostic report.
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main().catch(error => {
  console.error("Webhook diagnosis failed:", error.message.startsWith("Usage:") ? error.message : error.code || error.name);
  process.exitCode = 1;
}).finally(async () => {
  if (sequelize) await sequelize.close();
  else await mongoose.disconnect();
});
