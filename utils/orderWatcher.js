const Order = require("../models/Order");
const { syncOrder } = require("./orderStatusManager");

/**
 * Background watcher that periodically synchronizes all active orders.
 * This ensures that even if a user leaves the page, we still capture their OTP or handle refunds.
 */
function startWatcher() {
  console.log("🕒 Order Monitor: Background service started.");

  let isRunning = false;
  let lastRecoveryAt = 0;
  // Keep both a stable string key (for local de-duplication) and the native
  // database ID (ObjectId/number) used by the indexed exclusion query.
  const inFlight = new Map();
  const CONCURRENCY = 10;

  // Wake frequently, but only load orders whose indexed check time has arrived.
  setInterval(async () => {
    if (isRunning) return; // Prevent overlapping runs
    isRunning = true;

    try {
      const now = new Date();
      if (now.getTime() - lastRecoveryAt >= 60000) {
        lastRecoveryAt = now.getTime();
        await require("./wallet").recoverPendingPurchases();
        await require("./providerWebhookQueue").retryPendingCallbacks(100);
      }
      const { Op } = require("sequelize");
      const { DB_TYPE } = require("./db");
      const capacity = CONCURRENCY - inFlight.size;
      if (capacity <= 0) return;

      // Optimization: Fetch ONLY active orders that are due for a check
      // This prevents loading thousands of orders into memory just to filter them
      let dueOrders;
      if (DB_TYPE === "mysql") {
          // MySQL/Sequelize logic
          dueOrders = await Order.findAll({
              where: {
                  status: "active",
                  id: { [Op.notIn]: [...inFlight.values()] },
                  [Op.or]: [
                  { next_check_at: null },
                  { next_check_at: { [Op.lte]: now } }
                  ]
              },
              // Project only fields needed for syncOrder to save memory
              attributes: ['id', 'order_id', 'user_id', 'status', 'external_order_id', 'server_name', 'check_interval', 'last_check_at', 'next_check_at', 'expires_at', 'min_cancel_at', 'cost', 'multi_otp_enabled', 'otp', 'all_otps', 'rebuy_ignored_otps', 'verification_count', 'refund_issued'],
              order: [['next_check_at', 'ASC'], ['id', 'ASC']],
              limit: capacity,
          });
      } else {
          // MongoDB logic
          dueOrders = await Order.find({
              status: "active",
              _id: { $nin: [...inFlight.values()] },
              $or: [
                  { next_check_at: { $exists: false } },
                  { next_check_at: null },
                  { next_check_at: { $lte: now } }
              ]
          }).sort({ next_check_at: 1, _id: 1 }).limit(capacity);
      }

      if (dueOrders.length === 0) {
        isRunning = false;
        return;
      }

      console.log(`🕒 Order Monitor: Syncing ${dueOrders.length} due orders...`);

      // Let each request finish independently; one slow provider must not hold
      // the next batch or stop purchase recovery on subsequent timer ticks.
      for (const order of dueOrders) {
        const id = String(order._id || order.id);
        if (inFlight.has(id)) continue;
        const databaseId = DB_TYPE === "mysql" ? (order.id ?? order._id) : (order._id ?? order.id);
        inFlight.set(id, databaseId);
        Promise.resolve().then(() => syncOrder(order))
          .catch(err => console.error("[Order Monitor] Order sync failed:", err.message))
          .finally(() => inFlight.delete(id));
      }
    } catch (err) {
      console.error("[Order Monitor] Global loop error:", err.message);
    } finally {
      isRunning = false;
    }
  }, 3000); 
}

module.exports = { startWatcher };
