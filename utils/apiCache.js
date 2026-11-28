// Simple in-memory cache for API responses
const apiCache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute
const MAX_ENTRIES = 100;

function getFromCache(key) {
  const cached = apiCache.get(key);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) return cached.data;
  if (cached) apiCache.delete(key);
  return null;
}

function setToCache(key, data) {
  // Search, pagination and per-user pricing create distinct keys. Expired and
  // rarely revisited entries must not remain in memory for the process lifetime.
  const cutoff = Date.now() - CACHE_TTL;
  for (const [existingKey, entry] of apiCache) {
    if (entry.timestamp <= cutoff) apiCache.delete(existingKey);
  }
  apiCache.delete(key);
  if (apiCache.size >= MAX_ENTRIES) apiCache.delete(apiCache.keys().next().value);
  apiCache.set(key, { data, timestamp: Date.now() });
}

function clearCache(keyPattern) {
  if (!keyPattern) {
    apiCache.clear();
    return;
  }
  
  for (const key of apiCache.keys()) {
    if (key.includes(keyPattern)) {
      apiCache.delete(key);
    }
  }
}

module.exports = {
  getFromCache,
  setToCache,
  clearCache
};
