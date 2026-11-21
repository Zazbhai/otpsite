#!/usr/bin/env node
/**
 * SMSCandy -> OTPsite Server & Service Importer
 * 
 * Imports servers, provider credentials, service catalogs, and pricing
 * from SMSCandy (direct MySQL connection or SQL dump) into MongoDB.
 * 
 * Usage:
 *   node import-smscandy-services.js --dry-run                 (Preview import without writing to DB)
 *   node import-smscandy-services.js                           (Live import from MySQL into MongoDB)
 *   node import-smscandy-services.js --sql=<smscandy-db.sql>   (Import directly from SQL dump file)
 *   node import-smscandy-services.js --country-code=22         (Specify country code, default 22)
 *   node import-smscandy-services.js --profit=1.0              (Add +₹1.0 profit to all prices)
 *   node import-smscandy-services.js --replace                 (Replace existing services for server)
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
let mysql;
try {
  mysql = require("mysql2/promise");
} catch (e) {
  // mysql2 optional if running purely in --sql mode
}

// Models
const Server = require("./models/Server");
const Service = require("./models/Service");
const Country = require("./models/Country");

// Default SMSCandy MySQL credentials
const SMSCANDY_MYSQL = {
  host: process.env.SMSCANDY_MYSQL_HOST || process.env.MYSQL_HOST || "127.0.0.1",
  port: parseInt(process.env.SMSCANDY_MYSQL_PORT || process.env.MYSQL_PORT || "3306", 10),
  user: process.env.SMSCANDY_MYSQL_USER || process.env.MYSQL_USER || "smscandy_app",
  password: process.env.SMSCANDY_MYSQL_PASSWORD || process.env.MYSQL_PASSWORD || "c8bbcceba113371f5da5a8b0adee33cadac201675bf93fb3",
  database: process.env.SMSCANDY_MYSQL_DATABASE || process.env.MYSQL_DATABASE || "smscandy"
};

// Target MongoDB connection
const MONGO_URI = process.env.MONGO_URI;

/**
 * Generate distinct pleasant hex color for service icons based on index
 */
function getIconColor(index) {
  const hue = (index * 137.508) % 360;
  const h = hue / 360;
  const s = 0.7;
  const l = 0.5;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = t < 0 ? t + 1 : (t > 1 ? t - 1 : t);
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const r = Math.round(f(h + 1/3) * 255);
  const g = Math.round(f(h) * 255);
  const b = Math.round(f(h - 1/3) * 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Parse SQL row tuples respecting escaped quotes and JSON payloads
 */
function parseSqlTuples(sql) {
  const tuples = [];
  let inTuple = false;
  let inString = false;
  let currentTuple = [];
  let currentVal = '';
  let escape = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];

    if (!inTuple) {
      if (char === '(') {
        inTuple = true;
        currentTuple = [];
        currentVal = '';
      }
    } else {
      if (inString) {
        if (escape) {
          currentVal += char;
          escape = false;
        } else if (char === '\\') {
          escape = true;
        } else if (char === "'") {
          if (sql[i + 1] === "'") {
            currentVal += "'";
            i++;
          } else {
            inString = false;
          }
        } else {
          currentVal += char;
        }
      } else {
        if (char === "'") {
          inString = true;
        } else if (char === ',') {
          currentTuple.push(currentVal.trim() === 'NULL' ? null : currentVal.trim());
          currentVal = '';
        } else if (char === ')') {
          currentTuple.push(currentVal.trim() === 'NULL' ? null : currentVal.trim());
          tuples.push(currentTuple);
          inTuple = false;
          currentVal = '';
        } else {
          currentVal += char;
        }
      }
    }
  }
  return tuples;
}

/**
 * Extract providers and their services from SQL dump file
 */
function parseProvidersFromSql(sqlPath) {
  console.log(`📄 Reading providers from SQL file: ${sqlPath}...`);
  const content = fs.readFileSync(sqlPath, "utf8");

  const match = /INSERT INTO `providers` VALUES\s*([\s\S]*?);/g.exec(content);
  if (!match) {
    throw new Error("No `INSERT INTO \`providers\`` statement found in SQL file.");
  }

  const rows = parseSqlTuples(match[1]);
  const providers = [];

  for (const row of rows) {
    const [
      id, name, type, base_url, api_key, enabled,
      url_template, operator, services, preset, template,
      services_url, service_catalog, names_url
    ] = row;

    let catalog = [];
    if (service_catalog) {
      try {
        catalog = JSON.parse(service_catalog);
      } catch (err) {
        console.warn(`  ⚠️ Failed to parse service_catalog JSON for provider #${id}: ${err.message}`);
      }
    }

    providers.push({
      id: parseInt(id, 10),
      name: name || `Server ${id}`,
      type: type || "custom",
      base_url: base_url || "",
      api_key: api_key || "",
      enabled: enabled === "1" || enabled === 1 || enabled === true,
      url_template: url_template || "",
      operator: operator || "any",
      services_url: services_url || "",
      service_catalog: catalog
    });
  }

  return providers;
}

