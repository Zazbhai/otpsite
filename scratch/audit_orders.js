const { connectDB, DB_TYPE } = require("../utils/db");
const Order = require("../models/Order");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const mongoose = require("mongoose");

async function audit() {
  console.log("🚀 Starting Order Audit & Repair...");
  await connectDB();

  // 1. Find orders that have an OTP but are marked as cancelled/expired/refunded
  // We check for both .otp and .all_otps length
  let ordersToFix = [];
  
  if (DB_TYPE === "mysql") {
    const { Op } = require("sequelize");
    ordersToFix = await Order.findAll({
      where: {
        status: { [Op.in]: ["cancelled", "expired", "refunded"] },
        [Op.or]: [
          { otp: { [Op.ne]: "" } },
          { otp: { [Op.not]: null } }
        ]
      }
    });

    // Also check JSON field for all_otps
    const allOrders = await Order.findAll({
      where: { status: { [Op.in]: ["cancelled", "expired", "refunded"] } }
    });
    const withJsonOtps = allOrders.filter(o => o.all_otps && Array.isArray(o.all_otps) && o.all_otps.length > 0);
    
    // Merge and deduplicate
    const map = new Map();
    ordersToFix.forEach(o => map.set(o.order_id, o));
    withJsonOtps.forEach(o => map.set(o.order_id, o));
    ordersToFix = Array.from(map.values());
  } else {
    ordersToFix = await Order.find({
      status: { $in: ["cancelled", "expired", "refunded"] },
      $or: [
        { otp: { $ne: "" } },
        { "all_otps.0": { $exists: true } }
      ]
    });
  }

  console.log(`🔍 Found ${ordersToFix.length} orders requiring status correction.`);

  for (const order of ordersToFix) {
    console.log(`\n📦 Processing Order: ${order.order_id}`);
    
    // A. Update Order Status
    const previousStatus = order.status;
    order.status = "completed";
    await order.save();
    console.log(`   ✅ Status updated: ${previousStatus} -> completed`);

    // B. Check for Improper Refund
    // Look for a transaction that refunded this order
    let refundTx;
    if (DB_TYPE === "mysql") {
        const { Op } = require("sequelize");
        refundTx = await Transaction.findOne({
            where: {
                order_id: order.order_id,
                type: "refund"
            }
        });
    } else {
        refundTx = await Transaction.findOne({
            order_id: order.order_id,
            type: "refund"
        });
    }

    if (refundTx) {
      console.log(`   💰 Found improper refund of ${order.cost}. Reversing...`);
      const user = await User.findById(order.user_id);
      if (user) {
        // Deduct the cost back
        user.balance = parseFloat((user.balance - order.cost).toFixed(4));
        await user.save();

        // Log the correction
        await Transaction.create({
          user_id: user._id,
          type: "deduction",
          amount: order.cost,
          balance_after: user.balance,
          description: `Correction: Order ${order.order_id} actually received OTP. Reversing improper refund.`,
          order_id: order.order_id
        });
        console.log(`   ✅ Balance corrected. New balance: ${user.balance}`);
      } else {
        console.log(`   ❌ User ${order.user_id} not found. Skipping balance correction.`);
      }
    } else {
      console.log(`   ℹ️ No refund transaction found for this order. No balance correction needed.`);
    }
  }

  console.log("\n✨ Audit complete!");
  process.exit(0);
}

audit().catch(err => {
  console.error("❌ Audit failed:", err);
  process.exit(1);
});
