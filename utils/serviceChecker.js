const https = require('https');
const { getCachedSettings } = require('./settingsCache');

const SUPERASSETS_API_URL = process.env.SUPERASSETS_API_URL || 'https://superassets.in/api/v1/check';
const KEY_COOLDOWN_MS = 5000; // 1 request per 5 seconds per key rate limit

// In-memory state tracking per API key for cooldown and rate limit management
const keyStateMap = new Map();

// 20 Supported Services
const SUPPORTED_SERVICES = [
  'gosats',
  'bigbasket',
  'meesho',
  'plutos',
  'starexch',
  'swiggy',
  'flipkart',
  'shein',
  'myntra',
  'oyo',
  'mantrimall',
  'blinkit',
  'brevistay',
  'ajio',
  'amazon',
  'jio',
  'crownit',
  'telegram',
  'whatsapp',
  'habuildyoga'
];

// Human-friendly Display Names
const SERVICE_DISPLAY_NAMES = {
  gosats: 'GoSats',
  bigbasket: 'BigBasket',
  meesho: 'Meesho',
  plutos: 'Plutos',
  starexch: 'StarExch',
  swiggy: 'Swiggy',
  flipkart: 'Flipkart',
  shein: 'Shein',
  myntra: 'Myntra',
  oyo: 'OYO',
  mantrimall: 'MantriMall',
  blinkit: 'Blinkit',
  brevistay: 'BreviStay',
  ajio: 'Ajio',
  amazon: 'Amazon',
  jio: 'Jio',
  crownit: 'Crownit',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  habuildyoga: 'Habuild Yoga'
};

/**
 * Normalizes service name string to standard SuperAssets checker service key
 */
function getCheckerKey(serviceName) {
  if (!serviceName || typeof serviceName !== 'string') return null;
  const s = serviceName.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  
  if (SUPPORTED_SERVICES.includes(s)) {
    return s;
  }

  // Common aliases & variations
  if (s.includes('gosats') || s === 'sats') return 'gosats';
  if (s.includes('bigbasket') || s === 'bb') return 'bigbasket';
  if (s.includes('meesho')) return 'meesho';
  if (s.includes('plutos')) return 'plutos';
  if (s.includes('starexch') || s.includes('starexchange')) return 'starexch';
  if (s.includes('swiggy')) return 'swiggy';
  if (s.includes('flipkart') || s === 'fk') return 'flipkart';
  if (s.includes('shein')) return 'shein';
  if (s.includes('myntra')) return 'myntra';
  if (s.includes('oyo')) return 'oyo';
  if (s.includes('mantrimall') || s === 'mantri') return 'mantrimall';
  if (s.includes('blinkit') || s.includes('grofers')) return 'blinkit';
  if (s.includes('brevistay') || s.includes('brevi')) return 'brevistay';
  if (s.includes('ajio')) return 'ajio';
  // Strict Jio rule: Exclude jiomart, jiocinema, etc.
  if (s.includes('jiomart') || s.includes('jiocinema') || s.includes('jiogames') || s.includes('jiomeet') || s.includes('jiopay')) {
    return null;
  }
  if (s === 'jio' || s === 'myjio' || s === 'reliancejio' || s === 'jiosim') return 'jio';

  if (s.includes('crownit')) return 'crownit';
  if (s.includes('telegram') || s === 'tg') return 'telegram';
  if (s.includes('whatsapp') || s === 'wa') return 'whatsapp';
  if (s.includes('habuildyoga') || s.includes('habuild')) return 'habuildyoga';

  return null;
}

/**
 * Checks if a service is supported by the checker
 */
function isCheckerSupported(serviceName) {
  return getCheckerKey(serviceName) !== null;
}

/**
 * Returns formatted display name for a service
 */
function getCheckerDisplayName(serviceNameOrKey) {
  const key = getCheckerKey(serviceNameOrKey);
  if (key && SERVICE_DISPLAY_NAMES[key]) {
    return SERVICE_DISPLAY_NAMES[key];
  }
  return serviceNameOrKey || 'Service';
}

/**
 * Formats phone number to 10-digit format
 */
function normalizeMobile(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

/**
 * Helper to split and extract individual keys from strings (comma or newline separated)
 */
function parseKeyList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(k => String(k).trim()).filter(Boolean);
  }
  return String(raw)
    .split(/[\r\n,]+/)
    .map(k => k.trim())
    .filter(Boolean);
}

/**
 * Resolves all configured SuperAssets API Keys from ENV and DB Settings
 */