/**
 * Fetch providers directly from live SMSCandy MySQL
 */
async function getProvidersFromMySql() {
  if (!mysql) {
    throw new Error("mysql2 module not found. Run `npm install mysql2` or use `--sql=<path>`.");
  }
  console.log(`🔌 Connecting to SMSCandy MySQL (${SMSCANDY_MYSQL.host}:${SMSCANDY_MYSQL.port}, DB: ${SMSCANDY_MYSQL.database})...`);
  const conn = await mysql.createConnection(SMSCANDY_MYSQL);

  const [rows] = await conn.execute("SELECT * FROM providers");
  await conn.end();

  const providers = [];
  for (const r of rows) {
    let catalog = [];
    if (r.service_catalog) {
      if (typeof r.service_catalog === "string") {
        try {
          catalog = JSON.parse(r.service_catalog);
        } catch (e) {
          console.warn(`  ⚠️ Error parsing service_catalog for provider ${r.id}: ${e.message}`);
        }
      } else if (Array.isArray(r.service_catalog)) {
        catalog = r.service_catalog;
      }
    }

    providers.push({
      id: r.id,
      name: r.name || `Server ${r.id}`,
      type: r.type || "custom",
      base_url: r.base_url || "",
      api_key: r.api_key || "",
      enabled: Boolean(r.enabled),
      url_template: r.url_template || "",
      operator: r.operator || "any",
      services_url: r.services_url || "",
      service_catalog: catalog
    });
  }

  return providers;
}

/**
 * Build standard SMS-Activate / SMS handler URL templates from base_url
 */
