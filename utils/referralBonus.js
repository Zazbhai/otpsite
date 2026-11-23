const User = require("../models/User");
const Setting = require("../models/Setting");
const Transaction = require("../models/Transaction");
const { emitToUser } = require("./realtimeEmitter");

/**
 * Processes referral bonuses for a deposit.
 * @param {Object} user - The user who made the deposit.
 * @param {number} amount - The deposit amount.
 * @param {boolean} hadDeposited - Whether the user had already deposited before this transaction.
 * @param {Object} queryOptions - Database query options (e.g. transaction session).
 */
async function processReferralBonus(user, amount, hadDeposited, queryOptions = {}) {
  if (!user || !user.referred_by || amount <= 0) return;

  try {
    const sEnabled = await Setting.findOne({ key: "referral_system_enabled" }, null, queryOptions);
    const isEnabled = sEnabled?.value === true || sEnabled?.value === 'true';
    if (!isEnabled) return;

    const sPercent = await Setting.findOne({ key: "referral_bonus_percent" }, null, queryOptions);
    const sFixed = await Setting.findOne({ key: "referral_bonus_fixed_amount" }, null, queryOptions);
    
    const percent = parseFloat(sPercent?.value || 0);
    const fixedAmt = parseFloat(sFixed?.value || 0);

    let totalBonus = 0;
    let bonusDesc = [];

    // 1. Percentage Bonus (recurring commission)
    if (percent > 0) {
      const pBonus = parseFloat(((amount * percent) / 100).toFixed(4));
      if (pBonus > 0) {
        totalBonus += pBonus;
        bonusDesc.push(`${percent}% commission`);
      }
    }

    // 2. Fixed Bonus (one-time on first deposit, checking the pre-update state!)
    if (fixedAmt > 0 && !hadDeposited) {
      totalBonus += fixedAmt;
      bonusDesc.push(`₹${fixedAmt} invite reward`);
    }

    if (totalBonus > 0) {
      // Atomic increment to referrer balance to avoid race conditions
      const referrer = await User.findOneAndUpdate(
        { _id: user.referred_by },
        { $inc: { balance: totalBonus, referral_earnings: totalBonus } },
        { ...queryOptions, new: true }
      );

      if (referrer) {

        const txData = {
          user_id: referrer._id || referrer.id,
          type: "bonus",
          amount: totalBonus,
          balance_after: referrer.balance,
          description: `Referral bonus from ${user.username} (${bonusDesc.join(" + ")})`,
          reference: `REF-${user._id}-${Date.now()}`
        };

        if (process.env.DB_TYPE === "mysql") {
          await Transaction.create(txData, queryOptions);
        } else {
          await Transaction.create([txData], queryOptions);
        }
        return referrer;
      }
    }
  } catch (err) {
    console.error("[ReferralBonus] Process Error:", err);
    throw err;
  }
}

module.exports = { processReferralBonus };