async function resolveApiKeys() {
  const keysSet = new Set();

  // 1. Check ENV variables
  const envKeys = process.env.CHECKER_API_KEYS || process.env.CHECKER_API_KEY || process.env.SUPERASSETS_API_KEY;
  if (envKeys) {
    parseKeyList(envKeys).forEach(k => keysSet.add(k));
  }

  // 2. Check DB cached settings
  try {
    const fetchSettings = getCachedSettings();
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 1000));
    const settings = await Promise.race([fetchSettings, timeout]);
    if (settings) {
      if (settings.checker_api_keys) {
        parseKeyList(settings.checker_api_keys).forEach(k => keysSet.add(k));
      }
      if (settings.checker_api_key) {
        parseKeyList(settings.checker_api_key).forEach(k => keysSet.add(k));
      }
    }
  } catch (e) {
    // Ignore db lookup error
  }

  return Array.from(keysSet);
}

/**
 * Gets or initializes the state tracker for an API key
 */
function getKeyState(key) {
  if (!keyStateMap.has(key)) {
    keyStateMap.set(key, {
      lastUsed: 0,
      disabledUntil: 0,
      inFlight: 0
    });
  }
  return keyStateMap.get(key);
}

/**
 * Acquires a ready API key from the pool, waiting if all are on 5s cooldown.
 * Distributes requests in parallel across available keys.
 */
async function acquireKeyFromPool(keyList, maxWaitMs = 15000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const now = Date.now();
    let bestKey = null;
    let earliestNextReady = Infinity;

    // Filter valid (non-disabled) keys and find one that is ready
    for (const key of keyList) {
      const state = getKeyState(key);

      // Skip keys temporarily disabled (e.g. 401 Unauthorized)
      if (state.disabledUntil && state.disabledUntil > now) {
        continue;
      }

      const timeSinceLast = now - state.lastUsed;
      const nextReadyTime = state.lastUsed + KEY_COOLDOWN_MS;

      if (timeSinceLast >= KEY_COOLDOWN_MS) {
        if (!bestKey || state.lastUsed < getKeyState(bestKey).lastUsed) {
          bestKey = key;
        }
      } else {
        if (nextReadyTime < earliestNextReady) {
          earliestNextReady = nextReadyTime;
        }
      }
    }

    if (bestKey) {
      const state = getKeyState(bestKey);
      state.lastUsed = Date.now(); // Mark cooldown immediately to reserve for concurrent calls
      state.inFlight += 1;
      return bestKey;
    }

    // All active keys are in cooldown. Sleep until the earliest key is ready.
    const waitTime = Math.max(50, Math.min(earliestNextReady - now + 20, 2000));
    if (Date.now() - startTime + waitTime > maxWaitMs) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  return null; // Timed out waiting for available key
}

/**
 * Releases/updates key state after a request completes
 */
function releaseKey(key, isUnauthorized = false) {
  const state = getKeyState(key);
  state.inFlight = Math.max(0, state.inFlight - 1);
  state.lastUsed = Date.now();

  if (isUnauthorized) {
    // Disable key for 60 seconds if 401 Unauthorized
    state.disabledUntil = Date.now() + 60000;
  }
}

/**
 * Low-level HTTP executor against SuperAssets API
 */
