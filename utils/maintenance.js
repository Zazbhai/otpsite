// Using shared settings cache instead of direct Setting queries to ensure consistency

let cachedMaintenance = false;
let lastCheck = 0;

/**
 * Checks if maintenance mode is enabled in the settings.
 * Caches the result for 10 seconds to avoid database overhead.
 */
const { getCachedSettings } = require("./settingsCache");

/**
 * Checks if maintenance mode is enabled in the settings.
 * Now uses the shared settings cache for instant updates when settings change.
 */
async function isMaintenanceOn() {
  try {
    const settings = await getCachedSettings();
    const value = settings.maintenance_mode;
    
    // Explicitly check for falsy values to avoid "stuck" states
    if (value === false || value === "false" || value === 0 || value === "0" || value === undefined || value === null) {
      return false;
    }
    
    // Otherwise, check for truthy indicators
    return value === true || value === "true" || value === 1 || value === "1";
  } catch (err) {
    console.error("[Maintenance] Error checking status:", err.message);
    return false;
  }
}

module.exports = { isMaintenanceOn };
