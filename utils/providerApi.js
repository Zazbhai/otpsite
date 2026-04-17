/**
 * Provider API integration based on Master Reference Guide
 */

function buildUrl(urlTemplate, { api_key, service, country, order_id }) {
  let url = urlTemplate || "";
  if (api_key) url = url.replace(/\{api_key\}|\$api_key/g, api_key);
  if (service) url = url.replace(/\{service\}|\$service/g, service);
  if (country) url = url.replace(/\{country\}|\$country/g, country);
  if (order_id) url = url.replace(/\{order_id\}|\$order_id|\{id\}|\$id/g, order_id);
  return url;
}

async function callProvider(url, server, method = "GET") {
  const options = {
    method,
    headers: {
      "Accept": "application/json"
    }
  };

  if (server.api_uses_headers && server.api_key) {
    options.headers["Authorization"] = `Bearer ${server.api_key}`;
  }

  console.log(`\n[DEBUG] === CALLING 3RD PARTY PROVIDER ===\nMETHOD: ${method}\nURL: ${url}\nHEADERS:`, options.headers, `\n`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { text: text.trim() };
    }
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("Provider API Error:", err.message);
    if (err.name === 'AbortError') {
      return { ok: false, data: { error: "Provider request timed out" }, status: 504 };
    }
    return { ok: false, data: { error: err.message }, status: 500 };
  }
}

// 1. Get Number
async function getNumber(server, serviceCode, countryCode) {
  if (!server.api_get_number_url) return { error: "Server missing API GET url" };
  
  let url = buildUrl(server.api_get_number_url, { 
    api_key: server.api_key, 
    service: serviceCode, 
    country: countryCode 
  });
  
  const maxRetries = server.retry_count || 0;
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    if (attempt > 0) console.log(`[RETRY] Attempt ${attempt}/${maxRetries} for getNumber...`);
    
    const response = await callProvider(url, server);
    const text = response.data.text || "";
    console.log(`[DEBUG] Provider Response [Attempt ${attempt}]:`, text);

    // Standard Text Format: ACCESS_NUMBER:123456:919876543210
    if (text.startsWith("ACCESS_NUMBER:")) {
       const parts = text.split(":");
       return { api_order_id: parts[1], phone: parts[2] };
    }
    
    // JSON Alternative: {"success": true, "id": "123456", "phone": "919876543210"}
    if (response.data.id && response.data.phone) {
       return { api_order_id: response.data.id.toString(), phone: response.data.phone.toString() };
    }

    // Error responses: NO_NUMBERS, NO_BALANCE, BAD_SERVICE
    if (text === "NO_NUMBERS" || text === "BAD_SERVICE" || text === "BANNED") return { error: "Number Not Available" };
    if (text === "NO_BALANCE") return { error: "Provider account out of balance" };

    lastError = text || "Invalid response from provider";
    attempt++;
    if (attempt <= maxRetries) {
       await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
    }
  }

  return { error: lastError, url };
}

// 2. Check Status
async function checkStatus(server, api_order_id) {
  if (!server.api_check_status_url) return { error: "Server missing API Check url" };
  
  let url = buildUrl(server.api_check_status_url, { 
    api_key: server.api_key, 
    order_id: api_order_id 
  });
  
  const response = await callProvider(url, server);
  const text = response.data.text || "";

  if (text === "STATUS_WAIT_CODE" || text === "TZ_NUM_WAIT") {
     return { status: "waiting", otp: null };
  }

  if (text.startsWith("STATUS_OK:")) {
     const otp = text.split(":")[1];
     return { status: "completed", otp };
  }

  if (text === "STATUS_CANCEL") {
     return { status: "cancelled", otp: null };
  }

  return { status: "waiting", otp: null }; // Default to waiting if unrecognized, to keep polling
}

// 3. Cancel Order (setStatus=8)
async function cancelOrder(server, api_order_id) {
  if (!server.api_cancel_url) return { error: "Server missing API Cancel url" };
  
  let url = buildUrl(server.api_cancel_url, { 
    api_key: server.api_key, 
    order_id: api_order_id 
  });
  
  const response = await callProvider(url, server);
  const text = response.data.text || "";

  if (text === "ACCESS_CANCEL" || text === "ACCESS_ACTIVATION_CANCELED") {
     return { success: true };
  }

  if (text === "STATUS_OK" || text === "NO_ACTIVATION") {
     return { success: false, error: "Cannot cancel, OTP already delivered" };
  }

  return { success: response.ok, details: response.data };
}

// 4. Request Another SMS (setStatus=3)
async function retryOrder(server, api_order_id) {
  if (!server.api_cancel_url) return { error: "Server missing API Cancel/Retry url" };
  // Expected to be same endpoint as cancel but with status=3
  // Admin input can be injected or we could just use check_status_url and replace action
  // Wait, the specification states: "Admin Input: https://api.provider.com/...setStatus...status=3"
  // Let's assume there is an api_retry_url or we just alter the cancel url if it contains status=8
  let baseTemplate = server.api_cancel_url;
  if (!baseTemplate.includes("status=8") && !server.api_retry_url) {
     return { error: "Cannot determine retry URL. Please specify api_retry_url." };
  }
  
  // If no dedicated retry url, fallback to replace status=8 with status=3
  let urlTemplate = server.api_retry_url || baseTemplate.replace("status=8", "status=3");
  
  let url = buildUrl(urlTemplate, { 
    api_key: server.api_key, 
    order_id: api_order_id 
  });

  const response = await callProvider(url, server);
  const text = response.data.text || "";

  if (text === "ACCESS_RETRY_GET" || text === "STATUS_READY") {
     return { success: true };
  }

  return { success: false, error: text || "Retry failed" };
}

module.exports = {
  getNumber,
  checkStatus,
  cancelOrder,
  retryOrder
};
