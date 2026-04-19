const Setting = require("../models/Setting");

let cache = null;
let lastUpdate = 0;
const TTL = 60000; // 1 minute

async function getCachedSettings() {
    const now = Date.now();
    if (cache && (now - lastUpdate < TTL)) return cache;

    try {
        const keys = [
            "default_theme", "site_name", "site_logo", "site_favicon", "primary_color",
            "seo_title", "seo_description", "seo_keywords", "seo_og_image",
            "maintenance_mode", "exchange_rates", "support_contact", "support_email"
        ];
        const settings = await Setting.find({ key: { $in: keys } });
        const obj = {};
        settings.forEach(s => obj[s.key] = s.value);
        
        cache = obj;
        lastUpdate = now;
        return cache;
    } catch (e) {
        return cache || {};
    }
}

function clearSettingsCache() {
    cache = null;
}

module.exports = { getCachedSettings, clearSettingsCache };
