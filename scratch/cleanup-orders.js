const mongoose = require('mongoose');
const Order = require('../models/Order');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to DB");

  const orders = await Order.find({ 
    status: 'active', 
    $or: [
      { otp: { $exists: true, $ne: "" } },
      { all_otps: { $exists: true, $not: { $size: 0 } } }
    ]
  });
  console.log(`Found ${orders.length} active orders with OTPs.`);

  for (const o of orders) {
    o.status = 'completed';
    await o.save();
    console.log(`Marked order ${o.order_id} as completed.`);
  }

  console.log("Cleanup finished.");
  process.exit(0);
}

run();
