const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  parseUsersFromSql,
  convertUsers,
  generateValidUsername,
  exportToJson,
  exportToSql
} = require("../utils/smscandyConverter");

async function runTests() {
  console.log("🧪 Running Converter Test Suite...");

  // 1. Test username generator
  const used = new Set();
  const u1 = generateValidUsername("John Doe", "john@example.com", used);
  assert.strictEqual(u1, "johndoe");
  assert(/^[a-zA-Z0-9_]{3,30}$/.test(u1));

  // Test collision handling
  const u2 = generateValidUsername("John Doe", "john2@example.com", used);
  assert.strictEqual(u2, "johndoe_1");

  // Test fallback to email
  const u3 = generateValidUsername("!#$", "super_coder@gmail.com", used);
  assert.strictEqual(u3, "super_coder");

  console.log("✅ Username generator tests passed");

  // 2. Test SQL Parsing on backup file
  const sqlPath = path.join(__dirname, "..", "smscandy-backup", "smscandy-db.sql");
  if (fs.existsSync(sqlPath)) {
    const rawUsers = await parseUsersFromSql(sqlPath);
    assert.strictEqual(rawUsers.length, 190, "Expected exactly 190 raw user records from backup");
    console.log("✅ SQL Parser extracted all 190 raw rows correctly");

    // 3. Test Conversion
    const converted = convertUsers(rawUsers);
    assert.strictEqual(converted.length, 188, "Expected 188 unique users after deduplication");

    // Verify all records conform to schema
    const emailSet = new Set();
    const usernameSet = new Set();
    let totalBal = 0;

    for (const u of converted) {
      assert(u.username && /^[a-zA-Z0-9_]{3,30}$/.test(u.username), `Invalid username: ${u.username}`);
      assert(u.email && u.email.includes("@"), `Invalid email: ${u.email}`);
      assert(!emailSet.has(u.email), `Duplicate email detected: ${u.email}`);
      assert(!usernameSet.has(u.username), `Duplicate username detected: ${u.username}`);
      emailSet.add(u.email);
      usernameSet.add(u.username);
      assert(typeof u.balance === "number" && !isNaN(u.balance), `Invalid balance for ${u.email}`);
      totalBal += u.balance;
      assert(u.password_hash && u.password_hash.startsWith("pbkdf2$"), `Invalid password hash for ${u.email}`);
      assert(Array.isArray(u.discounts), `Discounts should be an array`);
      assert(typeof u.is_admin === "boolean");
      assert(u.currency === "INR");
    }

    assert(Math.abs(totalBal - 1153694.49) < 0.01, `Total balance mismatch: got ${totalBal}`);
    console.log("✅ Schema validation and balance integrity check passed");

    // 4. Test Exports
    const testJson = path.join(__dirname, "..", "scratch", "test_out.json");
    const testSql = path.join(__dirname, "..", "scratch", "test_out.sql");
    exportToJson(converted, testJson);
    exportToSql(converted, testSql);

    assert(fs.existsSync(testJson) && fs.statSync(testJson).size > 1000);
    assert(fs.existsSync(testSql) && fs.statSync(testSql).size > 1000);
    console.log("✅ Export to JSON and SQL tests passed");
  }

  console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY!");
}

runTests().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
