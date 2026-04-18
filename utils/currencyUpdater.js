const Setting = require("../models/Setting");
const https = require("https");

// Fetch exchange rates from free open API
function fetchRates() {
  return new Promise((resolve, reject) => {
    https.get("https://api.exchangerate-api.com/v4/latest/INR", (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`API returned status ${res.statusCode}`));
          }
          const parsed = JSON.parse(data);
          resolve(parsed.rates);
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

async function updateCurrencyRates() {
  try {
    const apiRates = await fetchRates();
    if (!apiRates || !apiRates.USD) throw new Error("Invalid exchange rates from API");

    // We only need specific target rates from INR. The API returns 1 INR to Target.
    // That means price in INR * rate = display price.
    // Example from the previous hardcoded values: USD rate was 0.012. 
    // From apiRates, USD is indeed roughly 0.0119.
    const newRates = {
      INR: 1,
      USD: apiRates.USD,
      RUB: apiRates.RUB || 1.1,  // Provide fallbacks just in case
      EUR: apiRates.EUR || 0.011,
      USDT: apiRates.USD       // Use USD rate for Crypto stablecoin
    };

    await Setting.findOneAndUpdate(
      { key: "exchange_rates" },
      { value: newRates, label: "Currency Exchange Rates", group: "system" },
      { upsert: true }
    );
    console.log("[Currency Updater] Global exchange rates automatically updated from live API.");
  } catch (error) {
    console.error("[Currency Updater] Failed to update daily exchange rates:", error.message);
  }
}

function startCurrencyUpdater() {
  // Update once initially on startup, then every 24 hours
  updateCurrencyRates();
  
  // 86400000 ms = 24 hours
  setInterval(updateCurrencyRates, 86400000);
}

module.exports = { startCurrencyUpdater };
