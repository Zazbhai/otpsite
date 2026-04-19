const Setting = require("../models/Setting");

let cachedMaintenance = false;
let lastCheck = 0;

/**
 * Checks if maintenance mode is enabled in the settings.
 * Caches the result for 10 seconds to avoid database overhead.
 */
async function isMaintenanceOn() {
  const now = Date.now();
  if (now - lastCheck < 10000) return cachedMaintenance;

  try {
    const setting = await Setting.findOne({ key: "maintenance_mode" });
    if (setting) {
      cachedMaintenance = setting.value === true || setting.value === "true";
    } else {
      cachedMaintenance = false;
    }
    lastCheck = now;
  } catch (err) {
    console.error("[Maintenance] Error checking status:", err.message);
  }
  
  return cachedMaintenance;
}

module.exports = { isMaintenanceOn };
