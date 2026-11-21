/**
 * SMSCandy Database Converter for OTP Site Redesign
 * 
 * Extracts and converts user records from smscandy SQL backups (or .tar.gz archives)
 * directly into the otpsite-redesign User schema for both MongoDB (Mongoose) and MySQL (Sequelize).
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { nanoid } = require("nanoid");

// Standard avatar pool from otpsite-redesign
const AVATARS = [
  "/images/avatars/avatar_1.png", "/images/avatars/avatar_2.png", "/images/avatars/avatar_3.png",
  "/images/avatars/avatar_4.png", "/images/avatars/avatar_5.png", "/images/avatars/avatar_6.png",
  "/images/avatars/avatar_7.png", "/images/avatars/avatar_8.png", "/images/avatars/avatar_9.png",
  "/images/avatars/avatar_10.png", "/images/avatars/avatar_11.png", "/images/avatars/avatar_12.png",
  "/images/avatars/avatar_13.png", "/images/avatars/avatar_14.png", "/images/avatars/avatar_15.png",
  "/images/avatars/avatar_16.png", "/images/avatars/avatar_17.png", "/images/avatars/avatar_18.png",
  "/images/avatars/avatar_19.png", "/images/avatars/avatar_20.png"
];

const COLORS = ["#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#10b981", "#f59e0b", "#06b6d4"];

function getRandomAvatar() {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

function getRandomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

/**
 * Extracts .tar.gz archive if the target SQL file does not already exist
 */
function ensureSqlExtracted(archivePath, targetSqlPath) {
  if (fs.existsSync(targetSqlPath)) {
    return targetSqlPath;
  }

  if (!fs.existsSync(archivePath)) {
    throw new Error(`Archive file not found at: ${archivePath}`);
  }

  console.log(`📦 Extracting ${path.basename(archivePath)}...`);
  const extractDir = path.dirname(targetSqlPath);
  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }

  try {
    execSync(`tar -zxvf "${archivePath}" -C "${extractDir}"`, { stdio: "inherit" });
  } catch (err) {
    // If -C failed due to relative paths in tar, try standard extract
    execSync(`tar -zxvf "${archivePath}"`, { stdio: "inherit" });
  }

  if (!fs.existsSync(targetSqlPath)) {
    // Look for any .sql file inside extractDir
    const findSql = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const res = findSql(full);
          if (res) return res;
        } else if (entry.name.endsWith(".sql")) {
          return full;
        }
      }
      return null;
    };
    const found = findSql(extractDir) || findSql(process.cwd());
    if (found) return found;
    throw new Error(`Extracted SQL file not found at ${targetSqlPath}`);
  }

  return targetSqlPath;
}

/**
 * Parses raw SQL tuples from `INSERT INTO \`users\` VALUES (...)`
 */
function parseSqlTuples(tupleString) {
  const rows = [];
  let i = 0;
  const len = tupleString.length;

  while (i < len) {
    while (i < len && tupleString[i] !== "(") i++;
    if (i >= len) break;
    i++; // Skip '('

    const row = [];
    let currentVal = "";
    let inString = false;

    while (i < len) {
      const char = tupleString[i];
      if (inString) {
        if (char === "\\") {
          currentVal += tupleString[i + 1] || "";
          i += 2;
        } else if (char === "'") {
          if (tupleString[i + 1] === "'") {
            currentVal += "'";
            i += 2;
          } else {
            inString = false;
            i++;
          }
        } else {
          currentVal += char;
          i++;
        }
      } else {
        if (char === "'") {
          inString = true;
          i++;
        } else if (char === ",") {
          const trimmed = currentVal.trim();
          if (trimmed === "NULL") row.push(null);
          else if (!isNaN(trimmed) && trimmed !== "") row.push(Number(trimmed));
          else row.push(trimmed);
          currentVal = "";
          i++;
        } else if (char === ")") {
          const trimmed = currentVal.trim();
          if (trimmed === "NULL") row.push(null);
          else if (!isNaN(trimmed) && trimmed !== "") row.push(Number(trimmed));
          else row.push(trimmed);
          currentVal = "";
          rows.push(row);
          i++;
          break;
        } else {
          currentVal += char;
          i++;
        }
      }
    }
  }

  return rows;
}

