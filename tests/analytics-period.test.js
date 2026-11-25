const assert = require("node:assert/strict");
const { test } = require("node:test");
const { resolveAnalyticsPeriod, dateKeyInZone } = require("../utils/analyticsPeriod");

test("analytics uses Asia/Calcutta midnight boundaries", () => {
  const now = new Date("2026-11-22T18:29:59.000Z");
  assert.equal(dateKeyInZone(now), "2026-11-22");
  const today = resolveAnalyticsPeriod({ range: "today" }, now);
  assert.equal(today.date, "2026-11-22");
  assert.equal(today.start.toISOString(), "2026-11-21T18:30:00.000Z");
  assert.equal(today.end.toISOString(), "2026-11-22T18:30:00.000Z");
});

test("analytics supports yesterday and explicit dates", () => {
  const now = new Date("2026-11-22T18:30:00.000Z");
  const yesterday = resolveAnalyticsPeriod({ range: "yesterday" }, now);
  assert.equal(yesterday.date, "2026-11-22");
  assert.equal(yesterday.label, "Yesterday");
  const selected = resolveAnalyticsPeriod({ range: "date", date: "2026-11-01" }, now);
  assert.equal(selected.date, "2026-11-01");
  assert.equal(selected.start.toISOString(), "2026-10-31T18:30:00.000Z");
  assert.throws(() => resolveAnalyticsPeriod({ range: "date", date: "2026-02-31" }, now), /Invalid analytics date/);
});

test("analytics all-time period has no date bounds", () => {
  const all = resolveAnalyticsPeriod({ range: "all" }, new Date("2026-11-23T10:00:00.000Z"));
  assert.equal(all.key, "all");
  assert.equal(all.label, "All time");
  assert.equal(all.start, null);
  assert.equal(all.end, null);
});