function buildServerUrls(baseUrl) {
  if (!baseUrl) {
    return {
      api_get_number_url: "",
      api_check_status_url: "",
      api_cancel_url: "",
      api_retry_url: ""
    };
  }

  const cleanBase = baseUrl.replace(/\/+$/, "");
  const sep = cleanBase.includes("?") ? "&" : "?";

  return {
    api_get_number_url: `${cleanBase}${sep}api_key={api_key}&action=getNumber&service={service}&country={country}`,
    api_check_status_url: `${cleanBase}${sep}api_key={api_key}&action=getStatus&id={order_id}`,
    api_cancel_url: `${cleanBase}${sep}api_key={api_key}&action=setStatus&status=8&id={order_id}`,
    api_retry_url: `${cleanBase}${sep}api_key={api_key}&action=setStatus&status=3&id={order_id}`
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
SMSCandy -> OTPsite Server & Service Importer

Usage:
  node import-smscandy-services.js [options]

Options:
  --dry-run                 Preview what will be imported without touching MongoDB
  --sql=<file.sql>          Import from an SQL dump file instead of live MySQL
  --mongo=<uri>             Target MongoDB connection string (defaults to .env MONGO_URI)
  --country-code=<code>     Country code for services (defaults to 22 or detected from URL)
  --country-name=<name>     Country name to link server to (default: India)
  --profit=<number>         Extra profit margin added to all base prices (default: 0)
  --replace                 Delete existing services for imported servers before inserting
  --help, -h                Show this help screen
    `);
    process.exit(0);
  }

  const isDryRun = args.includes("--dry-run");
  const isReplace = args.includes("--replace");
  const sqlArg = args.find(a => a.startsWith("--sql="));
  const sqlFile = sqlArg ? sqlArg.split("=")[1] : null;
  const mongoArg = args.find(a => a.startsWith("--mongo="));
  const targetMongoUri = mongoArg ? mongoArg.split("=")[1] : MONGO_URI;
  const countryCodeArg = args.find(a => a.startsWith("--country-code="));
  const defaultCountryCode = countryCodeArg ? countryCodeArg.split("=")[1] : null;
  const countryNameArg = args.find(a => a.startsWith("--country-name="));
  const targetCountryName = countryNameArg ? countryNameArg.split("=")[1] : "India";
  const profitArg = args.find(a => a.startsWith("--profit="));
  const extraProfit = profitArg ? parseFloat(profitArg.split("=")[1]) || 0 : 0;

  console.log("=================================================================");
  console.log("🚀 SMSCandy -> OTPsite Server & Service Importer");
  console.log("=================================================================");

  if (isDryRun) {
    console.log("🔍 MODE: DRY RUN (Preview only, no changes saved to MongoDB)\n");
  } else {
    console.log("⚡ MODE: LIVE IMPORT\n");
  }

  // 1. Fetch SMSCandy Providers & Services
  let providers = [];
  if (sqlFile) {
    providers = parseProvidersFromSql(path.resolve(sqlFile));
  } else {
    try {
      providers = await getProvidersFromMySql();
    } catch (err) {
      console.warn(`⚠️ MySQL direct connection failed: ${err.message}`);
      // Fallback to local SQL dump if present
      const defaultDump = path.resolve(__dirname, "smscandy-backup", "smscandy-db.sql");
      if (fs.existsSync(defaultDump)) {
        console.log(`📁 Falling back to local dump: ${defaultDump}`);
        providers = parseProvidersFromSql(defaultDump);
      } else {
        console.error("❌ Could not connect to MySQL and no SQL file specified via `--sql=<path>`.");
        process.exit(1);
      }
    }
  }

  if (providers.length === 0) {
    console.log("⚠️ No providers found to import.");
    process.exit(0);
  }

  console.log(`\n📦 Found ${providers.length} provider(s) in SMSCandy.`);

  // 2. Connect to MongoDB (unless dry run without mongo)
  let mongoConnected = false;
  let countryDoc = null;

  if (!isDryRun || targetMongoUri) {
    try {
      if (!targetMongoUri) {
        throw new Error("MONGO_URI is missing in .env and not provided via --mongo=<uri>");
      }
      console.log(`🔌 Connecting to MongoDB...`);
      await mongoose.connect(targetMongoUri);
      mongoConnected = true;
      console.log("✅ MongoDB connected successfully.\n");

      // Find or create Country
      countryDoc = await Country.findOne({
        $or: [
          { name: new RegExp(`^${targetCountryName}$`, "i") },
          { code: defaultCountryCode || "22" },
          { code: "22" },
          { code: "in" },
          { code: "91" }
        ]
      });

      if (!countryDoc && !isDryRun) {
        console.log(`🌍 Creating country "${targetCountryName}" (code: ${defaultCountryCode || "22"})...`);
        countryDoc = await Country.create({
          name: targetCountryName,
          code: defaultCountryCode || "22",
          flag: "🇮🇳",
          is_active: true,
          sort_order: 1
        });
      }
    } catch (mErr) {
      if (isDryRun) {
        console.warn(`ℹ️ Note: MongoDB not connected (${mErr.message}). Dry run will preview parsed data only.\n`);
      } else {
        console.error(`❌ MongoDB connection failed: ${mErr.message}`);
        process.exit(1);
      }
    }
  }

  let totalImportedServers = 0;
  let totalImportedServices = 0;

  for (const prov of providers) {
    const slug = prov.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const urls = buildServerUrls(prov.base_url);

    // Auto-detect country code from services_url if present (e.g. country=22)
    let countryCode = defaultCountryCode || "22";
    if (!defaultCountryCode && prov.services_url) {
      const match = prov.services_url.match(/country=([a-zA-Z0-9]+)/);
      if (match) {
        countryCode = match[1];
      }
    }

    console.log(`─────────────────────────────────────────────────────────────────`);
    console.log(`🖥️  Provider #${prov.id}: "${prov.name}" (Slug: ${slug})`);
    console.log(`    Active: ${prov.enabled ? "Yes" : "No"}`);
    console.log(`    Base URL: ${prov.base_url || "(none)"}`);
    console.log(`    API Key: ${prov.api_key ? prov.api_key.substring(0, 8) + "..." : "(none)"}`);
    console.log(`    Country: ${targetCountryName} (Code: ${countryCode})`);
    console.log(`    Services in catalog: ${prov.service_catalog.length}`);

    let serverDoc = null;

    if (!isDryRun && mongoConnected) {
      const serverData = {
        name: prov.name,
        slug: slug,
        country_id: countryDoc ? countryDoc._id : undefined,
        api_key: prov.api_key || "",
        api_get_number_url: urls.api_get_number_url,
        api_check_status_url: urls.api_check_status_url,
        api_cancel_url: urls.api_cancel_url,
        api_retry_url: urls.api_retry_url,
        auto_cancel_minutes: 20,
        retry_count: 3,
        min_cancel_minutes: 2,
        is_active: prov.enabled,
        multi_otp_supported: false,
        check_interval: 3,
        services_url: prov.services_url || "",
        service_source: prov.services_url ? "url" : "json",
        extra_profit: 0
      };

      // Upsert server by name
      serverDoc = await Server.findOneAndUpdate(
        { name: prov.name },
        { $set: serverData },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      totalImportedServers++;
      console.log(`    ✅ Saved Server to MongoDB (_id: ${serverDoc._id})`);

      if (isReplace) {
        const delRes = await Service.deleteMany({ server_id: serverDoc._id });
        console.log(`    🗑️ Removed ${delRes.deletedCount} existing services for this server (--replace mode).`);
      }
    } else {
      totalImportedServers++;
    }

    // 3. Process Service Catalog
    const catalog = prov.service_catalog || [];
    if (catalog.length === 0) {
      console.log(`    ⚠️ No services in catalog for ${prov.name}. Skipping service import.`);
      continue;
    }

    const bulkOps = [];
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let priceSum = 0;

    for (let idx = 0; idx < catalog.length; idx++) {
      const item = catalog[idx];
      const code = (item.code || item.name).toLowerCase().trim();
      const name = item.name || item.code;
      const basePrice = parseFloat(item.base || item.price || 5.0);
      const finalPrice = parseFloat((basePrice + extraProfit).toFixed(2));

      if (finalPrice < minPrice) minPrice = finalPrice;
      if (finalPrice > maxPrice) maxPrice = finalPrice;
      priceSum += finalPrice;

      if (!isDryRun && mongoConnected && serverDoc) {
        bulkOps.push({
          updateOne: {
            filter: {
              server_id: serverDoc._id,
              service_code: code,
              country_code: countryCode
            },
            update: {
              $set: {
                name: name,
                price: finalPrice,
                is_active: true,
                icon_color: getIconColor(idx),
                success_rate: "95%",
                avg_time: "3s",
                check_interval: 3
              }
            },
            upsert: true
          }
        });
      }
    }

    const avgPrice = (priceSum / catalog.length).toFixed(2);
    console.log(`    📊 Pricing: Min ₹${minPrice.toFixed(2)} | Max ₹${maxPrice.toFixed(2)} | Avg ₹${avgPrice}`);
    if (extraProfit > 0) {
      console.log(`    📈 Applied profit margin: +₹${extraProfit.toFixed(2)} to all prices.`);
    }

    // Sample preview
    console.log(`    🔍 Sample Services:`);
    catalog.slice(0, 5).forEach((s, i) => {
      const p = (parseFloat(s.base || s.price || 0) + extraProfit).toFixed(2);
      console.log(`       ${i + 1}. ${s.name} (code: ${s.code}) -> ₹${p}`);
    });

    if (!isDryRun && mongoConnected && bulkOps.length > 0) {
      const BATCH_SIZE = 500;
      let insertedOrUpdated = 0;

      for (let i = 0; i < bulkOps.length; i += BATCH_SIZE) {
        const batch = bulkOps.slice(i, i + BATCH_SIZE);
        const result = await Service.bulkWrite(batch, { ordered: false });
        insertedOrUpdated += (result.upsertedCount + result.modifiedCount);
      }

      totalImportedServices += bulkOps.length;
      console.log(`    ✅ Successfully upserted ${bulkOps.length} services into MongoDB.`);
    } else {
      totalImportedServices += catalog.length;
    }
  }

  console.log(`\n=================================================================`);
  console.log(`🎉 IMPORT SUMMARY`);
  console.log(`=================================================================`);
  console.log(`Servers Processed:  ${totalImportedServers}`);
  console.log(`Services Processed: ${totalImportedServices}`);
  console.log(`Mode:               ${isDryRun ? "DRY RUN (no DB writes)" : "LIVE IMPORT (saved to DB)"}`);
  console.log(`=================================================================\n`);

  if (mongoConnected) {
    await mongoose.disconnect();
    console.log("🔌 MongoDB disconnected.");
  }

  process.exit(0);
}

main().catch(err => {
  console.error("\n❌ Fatal Error:", err);
  process.exit(1);
});
