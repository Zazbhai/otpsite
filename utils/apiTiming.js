const { randomUUID } = require("node:crypto");

// Observe slow requests without imposing a timeout or logging credentials.
function trackGatewayTiming(req, res, next) {
  if (req.path !== "/stubs/handler_api.php") return next();
  const started = Date.now(), requestId = randomUUID(), durations = {};
  let stage = "middleware", stageStarted = started, finished = false;
  const timings = () => ({ ...durations, [stage]: (durations[stage] || 0) + Date.now() - stageStarted });
  const report = outcome => {
    const action = req.method === "POST" ? req.body?.action : req.query?.action;
    console.warn("[Slow API request]", JSON.stringify({
      request_id: requestId, action: typeof action === "string" && /^[a-zA-Z]+$/.test(action) ? action : "unknown",
      outcome, stage, duration_ms: Date.now() - started, stages_ms: timings(),
    }));
  };
  req.apiTiming = { mark(name) {
    const now = Date.now();
    durations[stage] = (durations[stage] || 0) + now - stageStarted;
    stage = name; stageStarted = now;
  } };
  res.setHeader("X-Request-ID", requestId);
  const writeHead = res.writeHead;
  res.writeHead = function (...args) {
    if (!this.headersSent) this.setHeader("Server-Timing", Object.entries(timings()).map(([name, ms]) => `${name};dur=${ms}`).join(", "));
    return writeHead.apply(this, args);
  };
  const timer = setTimeout(() => report("still_pending"), 8000);
  timer.unref?.();
  res.once("finish", () => { finished = true; clearTimeout(timer); if (Date.now() - started >= 2000) report("finished"); });
  res.once("close", () => { clearTimeout(timer); if (!finished) report("client_disconnected"); });
  next();
}

module.exports = { trackGatewayTiming };
