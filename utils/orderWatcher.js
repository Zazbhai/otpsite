const Order = require("../models/Order");
const { syncOrder } = require("./orderStatusManager");

/**
 * Background watcher that periodically synchronizes all active orders.
 * This ensures that even if a user leaves the page, we still capture their OTP or handle refunds.
 */
function startWatcher() {
  console.log("🕒 Order Monitor: Background service started.");

  let isRunning = false;

  // Run every 10 seconds (faster response for users)
  setInterval(async () => {
    if (isRunning) return; // Prevent overlapping runs
    isRunning = true;

    try {
      const now = new Date();
      const { Op } = require("sequelize");
      const { DB_TYPE } = require("./db");

      // Optimization: Fetch ONLY active orders that are due for a check
      // This prevents loading thousands of orders into memory just to filter them
      let dueOrders;
      if (DB_TYPE === "mysql") {
          // MySQL/Sequelize logic
          dueOrders = await Order.findAll({
              where: {
                  status: "active",
                  [Op.or]: [
                      { last_check_at: null },
                      { last_check_at: { [Op.lte]: new Date(now.getTime() - 3000) } } // Use small default if check_interval is missing
                  ]
              },
              // Project only fields needed for syncOrder to save memory
              attributes: ['id', 'order_id', 'user_id', 'status', 'external_order_id', 'server_name', 'check_interval', 'last_check_at', 'expires_at', 'min_cancel_at', 'cost', 'multi_otp_enabled', 'otp', 'all_otps']
          });
      } else {
          // MongoDB logic
          dueOrders = await Order.find({
              status: "active",
              $or: [
                  { last_check_at: { $exists: false } },
                  { last_check_at: { $lte: new Date(now.getTime() - 3000) } }
              ]
          });
      }

      if (dueOrders.length === 0) {
        isRunning = false;
        return;
      }

      console.log(`🕒 Order Monitor: Syncing ${dueOrders.length} due orders...`);

      // Process up to 10 orders in parallel to speed up the loop without crashing the API
      const CONCURRENCY = 10;
      for (let i = 0; i < dueOrders.length; i += CONCURRENCY) {
        const batch = dueOrders.slice(i, i + CONCURRENCY);
        await Promise.allSettled(batch.map(order => syncOrder(order)));
      }
    } catch (err) {
      console.error("[Order Monitor] Global loop error:", err.message);
    } finally {
      isRunning = false;
    }
  }, 10000); 
}

module.exports = { startWatcher };
