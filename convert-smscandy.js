#!/usr/bin/env node
/**
 * CLI Command: SMSCandy Database Converter & Importer
 * 
 * Usage:
 *   node convert-smscandy.js                  (Runs dry run and validates data)
 *   node convert-smscandy.js --json           (Exports converted_users.json)
 *   node convert-smscandy.js --sql            (Exports converted_users.sql)
 *   node convert-smscandy.js --import         (Directly imports into MongoDB / MySQL)
 *   node convert-smscandy.js --all            (Exports JSON, SQL, and imports to DB)
 * 
 * Options:
 *   --archive=<path>        Path to smscandy-phone-backup.tar.gz
 *   --sql-file=<path>       Direct path to smscandy-db.sql
 *   --default-password=<pw> Optionally reset all user passwords to a known value
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const {
  ensureSqlExtracted,
  parseUsersFromSql,
  convertUsers,
  exportToJson,
  exportToSql,
  importToDatabase
} = require("./utils/smscandyConverter");

async function main() {
  const args = process.argv.slice(2);
  const flags = {
    import: args.includes("--import"),
    json: args.includes("--json") || args.includes("--all"),
    sql: args.includes("--sql") || args.includes("--all"),
    all: args.includes("--all"),
    dryRun: args.includes("--dry-run") || (!args.includes("--import") && !args.includes("--json") && !args.includes("--sql") && !args.includes("--all")),
  };

  const getArgVal = (name) => {
    const found = args.find(a => a.startsWith(`--${name}=`));
    return found ? found.split("=")[1] : null;
  };

  const customArchive = getArgVal("archive") || path.join(__dirname, "smscandy-phone-backup.tar.gz");
  const customSql = getArgVal("sql-file") || path.join(__dirname, "smscandy-backup", "smscandy-db.sql");
  const defaultPassword = getArgVal("default-password");

  console.log("==========================================================");
  console.log("🍬  SMSCandy Database Converter -> OTP Site Redesign Schema");
  console.log("==========================================================");

  // 1. Locate / Extract SQL file
  let sqlPath = customSql;
  if (!fs.existsSync(sqlPath)) {
    if (fs.existsSync(customArchive)) {
      console.log(`📂 Archive found: ${customArchive}`);
      sqlPath = ensureSqlExtracted(customArchive, customSql);
    } else {
      console.error(`❌ Neither SQL file (${sqlPath}) nor Archive (${customArchive}) was found!`);
      process.exit(1);
    }
  }

  console.log(`📄 Using SQL backup: ${sqlPath}`);

  // 2. Parse Raw SQL
  console.log("🔍 Parsing user records from SQL...");
  const rawUsers = await parseUsersFromSql(sqlPath);
  console.log(`✅ Raw user rows extracted: ${rawUsers.length}`);

  if (rawUsers.length === 0) {
    console.warn("⚠️ No user rows found in SQL file.");
    process.exit(0);
  }

  // 3. Convert Users
  console.log("⚙️  Transforming to OTP Site Redesign schema...");
  const convertedUsers = convertUsers(rawUsers, { defaultPassword });
  console.log(`✅ Converted into ${convertedUsers.length} unique, validated users.`);

  // 4. Calculate Statistics
  const totalBalance = convertedUsers.reduce((sum, u) => sum + (u.balance || 0), 0);
  const usersWithBalance = convertedUsers.filter(u => u.balance > 0).length;
  const adminUsers = convertedUsers.filter(u => u.is_admin);
  const referredUsers = convertedUsers.filter(u => u.referred_by);

  console.log("\n📊 Migration Summary:");
  console.log(`   • Total Users:            ${convertedUsers.length}`);
  console.log(`   • Users with Balance > 0: ${usersWithBalance}`);
  console.log(`   • Total Balance Sum:      ₹${totalBalance.toFixed(2)}`);
  console.log(`   • Administrators:         ${adminUsers.length} (${adminUsers.map(a => a.email).join(", ")})`);
  console.log(`   • Referral Linked Users:  ${referredUsers.length}`);

  console.log("\n👤 Sample Converted User (First Record):");
  console.log(JSON.stringify(convertedUsers[0], null, 2));

  // 5. Exports
  const jsonPath = path.join(__dirname, "converted_users.json");
  const sqlExportPath = path.join(__dirname, "converted_users.sql");

  if (flags.json) {
    console.log(`\n💾 Exporting to JSON: ${jsonPath}...`);
    exportToJson(convertedUsers, jsonPath);
    console.log(`✅ JSON export ready! Can be imported directly via mongoimport:`);
    console.log(`   mongoimport --uri "<MONGO_URI>" --collection users --file converted_users.json --jsonArray`);
  }

  if (flags.sql) {
    console.log(`\n💾 Exporting to SQL: ${sqlExportPath}...`);
    exportToSql(convertedUsers, sqlExportPath);
    console.log(`✅ SQL export ready! Can be imported directly into MySQL:`);
    console.log(`   mysql -u <user> -p <db_name> < converted_users.sql`);
  }

  // 6. Direct DB Import
  if (flags.import) {
    console.log("\n📥 Initiating Direct Database Import...");
    try {
      const result = await importToDatabase(convertedUsers);
      console.log("\n🎉 Database Import Complete!");
      console.log(`   • Total:    ${result.total}`);
      console.log(`   • Created:  ${result.imported}`);
      console.log(`   • Updated:  ${result.updated}`);
      console.log(`   • Failed:   ${result.failed}`);
    } catch (err) {
      console.error("\n❌ Database Import Failed:", err.message);
      console.log("💡 Tip: You can still use the generated converted_users.json or converted_users.sql once your database connection is active!");
    }
  } else if (flags.dryRun && !flags.json && !flags.sql) {
    console.log("\n💡 Dry run complete! No database records were modified.");
    console.log("   To export data or import into database:");
    console.log("   • node convert-smscandy.js --json    (Export to JSON)");
    console.log("   • node convert-smscandy.js --sql     (Export to MySQL script)");
    console.log("   • node convert-smscandy.js --import  (Directly import into configured database)");
    console.log("   • node convert-smscandy.js --all     (Export JSON, SQL, and import)");
  }

  console.log("\n✨ Done.");
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
