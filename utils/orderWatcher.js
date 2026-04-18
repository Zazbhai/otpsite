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
      // Find orders that are active
      const activeOrders = await Order.find({ status: "active" });
      if (activeOrders.length === 0) {
        isRunning = false;
        return;
      }

      // Check which orders are due for a sync based on their check_interval
      const now = new Date();
      const dueOrders = activeOrders.filter(order => {
        const lastCheck = order.last_check_at ? new Date(order.last_check_at) : new Date(0);
        const intervalMs = (order.check_interval || 3) * 1000;
        return (now.getTime() - lastCheck.getTime()) >= intervalMs;
      });

      if (dueOrders.length === 0) {
        isRunning = false;
        return;
      }

      console.log(`🕒 Order Monitor: Syncing ${dueOrders.length}/${activeOrders.length} due orders...`);

      // Process up to 10 orders in parallel to speed up the loop
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
