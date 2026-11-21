#!/usr/bin/env node
/**
 * SMSCandy -> MongoDB Balance Synchronizer
 * 
 * Fetches the latest balances from SMSCandy (via direct MySQL connection or SQL dump)
 * and updates them into the local MongoDB database.
 * 
 * Usage:
 *   node sync-balances.js --dry-run        (Preview balance changes without applying)
 *   node sync-balances.js                  (Live sync directly from MySQL -> MongoDB)
 *   node sync-balances.js --sql=<file.sql> (Sync balances from a fresh SQL dump)
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const mysql = require("mysql2/promise");

// Default SMSCandy MySQL credentials
const SMSCANDY_MYSQL = {
  host: process.env.SMSCANDY_MYSQL_HOST || "127.0.0.1",
  port: parseInt(process.env.SMSCANDY_MYSQL_PORT || "3306", 10),
  user: process.env.SMSCANDY_MYSQL_USER || "smscandy_app",
  password: process.env.SMSCANDY_MYSQL_PASSWORD || "c8bbcceba113371f5da5a8b0adee33cadac201675bf93fb3",
  database: process.env.SMSCANDY_MYSQL_DATABASE || "smscandy"
};

// Target MongoDB connection
const MONGO_URI = process.env.MONGO_URI;

async function getBalancesFromMySql() {
  console.log(`🔌 Connecting to SMSCandy MySQL (${SMSCANDY_MYSQL.host}:${SMSCANDY_MYSQL.port}, DB: ${SMSCANDY_MYSQL.database})...`);
  const conn = await mysql.createConnection(SMSCANDY_MYSQL);

  const [rows] = await conn.execute(
    "SELECT email, balance, is_admin, is_super, brand_id FROM users"
  );
  await conn.end();

  // Aggregate by email (handling any duplicate multi-brand accounts)
  const balanceMap = new Map();
  for (const r of rows) {
    const email = (r.email || "").toLowerCase().trim();
    if (!email) continue;
    const bal = parseFloat(Number(r.balance || 0).toFixed(2));
    const current = balanceMap.get(email) || 0;
    balanceMap.set(email, parseFloat((current + bal).toFixed(2)));
  }

  return balanceMap;
}

function parseBalancesFromSql(sqlPath) {
  console.log(`📄 Reading balances from SQL file: ${sqlPath}...`);
  const content = fs.readFileSync(sqlPath, "utf8");

  // Regex for INSERT INTO `users` VALUES
  const lineMatch = content.match(/INSERT INTO `users` VALUES\s*(.*?);/s);
  if (!lineMatch) {
    throw new Error("No `INSERT INTO \`users\`` statement found in SQL file.");
  }

  const { parseUsersFromSql } = require("./utils/smscandyConverter");
  const rawRows = parseUsersFromSql(sqlPath);
  return rawRows;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const sqlArg = args.find(a => a.startsWith("--sql="));
  const sqlFile = sqlArg ? sqlArg.split("=")[1] : null;
  const mongoArg = args.find(a => a.startsWith("--mongo="));
  const targetMongoUri = mongoArg ? mongoArg.split("=")[1] : MONGO_URI;

  console.log("==========================================================");
  console.log("💰 SMSCandy -> MongoDB Balance Synchronizer");
  console.log("==========================================================");

  if (isDryRun) {
    console.log("🔍 MODE: DRY RUN (No changes will be saved to MongoDB)\n");
  } else {
    console.log("⚡ MODE: LIVE SYNC\n");
  }

  // 1. Fetch SMSCandy Balances
  let smscandyBalances;
  if (sqlFile) {
    const { parseUsersFromSql, convertUsers } = require("./utils/smscandyConverter");
    const rawUsers = await parseUsersFromSql(path.resolve(sqlFile));
    const converted = convertUsers(rawUsers);
    smscandyBalances = new Map();
    converted.forEach(u => smscandyBalances.set(u.email, u.balance));
  } else {
    try {
      smscandyBalances = await getBalancesFromMySql();
    } catch (err) {
      console.warn(`⚠️ Direct MySQL connection failed: ${err.message}`);
      console.log("💡 Tip: If running locally without MySQL, use --sql=<path-to-sql-file>");
      process.exit(1);
    }
  }

  console.log(`✅ Loaded ${smscandyBalances.size} unique user balances from SMSCandy.`);

  // 2. Connect to MongoDB
  if (!targetMongoUri) {
    console.error("❌ MONGO_URI is missing in .env and no --mongo argument provided!");
    process.exit(1);
  }

  console.log(`🔌 Connecting to MongoDB...`);
  await mongoose.connect(targetMongoUri);
  const db = mongoose.connection.db;
  const usersCollection = db.collection("users");

  // 3. Find differences
  console.log("🔍 Checking for balance discrepancies...");
  const mongoUsers = await usersCollection.find({}, { projection: { email: 1, username: 1, balance: 1 } }).toArray();
  
  const updates = [];
  let totalDelta = 0;

  for (const mu of mongoUsers) {
    const email = (mu.email || "").toLowerCase().trim();
    if (smscandyBalances.has(email)) {
      const newBal = smscandyBalances.get(email);
      const oldBal = parseFloat(Number(mu.balance || 0).toFixed(2));

      if (Math.abs(oldBal - newBal) >= 0.01) {
        const delta = parseFloat((newBal - oldBal).toFixed(2));
        totalDelta += delta;
        updates.push({
          id: mu._id,
          username: mu.username,
          email,
          oldBal,
          newBal,
          delta
        });
      }
    }
  }

  // 4. Display report
  if (updates.length === 0) {
    console.log("\n✨ All user balances are already 100% in sync! No updates needed.");
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`\n📋 Found ${updates.length} user(s) with balance changes:\n`);
  console.table(
    updates.map(u => ({
      Username: u.username,
      Email: u.email,
      "Current Bal (₹)": u.oldBal.toFixed(2),
      "New Bal (₹)": u.newBal.toFixed(2),
      "Change (₹)": (u.delta > 0 ? "+" : "") + u.delta.toFixed(2)
    }))
  );

  console.log(`\n📊 Summary:`);
  console.log(`   • Total Users Updated: ${updates.length}`);
  console.log(`   • Net Balance Change:  ${totalDelta >= 0 ? "+" : ""}₹${totalDelta.toFixed(2)}`);

  // 5. Apply updates if not dry run
  if (!isDryRun) {
    console.log(`\n💾 Applying ${updates.length} balance updates to MongoDB...`);
    const bulkOps = updates.map(u => ({
      updateOne: {
        filter: { _id: u.id },
        update: {
          $set: {
            balance: u.newBal,
            has_deposited: u.newBal > 0,
            updatedAt: new Date()
          }
        }
      }
    }));

    const result = await usersCollection.bulkWrite(bulkOps);
    console.log(`🎉 Successfully updated ${result.modifiedCount} user balances in MongoDB!`);
  } else {
    console.log("\n💡 Run without `--dry-run` to apply these updates to MongoDB.");
  }

  await mongoose.disconnect();
  console.log("✨ Done.");
}

main().catch(err => {
  console.error("❌ Fatal Error:", err);
  process.exit(1);
});
