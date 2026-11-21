const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log("🧪 Testing SMSCandy Services Importer...");

const dumpPath = path.resolve(__dirname, "..", "smscandy-backup", "smscandy-db.sql");
assert(fs.existsSync(dumpPath), "smscandy-db.sql backup file must exist");

// Run import-smscandy-services.js in dry-run mode via child_process
const { execSync } = require('child_process');
const output = execSync(`node import-smscandy-services.js --dry-run --sql="${dumpPath}"`, {
  cwd: path.resolve(__dirname, ".."),
  encoding: "utf8"
});

console.log("Verifying CLI dry-run output...");
assert(output.includes("Found 1 provider(s) in SMSCandy"), "Should find 1 provider in dump");
assert(output.includes('Provider #6: "Server 6"'), "Should find Server 6");
assert(output.includes("Services in catalog: 1047"), "Should find 1047 services");
assert(output.includes("Pricing: Min ₹0.80 | Max ₹9.00"), "Should calculate correct price range");
assert(output.includes("Services Processed: 1047"), "Should process 1047 services");

console.log("Testing with profit margin (+₹2.50)...");
const outputProfit = execSync(`node import-smscandy-services.js --dry-run --sql="${dumpPath}" --profit=2.5`, {
  cwd: path.resolve(__dirname, ".."),
  encoding: "utf8"
});
assert(outputProfit.includes("Pricing: Min ₹3.30 | Max ₹11.50"), "Should add ₹2.50 to min and max prices");
assert(outputProfit.includes("Applied profit margin: +₹2.50"), "Should show profit margin notice");

console.log("✅ All Services Importer tests passed successfully!");