function executeApiCheck(serviceKey, mobile, apiKey) {
  return new Promise((resolve) => {
    const postPayload = JSON.stringify({
      service: serviceKey,
      number: mobile
    });

    const parsedUrl = new URL(SUPERASSETS_API_URL);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + (parsedUrl.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-api-key': apiKey,
        'Content-Length': Buffer.byteLength(postPayload),
        'User-Agent': 'RapidOTP-Checker/2.0'
      },
      timeout: 12000
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });

      res.on('end', () => {
        let parsedData = null;
        try {
          parsedData = JSON.parse(responseBody);
        } catch (e) {
          parsedData = responseBody.trim();
        }

        if (res.statusCode === 200) {
          let status = 'not_registered';

          if (typeof parsedData === 'string') {
            const lower = parsedData.toLowerCase();
            if (lower.includes('not') || lower.includes('fresh') || lower.includes('unregistered')) {
              status = 'not_registered';
            } else if (lower.includes('registered') || lower === 'valid' || lower === 'exists') {
              status = 'registered';
            }
          } else if (parsedData && typeof parsedData === 'object') {
            if (parsedData.status) {
              const s = String(parsedData.status).toLowerCase();
              status = (s.includes('not') || s.includes('fresh') || s.includes('unregistered')) ? 'not_registered' : 'registered';
            } else if (typeof parsedData.registered === 'boolean') {
              status = parsedData.registered ? 'registered' : 'not_registered';
            } else if (typeof parsedData.is_registered === 'boolean') {
              status = parsedData.is_registered ? 'registered' : 'not_registered';
            } else if (parsedData.message) {
              const m = String(parsedData.message).toLowerCase();
              status = (m.includes('not') || m.includes('fresh') || m.includes('unregistered')) ? 'not_registered' : 'registered';
            }
          }

          return resolve({
            success: true,
            statusCode: 200,
            status: status,
            data: parsedData
          });
        }

        if (res.statusCode === 401) {
          const detail = (parsedData && parsedData.detail) || 'Unauthorized';
          return resolve({
            success: false,
            statusCode: 401,
            status: 'error',
            error: `API Key Error (401): ${detail}`
          });
        }

        if (res.statusCode === 422) {
          const detail = (parsedData && parsedData.detail) ? JSON.stringify(parsedData.detail) : 'Validation Error';
          return resolve({
            success: false,
            statusCode: 422,
            status: 'error',
            error: `Validation Error (422): ${detail}`
          });
        }

        const errorMsg = (parsedData && (parsedData.detail || parsedData.message || parsedData.error)) || `API returned HTTP ${res.statusCode}`;
        return resolve({
          success: false,
          statusCode: res.statusCode,
          status: 'error',
          error: errorMsg
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        success: false,
        statusCode: 0,
        status: 'error',
        error: `Connection error: ${err.message}`
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        statusCode: 408,
        status: 'error',
        error: 'Checker API request timed out'
      });
    });

    req.write(postPayload);
    req.end();
  });
}

/**
 * High-level entry point to check any number with parallel multi-key support & 5s cooldown
 */
async function checkServiceNumber(serviceNameOrKey, rawPhone, overrideApiKey = null) {
  const serviceKey = getCheckerKey(serviceNameOrKey);
  if (!serviceKey) {
    return {
      success: false,
      status: 'unsupported',
      error: `Checker is not available for service "${serviceNameOrKey}". Supported services: ${Object.values(SERVICE_DISPLAY_NAMES).join(', ')}.`
    };
  }

  const mobile = normalizeMobile(rawPhone);
  if (!mobile || mobile.length !== 10 || isNaN(mobile)) {
    return {
      success: false,
      status: 'invalid_number',
      error: 'Please provide a valid 10-digit mobile number'
    };
  }

  // 1. Determine key pool
  let keyList = [];
  if (typeof overrideApiKey === 'string' && overrideApiKey.trim()) {
    keyList = parseKeyList(overrideApiKey);
  } else {
    keyList = await resolveApiKeys();
  }

  if (!keyList || keyList.length === 0) {
    return {
      success: false,
      service: serviceKey,
      mobile: mobile,
      status: 'error',
      error: 'SuperAssets Checker API Key is missing. Please configure CHECKER_API_KEYS in .env or Admin Settings.'
    };
  }

  // 2. Acquire an available key from the pool (handles 5s cooldown queueing & parallel allocation)
  let assignedKey = await acquireKeyFromPool(keyList, 15000);
  if (!assignedKey) {
    return {
      success: false,
      service: serviceKey,
      mobile: mobile,
      status: 'error',
      error: 'All Checker API keys are currently busy processing requests. Please retry in a few seconds.'
    };
  }

  // 3. Execute request
  let result = await executeApiCheck(serviceKey, mobile, assignedKey);
  releaseKey(assignedKey, result.statusCode === 401);

  // If 401 and we have other keys in the pool, retry once with another key
  if (result.statusCode === 401 && keyList.length > 1) {
    const nextKey = await acquireKeyFromPool(keyList, 5000);
    if (nextKey && nextKey !== assignedKey) {
      result = await executeApiCheck(serviceKey, mobile, nextKey);
      releaseKey(nextKey, result.statusCode === 401);
    }
  }

  return {
    success: result.success,
    service: serviceKey,
    serviceName: SERVICE_DISPLAY_NAMES[serviceKey] || serviceKey,
    mobile: mobile,
    status: result.status,
    error: result.error || null,
    data: result.data || null
  };
}

module.exports = {
  SUPERASSETS_API_URL,
  KEY_COOLDOWN_MS,
  SUPPORTED_SERVICES,
  SERVICE_DISPLAY_NAMES,
  getCheckerKey,
  isCheckerSupported,
  getCheckerDisplayName,
  normalizeMobile,
  parseKeyList,
  resolveApiKeys,
  checkServiceNumber
};
