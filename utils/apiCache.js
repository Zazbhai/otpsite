// Simple in-memory cache for API responses
const apiCache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute

function getFromCache(key) {
  const cached = apiCache.get(key);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) return cached.data;
  return null;
}

function setToCache(key, data) {
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
