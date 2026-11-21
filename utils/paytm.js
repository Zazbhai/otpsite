const fs = require('fs');
const path = require('path');

console.log("🚀 [Paytm System] Loaded Version 5.0 (Strict Status Check)");

/**
 * Load payment configuration from JSON file.
 */
function loadPaymentConfig() {
  const configPath = path.join(__dirname, '..', 'payment_config.json');
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("❌ Error reading payment_config.json:", err.message);
  }
  return {};
}

function normalizePaytmDate(value) {
  const trimmedValue = value.trim();
  if (/^\d{13}$/.test(trimmedValue)) {
    return trimmedValue;
  }
  return trimmedValue;
}

function getTimezoneOffsetString(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function formatDatePart(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentMonthRange() {
  const now = new Date();
  const firstDay = formatDatePart(new Date(now.getFullYear(), now.getMonth(), 1));
  const lastDay = formatDatePart(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const timezoneOffset = getTimezoneOffsetString(now);

  return {
    startTime: `${firstDay}T00:00:00${timezoneOffset}`,
    endTime: `${lastDay}T23:59:59${timezoneOffset}`,
  };
}

/**
 * Check payment status on Paytm using UTR (bankReferenceNo).
 * @param {string|number} utr 
 */
async function paytmChecker(utr) {
  const config = loadPaymentConfig();
  const paytm = config.paytm || {};

  if (!paytm.enabled) {
    console.log("❌ Paytm is not enabled in payment_config.json");
    return { success: false, amount: 0 };
  }

  const userMid = paytm.mid;
  const userToken = paytm.token;

  if (!userMid || !userToken) {
    console.log("❌ Paytm credentials (MID/Token) not configured properly");
    return { success: false, amount: 0 };
  }

  const { startTime, endTime } = getCurrentMonthRange();
  const bankReferenceNo = utr.toString().trim();

  const data = {
    bizTypeList: ["ACQUIRING", "CASHBACK", "SPLIT_PAYMENT"],
    pageSize: 20,
    pageNum: 1,
    orderCreatedStartTime: normalizePaytmDate(startTime),
    orderCreatedEndTime: normalizePaytmDate(endTime),
    isSort: true,
    bankReferenceNo: bankReferenceNo
  };

  const PAYTM_URL = "https://dashboard.paytm.com/bff/api/v1/order/list";

  console.log("🔍 [Paytm Debug] Starting Check...");
  console.log("🔍 [Paytm Debug] MID:", userMid);
  console.log("🔍 [Paytm Debug] Token:", userToken ? (userToken.substring(0, 5) + "...") : "MISSING");
  console.log("🔍 [Paytm Debug] UTR (bankReferenceNo):", bankReferenceNo);
  console.log("🔍 [Paytm Debug] Date Range:", startTime, "to", endTime);

  try {
    const headers = {
      Host: "dashboard.paytm.com",
      Appversion: "9.23.0",
      "X-Id": "2ac8e0b076f5a3d6",
      "X-App-Rid": "2ac8e0b076f5a3d6:1756721578701:1:76",
      "X-Mfg": "Xiaomi",
      "X-Auth-Ump": "umpapp-3754-36d-aqr-cn7",
      "X-User-Token": userToken,
      "X-Nw": "WIFI",
      "X-Store": "0",
      "App-Channel": "p4b",
      "X-Sim-Sub-Id": "89911300000419316483|89918560400611467904",
      "X-Tamp": "0",
      Deviceidentifier: "Xiaomi-RedmiNote9ProMax-2ac8e0b076f5a3d6",
      "X-Clon": "0",
      Osversion: "10",
      "X-Intg-Src": "0",
      Client: "androidapp",
      "X-Loc": "0.0,0.0",
      "X-User-Mid": userMid,
      "X-Intg": "3",
      "X-Call": "0",
      "X-Model": "Redmi Note 9 Pro Max",
      "X-Locint": "true,0,true",
      "User-Agent": "Paytm Release/ 9.23.0 com.paytm.business Android",
      "Content-Type": "application/json",
    };

    console.log("🔍 [Paytm Debug] Sending Request to:", PAYTM_URL);
    // console.log("🔍 [Paytm Debug] Headers:", JSON.stringify(headers, null, 2));

    const response = await fetch(PAYTM_URL, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(data),
    });

    const responseText = await response.text();
    console.log("🔍 [Paytm Debug] Raw Response Received. Status:", response.status);

    let apiData;
    try {
      apiData = JSON.parse(responseText);
      console.log("🔍 [Paytm Debug] Parsed JSON Response:", JSON.stringify(apiData, null, 2));
    } catch {
      console.error(`❌ Paytm returned invalid JSON. HTTP status: ${response.status}. Body: ${responseText}`);
      return { success: false, amount: 0 };
    }

    if (!response.ok) {
      console.error(`❌ Paytm request failed. HTTP status: ${response.status}. Response: ${JSON.stringify(apiData)}`);
      return { success: false, amount: 0 };
    }

    const orderList = apiData?.orderList || apiData?.data?.orderList || apiData?.result || [];
    console.log(`🔍 [Paytm Debug] Orders found in list: ${orderList.length}`);
    
    if (orderList.length === 0) {
      console.log("❌ No orders found in the Paytm response.");
      return { success: false, amount: 0 };
    }

    // Find if ANY order returned is SUCCESSFUL
    // (We assume they match because we filtered by bankReferenceNo in the request)
    const foundOrder = orderList.find(order => {
      const isSuccess = order.orderStatus === "SUCCESS" || order.orderStatus === "completed";
      console.log(`🔍 [Paytm V5 DEBUG] Checking Order Status: ${order.orderStatus} | Success: ${isSuccess}`);
      return isSuccess;
    });

    if (foundOrder) {
      console.log("✅ Paytm Payment FOUND and CONFIRMED!");
      
      // Amount handling: If value is 600 and it's ₹6, then it's in Paise. 
      // We divide by 100 to get Rupees.
      let amountRaw = parseFloat(foundOrder.payMoneyAmount?.value || 0);
      let amountInRupees = amountRaw / 100;

      console.log("🔍 [Paytm Debug] Order Details:", JSON.stringify({
        id: foundOrder.bizOrderId,
        amountRaw: amountRaw,
        amountRupees: amountInRupees,
        payer: foundOrder.additionalInfo?.customerName
      }, null, 2));

      return {
        success: true,
        amount: amountInRupees,
        status: foundOrder.orderStatus,
        payer: foundOrder.additionalInfo?.customerName,
        rrn: foundOrder.additionalInfo?.rrn || foundOrder.additionalInfo?.rrnCode
      };
    } else {
      console.log("❌ Paytm Payment NOT FOUND or NOT SUCCESSFUL in order list");
      return { success: false, amount: 0 };
    }

  } catch (error) {
    console.error("❌ Paytm Error:", error.message);
    return { success: false, amount: 0 };
  }
}

module.exports = { paytmChecker };
