const Setting = require("../models/Setting");

let cache = null;
let lastUpdate = 0;
let loading = null;
let generation = 0;
const TTL = 1000; // 1 second for instant-feeling updates

async function getCachedSettings() {
    const now = Date.now();
    if (cache && (now - lastUpdate < TTL)) return cache;
    if (loading) return loading;
    const requestedGeneration = generation;

    const request = (async () => { try {
        const keys = [
            "default_theme", "site_name", "site_logo", "site_favicon", "primary_color",
            "seo_title", "seo_description", "seo_keywords", "seo_og_image",
            "maintenance_mode", "exchange_rates", "support_contact", "support_email",
            "referral_system_enabled", "site_url", "branding_version", "checker_api_key", "checker_api_keys",
            "service_added_telegram_bot_token", "service_added_telegram_chat_id", "service_added_telegram_enabled"
        ];
        const settings = await Setting.find({ key: { $in: keys } });
        const obj = {};
        settings.forEach(s => obj[s.key] = s.value);
        
        if (requestedGeneration === generation) {
            cache = obj;
            lastUpdate = Date.now();
        }
        return obj;
    } catch (e) {
        return cache || {};
    } })();
    loading = request;
    try { return await request; }
    finally { if (loading === request) loading = null; }
}

function clearSettingsCache() {
    cache = null;
    loading = null;
    generation++;
}

module.exports = { getCachedSettings, clearSettingsCache };
