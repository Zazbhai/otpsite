const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function run() {
  try {
    console.log("🔌 Connecting to database...");
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/otp-site');
    console.log("✅ Connected.");

    const db = mongoose.connection.db;

    console.log("🛠️ Creating indexes...");

    // Services
    await db.collection('services').createIndex({ is_active: 1, name: 1 });
    await db.collection('services').createIndex({ server_id: 1 });

    // Servers
    await db.collection('servers').createIndex({ country_id: 1 });
    await db.collection('servers').createIndex({ name: 1 });

    // Orders
    await db.collection('orders').createIndex({ user_id: 1, createdAt: -1 });
    await db.collection('orders').createIndex({ status: 1 });
    await db.collection('orders').createIndex({ order_id: 1 }, { unique: true });

    // Transactions
    await db.collection('transactions').createIndex({ user_id: 1, createdAt: -1 });

    // Countries
    await db.collection('countries').createIndex({ is_active: 1, sort_order: 1 });

    // Settings
    await db.collection('settings').createIndex({ key: 1 }, { unique: true });

    console.log("✨ All indexes created successfully.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error creating indexes:", err.message);
    process.exit(1);
  }
}

run();
