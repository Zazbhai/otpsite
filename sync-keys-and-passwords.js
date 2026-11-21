#!/usr/bin/env node
/**
 * SMSCandy -> MongoDB: Set Email as Password & Sync SMSCandy API Keys
 * 
 * 1. Sets every user's password to be identical to their email address (hashed with bcrypt).
 * 2. Synchronizes API keys from SMSCandy (so users keep their original SMSCandy API keys).
 * 
 * Usage:
 *   node sync-keys-and-passwords.js --dry-run             (Preview changes without saving)
 *   node sync-keys-and-passwords.js                       (Live sync from MySQL to MongoDB)
 *   node sync-keys-and-passwords.js --sql=<file.sql>      (Sync from a fresh SQL dump)
 *   node sync-keys-and-passwords.js --preserve-admins     (Do not change admin passwords)
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const mysql = require("mysql2/promise");

// SMSCandy MySQL credentials
const SMSCANDY_MYSQL = {
  host: process.env.SMSCANDY_MYSQL_HOST || "127.0.0.1",
  port: parseInt(process.env.SMSCANDY_MYSQL_PORT || "3306", 10),
  user: process.env.SMSCANDY_MYSQL_USER || "smscandy_app",
  password: process.env.SMSCANDY_MYSQL_PASSWORD || "c8bbcceba113371f5da5a8b0adee33cadac201675bf93fb3",
  database: process.env.SMSCANDY_MYSQL_DATABASE || "smscandy"
};

const MONGO_URI = process.env.MONGO_URI;

async function getKeysFromMySql() {
  console.log(`🔌 Connecting to SMSCandy MySQL (${SMSCANDY_MYSQL.host}:${SMSCANDY_MYSQL.port}, DB: ${SMSCANDY_MYSQL.database})...`);
  const conn = await mysql.createConnection(SMSCANDY_MYSQL);

  const [rows] = await conn.execute(
    "SELECT email, api_key, is_admin, is_super FROM users"
  );
  await conn.end();

  const keyMap = new Map();
  for (const r of rows) {
    const email = (r.email || "").toLowerCase().trim();
    if (!email) continue;
    // Prefer non-null API key if multiple brand registrations exist
    if (r.api_key || !keyMap.has(email)) {
      keyMap.set(email, r.api_key || null);
    }
  }

  return keyMap;
}

async function getKeysFromSql(sqlPath) {
  console.log(`📄 Reading API keys from SQL file: ${sqlPath}...`);
  const { parseUsersFromSql } = require("./utils/smscandyConverter");
  const rawUsers = await parseUsersFromSql(path.resolve(sqlPath));

  const keyMap = new Map();
  for (const r of rawUsers) {
    const email = (r[1] || "").toLowerCase().trim();
    const apiKey = r[6];
    if (!email) continue;
    if (apiKey || !keyMap.has(email)) {
      keyMap.set(email, apiKey || null);
    }
  }

  return keyMap;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const preserveAdmins = args.includes("--preserve-admins");
  const sqlArg = args.find(a => a.startsWith("--sql="));
  const sqlFile = sqlArg ? sqlArg.split("=")[1] : null;
  const mongoArg = args.find(a => a.startsWith("--mongo="));
  const targetMongoUri = mongoArg ? mongoArg.split("=")[1] : MONGO_URI;

  console.log("==========================================================");
  console.log("🔑 Set Email as Password & Sync SMSCandy API Keys");
  console.log("==========================================================");

  if (isDryRun) {
    console.log("🔍 MODE: DRY RUN (Preview only, no changes saved to MongoDB)\n");
  } else {
    console.log("⚡ MODE: LIVE UPDATE\n");
  }

  // 1. Fetch SMSCandy API keys
  let smscandyKeys;
  if (sqlFile) {
    smscandyKeys = await getKeysFromSql(sqlFile);
  } else {
    try {
      smscandyKeys = await getKeysFromMySql();
    } catch (err) {
      console.warn(`⚠️ MySQL direct connection failed: ${err.message}`);
      console.log("💡 Tip: Use --sql=<path-to-sql-file> if MySQL is not directly reachable.");
      process.exit(1);
    }
  }

  console.log(`✅ Loaded ${smscandyKeys.size} users from SMSCandy.`);

  // 2. Connect to MongoDB
  if (!targetMongoUri) {
    console.error("❌ MONGO_URI is missing in .env!");
    process.exit(1);
  }

  console.log(`🔌 Connecting to MongoDB...`);
  await mongoose.connect(targetMongoUri);
  const db = mongoose.connection.db;
  const usersCollection = db.collection("users");

  // 3. Prepare Updates
  console.log("⚙️  Calculating password hashes (email as password) & matching API keys...");
  const mongoUsers = await usersCollection.find({}).toArray();

  const updates = [];
  let apiKeysUpdatedCount = 0;
  let skippedAdminsCount = 0;

  for (const mu of mongoUsers) {
    const email = (mu.email || "").toLowerCase().trim();

    if (preserveAdmins && mu.is_admin) {
      skippedAdminsCount++;
      continue;
    }

    // Set password = email (lowercase)
    const newPasswordHash = await bcrypt.hash(email, 12);

    // Sync API key from SMSCandy if present
    let targetApiKey = mu.api_key;
    let keyChanged = false;

    if (smscandyKeys.has(email)) {
      const origApiKey = smscandyKeys.get(email);
      if (origApiKey && origApiKey !== mu.api_key) {
        targetApiKey = origApiKey;
        keyChanged = true;
        apiKeysUpdatedCount++;
      }
    }

    updates.push({
      id: mu._id,
      email,
      username: mu.username,
      newPasswordHash,
      targetApiKey,
      keyChanged
    });
  }

  console.log(`\n📊 Planned Updates:`);
  console.log(`   • Total Users:                     ${mongoUsers.length}`);
  console.log(`   • Passwords to set (to email):     ${updates.length}`);
  console.log(`   • API Keys synced from SMSCandy:   ${apiKeysUpdatedCount}`);
  if (preserveAdmins) {
    console.log(`   • Admins skipped (preserved):      ${skippedAdminsCount}`);
  }

  // Display sample preview
  console.log(`\n👤 Sample Preview (First 3 users):`);
  console.table(
    updates.slice(0, 3).map(u => ({
      Username: u.username,
      Email: u.email,
      "New Password": u.email,
      "API Key": u.targetApiKey,
      "Key Updated?": u.keyChanged ? "YES" : "NO"
    }))
  );

  // 4. Apply Updates
  if (!isDryRun) {
    console.log(`\n💾 Applying updates to MongoDB...`);
    const bulkOps = updates.map(u => {
      const setFields = {
        password_hash: u.newPasswordHash,
        updatedAt: new Date()
      };
      if (u.targetApiKey) {
        setFields.api_key = u.targetApiKey;
      }
      return {
        updateOne: {
          filter: { _id: u.id },
          update: { $set: setFields }
        }
      };
    });

    const result = await usersCollection.bulkWrite(bulkOps);
    console.log(`🎉 Successfully updated ${result.modifiedCount} users in MongoDB!`);
    console.log("   👉 All users can now log in using their email address as their password!");
    console.log("   👉 Their API keys now match their original SMSCandy API keys!");
  } else {
    console.log("\n💡 Dry run complete! Run without `--dry-run` to apply changes.");
  }

  await mongoose.disconnect();
  console.log("\n✨ Done.");
}

main().catch(err => {
  console.error("❌ Fatal Error:", err);
  process.exit(1);
});
