const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "payment_config.json");

/**
 * Loads payment config safely.
 */
function getPaymentConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch (err) {
    console.error("[PaymentBonus] Failed to read payment_config.json:", err.message);
  }
  return {};
}

/**
 * Calculates extra bonus for a deposit based on gateway settings.
 * @param {number} creditAmount - The base deposit amount in INR.
 * @param {object|string} gatewayOrConfig - Gateway key name (e.g. 'bharatpe') or gateway config object.
 * @returns {{ bonusAmount: number, totalCredit: number, bonusDesc: string, bonusEnabled: boolean, bonusType: string, bonusValue: number }}
 */
function calculateDepositBonus(creditAmount, gatewayOrConfig) {
  const base = require("./money").money(creditAmount);
  if (base <= 0) {
    return { bonusAmount: 0, totalCredit: 0, bonusDesc: "", bonusEnabled: false, bonusType: "percent", bonusValue: 0 };
  }

  let gwConfig = gatewayOrConfig;
  if (typeof gatewayOrConfig === "string") {
    const fullConfig = getPaymentConfig();
    gwConfig = fullConfig[gatewayOrConfig] || {};
  } else if (!gwConfig || typeof gwConfig !== "object") {
    gwConfig = {};
  }

  const bonusEnabled = gwConfig.bonus_enabled === true || gwConfig.bonus_enabled === "true";
  const bonusType = gwConfig.bonus_type === "flat" ? "flat" : "percent";
  const bonusValue = parseFloat(gwConfig.bonus_value) || 0;
  if (!Number.isFinite(bonusValue)) throw new Error("INVALID_AMOUNT");

  if (!bonusEnabled || bonusValue <= 0) {
    return {
      bonusAmount: 0,
      totalCredit: base,
      bonusDesc: "",
      bonusEnabled,
      bonusType,
      bonusValue
    };
  }

  let bonus = 0;
  if (bonusType === "percent") {
    bonus = parseFloat(((base * bonusValue) / 100).toFixed(2));
  } else if (bonusType === "flat") {
    bonus = parseFloat(bonusValue.toFixed(2));
  }

  const totalCredit = parseFloat((base + bonus).toFixed(2));
  const bonusDesc = bonus > 0 ? ` (+₹${bonus} Bonus)` : "";

  return {
    bonusAmount: bonus,
    totalCredit: totalCredit,
    bonusDesc: bonusDesc,
    bonusEnabled: true,
    bonusType: bonusType,
    bonusValue: bonusValue
  };
}

module.exports = {
  getPaymentConfig,
  calculateDepositBonus
};
