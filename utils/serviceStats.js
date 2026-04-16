const Order = require("../models/Order");
const Service = require("../models/Service");

/**
 * Recalculates success rate and average time for a specific service based on recent orders.
 */
async function updateServiceStats(serviceId) {
  if (!serviceId) return;

  try {
    // Get last 50 finished orders (completed or expired) to keep stats relevant but fast
    const recentOrders = await Order.find({
      service_id: serviceId,
      status: { $in: ["completed", "expired"] }
    })
    .sort({ createdAt: -1 })
    .limit(50);

    if (recentOrders.length === 0) return;

    // 1. Success Rate
    const completed = recentOrders.filter(o => o.status === "completed");
    const successRate = Math.round((completed.length / recentOrders.length) * 100);

    // 2. Average Time
    let totalSeconds = 0;
    let timedCount = 0;

    completed.forEach(order => {
      if (order.completed_at && order.createdAt) {
        const diff = (order.completed_at - order.createdAt) / 1000;
        if (diff > 0) {
          totalSeconds += diff;
          timedCount++;
        }
      }
    });

    let avgTimeStr = "2m"; // default
    if (timedCount > 0) {
      const avgSeconds = totalSeconds / timedCount;
      if (avgSeconds < 60) {
        avgTimeStr = Math.round(avgSeconds) + "s";
      } else {
        avgTimeStr = Math.round(avgSeconds / 60) + "m";
      }
    }

    // Update Service document
    await Service.findByIdAndUpdate(serviceId, {
      success_rate: successRate + "%",
      avg_time: avgTimeStr
    });

  } catch (err) {
    console.error("[Stats] Error updating service stats:", err.message);
  }
}

module.exports = { updateServiceStats };