/**
 * Reads SQL file and parses all users
 */
async function parseUsersFromSql(sqlFilePath) {
  if (!fs.existsSync(sqlFilePath)) {
    throw new Error(`SQL file does not exist: ${sqlFilePath}`);
  }

  const readline = require("readline");
  const fileStream = fs.createReadStream(sqlFilePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const rawRows = [];

  for await (const line of rl) {
    if (line.includes("INSERT INTO `users` VALUES")) {
      const valuesStr = line
        .replace(/^.*?INSERT INTO `users` VALUES\s*/i, "")
        .replace(/;\s*$/, "");
      const parsed = parseSqlTuples(valuesStr);
      rawRows.push(...parsed);
    }
  }

  return rawRows;
}

/**
 * Generates unique valid username conforming to: /^[a-zA-Z0-9_]{3,30}$/
 */
function generateValidUsername(name, email, usedUsernames) {
  let base = (name || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (base.length < 3) {
    base = (email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "");
  }
  if (base.length < 3) {
    base = "user_" + Math.floor(1000 + Math.random() * 9000);
  }
  
  // Truncate to maximum 24 characters to allow room for numeric disambiguation
  base = base.slice(0, 24);

  let candidate = base;
  let suffix = 1;
  while (usedUsernames.has(candidate)) {
    candidate = `${base.slice(0, 24 - String(suffix).length - 1)}_${suffix}`;
    suffix++;
  }

  usedUsernames.add(candidate);
  return candidate;
}

/**
 * Converts raw SMSCandy user tuples into otpsite-redesign User schema
 */
function convertUsers(rawUsers, options = {}) {
  const { defaultPassword, customApiKeyPrefix } = options;

  // 1. Build UUID mapping for referral linking: uuid -> { referral_code, name, email }
  const uuidMap = new Map();
  rawUsers.forEach(r => {
    const id = r[0];
    const email = (r[1] || "").toLowerCase().trim();
    const refCode = r[7];
    uuidMap.set(id, { email, referral_code: refCode });
  });

  const convertedUsers = [];
  const emailMap = new Map(); // For deduplicating emails
  const usedUsernames = new Set();
  const usedReferralCodes = new Set();

  for (const r of rawUsers) {
    const origId = r[0];
    const email = (r[1] || "").toLowerCase().trim();
    const phone = String(r[2] || "").trim();
    const rawName = (r[3] || "").trim();
    const rawPasswordHash = r[4];
    const rawBalance = parseFloat(Number(r[5] || 0).toFixed(2));
    const rawApiKey = r[6];
    const rawReferralCode = (r[7] || "").trim();
    const rawReferredBy = r[8];
    const rawCreatedAt = r[10] ? new Date(r[10]) : new Date();
    const rawIsAdmin = r[11] === 1 || r[12] === 1;
    const rawTelegramChatId = r[13] ? String(r[13]).trim() : "";
    const rawWebhookUrl = r[14] ? String(r[14]).trim() : "";
    const rawTier = r[15] || "free";
    const rawBrandId = r[20] || "";

    if (!email || !email.includes("@")) {
      console.warn(`⚠️ Skipping user with invalid email: id=${origId}`);
      continue;
    }

    // Check if email already processed (handle brand duplicates)
    if (emailMap.has(email)) {
      const existing = emailMap.get(email);
      // Merge balances
      existing.balance = parseFloat((existing.balance + rawBalance).toFixed(2));
      // Keep admin privilege if any of the records had it
      if (rawIsAdmin) existing.is_admin = true;
      // Preserve phone if existing didn't have one
      if (!existing.phone && phone) existing.phone = phone;
      if (!existing.telegram_chat_id && rawTelegramChatId) existing.telegram_chat_id = rawTelegramChatId;
      // Append merge note
      existing.notes += ` | Merged duplicate from smscandy (UUID: ${origId}, Brand: ${rawBrandId || "main"}, Bal: ₹${rawBalance})`;
      continue;
    }

    // Generate unique valid username
    const username = generateValidUsername(rawName, email, usedUsernames);

    // Ensure referral code is unique
    let referral_code = rawReferralCode;
    if (!referral_code || usedReferralCodes.has(referral_code)) {
      referral_code = Math.random().toString(36).substring(2, 10).toUpperCase();
      while (usedReferralCodes.has(referral_code)) {
        referral_code = Math.random().toString(36).substring(2, 10).toUpperCase();
      }
    }
    usedReferralCodes.add(referral_code);

    // Resolve referred_by from referrer's UUID to their referral_code
    let referred_by = null;
    if (rawReferredBy && uuidMap.has(rawReferredBy)) {
      referred_by = uuidMap.get(rawReferredBy).referral_code;
    }

    // API Key
    let api_key = rawApiKey;
    if (!api_key) {
      api_key = nanoid(32);
    }

    // Password Hash
    let password_hash = rawPasswordHash;
    if (defaultPassword) {
      const bcrypt = require("bcryptjs");
      password_hash = bcrypt.hashSync(defaultPassword, 12);
    }

    // Notes
    let notes = `[Imported from SMSCandy] UUID: ${origId}`;
    if (phone) notes += ` | Phone: ${phone}`;
    if (rawTelegramChatId) notes += ` | Telegram: ${rawTelegramChatId}`;
    if (rawTier && rawTier !== "free") notes += ` | Tier: ${rawTier}`;
    if (rawWebhookUrl) notes += ` | Webhook: ${rawWebhookUrl}`;

    const userObj = {
      username,
      email,
      password_hash,
      display_name: rawName || username,
      phone: phone || "",
      telegram_chat_id: rawTelegramChatId || "",
      avatar_color: getRandomColor(),
      avatar_url: getRandomAvatar(),
      balance: rawBalance,
      is_banned: false,
      is_admin: rawIsAdmin,
      total_spent: 0,
      total_orders: 0,
      notes,
      api_key,
      currency: "INR",
      referral_code,
      referred_by,
      referral_count: 0,
      referral_earnings: 0,
      has_deposited: rawBalance > 0,
      discounts: [],
      createdAt: rawCreatedAt,
      updatedAt: new Date(),
      _smscandy_uuid: origId // Kept for reference
    };

    emailMap.set(email, userObj);
    convertedUsers.push(userObj);
  }

  // Second pass: Calculate referral_count for referrers
  const refCountMap = {};
  for (const u of convertedUsers) {
    if (u.referred_by) {
      refCountMap[u.referred_by] = (refCountMap[u.referred_by] || 0) + 1;
    }
  }
  for (const u of convertedUsers) {
    if (refCountMap[u.referral_code]) {
      u.referral_count = refCountMap[u.referral_code];
    }
  }

  return convertedUsers;
}

/**
 * Exports converted users to a JSON file (clean for mongoimport or inspection)
 */
function exportToJson(users, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const cleanUsers = users.map(u => {
    const copy = { ...u };
    delete copy._smscandy_uuid;
    return copy;
  });

  fs.writeFileSync(outputPath, JSON.stringify(cleanUsers, null, 2), "utf8");
  return outputPath;
}

/**
 * Exports converted users to a SQL file for MySQL / Sequelize
 */
function exportToSql(users, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const escapeSql = (str) => {
    if (str === null || str === undefined) return "NULL";
    if (typeof str === "boolean") return str ? 1 : 0;
    if (typeof str === "number") return str;
    if (str instanceof Date) return `'${str.toISOString().slice(0, 19).replace("T", " ")}'`;
    return `'${String(str).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
  };

  const lines = [
    "-- Converted Users from SMSCandy Database Backup",
    "-- Target Schema: otpsite-redesign Users table (MySQL / Sequelize)",
    `-- Generated At: ${new Date().toISOString()}`,
    `-- Total Users: ${users.length}`,
    "",
    "START TRANSACTION;",
    ""
  ];

  for (const u of users) {
    const discountsJson = JSON.stringify(u.discounts || []);
    const sql = `INSERT INTO \`Users\` (\`username\`, \`email\`, \`password_hash\`, \`display_name\`, \`phone\`, \`telegram_chat_id\`, \`avatar_color\`, \`avatar_url\`, \`balance\`, \`is_banned\`, \`is_admin\`, \`total_spent\`, \`total_orders\`, \`notes\`, \`api_key\`, \`currency\`, \`referral_code\`, \`referred_by\`, \`referral_count\`, \`referral_earnings\`, \`has_deposited\`, \`discounts\`, \`createdAt\`, \`updatedAt\`)
VALUES (${escapeSql(u.username)}, ${escapeSql(u.email)}, ${escapeSql(u.password_hash)}, ${escapeSql(u.display_name)}, ${escapeSql(u.phone)}, ${escapeSql(u.telegram_chat_id)}, ${escapeSql(u.avatar_color)}, ${escapeSql(u.avatar_url)}, ${u.balance}, ${u.is_banned ? 1 : 0}, ${u.is_admin ? 1 : 0}, ${u.total_spent}, ${u.total_orders}, ${escapeSql(u.notes)}, ${escapeSql(u.api_key)}, ${escapeSql(u.currency)}, ${escapeSql(u.referral_code)}, ${escapeSql(u.referred_by)}, ${u.referral_count}, ${u.referral_earnings}, ${u.has_deposited ? 1 : 0}, ${escapeSql(discountsJson)}, ${escapeSql(u.createdAt)}, ${escapeSql(u.updatedAt)})
ON DUPLICATE KEY UPDATE \`balance\` = VALUES(\`balance\`), \`display_name\` = VALUES(\`display_name\`), \`phone\` = VALUES(\`phone\`), \`notes\` = VALUES(\`notes\`), \`is_admin\` = VALUES(\`is_admin\`), \`updatedAt\` = VALUES(\`updatedAt\`);`;
    lines.push(sql);
  }

  lines.push("");
  lines.push("COMMIT;");
  lines.push("");

  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
  return outputPath;
}

/**
 * Imports converted users directly into the configured database (MongoDB or MySQL)
 */
async function importToDatabase(users, options = {}) {
  const { connectDB, DB_TYPE } = require("./db");
  const User = require("../models/User");

  console.log(`🔌 Connecting to database (${DB_TYPE})...`);
  await connectDB();

  let imported = 0;
  let updated = 0;
  let failed = 0;

  console.log(`🚀 Importing ${users.length} users into ${DB_TYPE.toUpperCase()}...`);

  if (DB_TYPE === "mysql") {
    for (const u of users) {
      try {
        const cleanUser = { ...u };
        delete cleanUser._smscandy_uuid;
        cleanUser.discounts = JSON.stringify(cleanUser.discounts || []);

        const existing = await User.findOne({ where: { email: u.email } });
        if (existing) {
          await existing.update({
            balance: u.balance,
            display_name: u.display_name,
            phone: u.phone,
            notes: u.notes,
            is_admin: u.is_admin
          });
          updated++;
        } else {
          await User.create(cleanUser);
          imported++;
        }
      } catch (err) {
        console.error(`❌ Failed to import user ${u.email}:`, err.message);
        failed++;
      }
    }
  } else {
    // MongoDB Mongoose
    for (const u of users) {
      try {
        const cleanUser = { ...u };
        delete cleanUser._smscandy_uuid;

        const res = await User.updateOne(
          { email: u.email },
          { $set: cleanUser },
          { upsert: true }
        );

        if (res.upsertedCount > 0) {
          imported++;
        } else {
          updated++;
        }
      } catch (err) {
        console.error(`❌ Failed to import user ${u.email}:`, err.message);
        failed++;
      }
    }
  }

  return { imported, updated, failed, total: users.length };
}

module.exports = {
  ensureSqlExtracted,
  parseUsersFromSql,
  convertUsers,
  exportToJson,
  exportToSql,
  importToDatabase,
  generateValidUsername
};
