const Order = require("../models/Order");
const { syncOrder } = require("./orderStatusManager");

/**
 * Background watcher that periodically synchronizes all active orders.
 * This ensures that even if a user leaves the page, we still capture their OTP or handle refunds.
 */
function startWatcher() {
  console.log("🕒 Order Monitor: Background service started.");

  // Run every 15 seconds
  setInterval(async () => {
    try {
      // Find orders that are active
      const activeOrders = await Order.find({ status: "active" });
      
      if (activeOrders.length === 0) return;

      console.log(`🕒 Order Monitor: Syncing ${activeOrders.length} active orders...`);

      // Process in batches or with slight delays if needed
      // For now, we'll use Promise.allSettled with a concurrency limit if it gets large,
      // but simple loop works for MVP.
      for (const order of activeOrders) {
        try {
          await syncOrder(order);
        } catch (err) {
          console.error(`[Order Monitor] Error syncing order ${order.order_id}:`, err.message);
        }
      }
    } catch (err) {
      console.error("[Order Monitor] Global loop error:", err.message);
    }
  }, 15000); 
}

module.exports = { startWatcher };
