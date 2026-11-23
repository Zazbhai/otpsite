function calculateUserPrice(originalPrice, serviceName, discounts, serverId) {
  originalPrice = Number(originalPrice);
  if (!Number.isFinite(originalPrice) || originalPrice <= 0) return NaN;
  originalPrice = Math.round(originalPrice * 10000) / 10000;
  if (!Array.isArray(discounts) || !discounts.length) return originalPrice;
  
  const targetName = (serviceName || "").toString().trim().toLowerCase();
  const targetServer = serverId != null ? String(serverId) : "all";

  let bestMatch = null;
  let bestWeight = -1;

  for (const d of discounts) {
    if (!d || typeof d !== "object") continue;
    const dName = (d.service_name || "all").toString().trim().toLowerCase();
    const dServer = (d.server_id || "all").toString();

    const nameMatch = (dName === targetName);
    const nameAll = (dName === "all");
    
    const serverMatch = (dServer === targetServer);
    const serverAll = (dServer === "all");

    if ((nameMatch || nameAll) && (serverMatch || serverAll)) {
       let weight = 0;
       if (nameMatch && serverMatch) weight = 3;
       else if (serverMatch && nameAll) weight = 2;
       else if (nameMatch && serverAll) weight = 1;
       else if (nameAll && serverAll) weight = 0;
       
       if (weight > bestWeight) {
         bestWeight = weight;
         bestMatch = d;
       }
    }
  }

  if (bestMatch && Number(bestMatch.percentage) > 0) {
    if (!Number.isFinite(Number(bestMatch.percentage)) || Number(bestMatch.percentage) >= 100) return NaN;
    const discounted = originalPrice * (1 - (bestMatch.percentage / 100));
    return parseFloat(discounted.toFixed(2));
  }
  
  return originalPrice;
}

function parseDiscounts(discounts) {
  if (!discounts) return [];
  if (Array.isArray(discounts)) return discounts;
  if (typeof discounts === 'string') {
    try {
      const parsed = JSON.parse(discounts);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

module.exports = {
  calculateUserPrice,
  parseDiscounts
};
