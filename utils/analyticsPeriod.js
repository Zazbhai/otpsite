const DEFAULT_TIMEZONE = process.env.ADMIN_TIMEZONE || "Asia/Calcutta";

function datePartsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second || 0) };
}

function dateKeyInZone(date, timeZone = DEFAULT_TIMEZONE) {
  const p = datePartsInZone(date, timeZone);
  return [p.year, String(p.month).padStart(2, "0"), String(p.day).padStart(2, "0")].join("-");
}

function zonedMidnight(dateKey, timeZone = DEFAULT_TIMEZONE) {
  const [year, month, day] = dateKey.split("-").map(Number);
  let guess = Date.UTC(year, month - 1, day);
  for (let i = 0; i < 3; i++) {
    const local = datePartsInZone(new Date(guess), timeZone);
    const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    guess = Date.UTC(year, month - 1, day) - (localAsUtc - guess);
  }
  return new Date(guess);
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function resolveAnalyticsPeriod(query = {}, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const requestedRange = String(query.range || "today").toLowerCase();
  if (requestedRange === "all") {
    return { key: "all", label: "All time", timezone: timeZone, start: null, end: null };
  }
  const today = dateKeyInZone(now, timeZone);
  let date = query.date ? String(query.date) : today;
  if (requestedRange === "yesterday") date = addDays(today, -1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid analytics date");
  const [year, month, day] = date.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error("Invalid analytics date");
  const key = date === today ? "today" : date === addDays(today, -1) ? "yesterday" : "date";
  return { key, date, start: zonedMidnight(date, timeZone), end: zonedMidnight(addDays(date, 1), timeZone), timezone: timeZone, label: key === "today" ? "Today" : key === "yesterday" ? "Yesterday" : date };
}

module.exports = { DEFAULT_TIMEZONE, dateKeyInZone, zonedMidnight, resolveAnalyticsPeriod };
