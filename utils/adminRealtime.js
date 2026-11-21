// Admin streams carry invalidation signals only. Pages fetch fresh data through
// their existing authenticated APIs after a change has committed.
const clients = new Set();
let pending = null;

function notifyAdminChange() {
  if (!clients.size || pending) return;
  pending = setTimeout(() => {
    pending = null;
    for (const res of clients) {
      if (res.destroyed || res.writableEnded) {
        clients.delete(res);
        continue;
      }
      try { res.write("event: change\ndata: {}\n\n"); }
      catch { clients.delete(res); }
    }
  }, 250);
  pending.unref?.();
}

// Mount only after adminRequired. Cookie authentication keeps JWTs out of URLs.
function streamAdminChanges(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  clients.add(res);
  res.write("event: connected\ndata: {}\n\n");
  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); }
    catch { res.end(); }
  }, 25000);
  heartbeat.unref?.();
  res.on("close", () => { clearInterval(heartbeat); clients.delete(res); });
}

function trackAdminChanges(req, res, next) {
  const path = req.path;
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  const isAppWrite = isWrite && /^\/api\/(admin|user|accounts|auth|payment)(\/|$)/.test(path);
  const isPaymentCallback = /^\/api\/payment\/[^/]+\/(callback|webhook|payout-callback)$/.test(path);
  const action = req.method === "POST" ? req.body?.action : req.query?.action;
  const isGatewayWrite = path === "/stubs/handler_api.php" && ["getNumber", "setStatus"].includes(action);
  if (isAppWrite || isPaymentCallback || isGatewayWrite) {
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) notifyAdminChange();
    });
  }
  next();
}

module.exports = { notifyAdminChange, streamAdminChanges, trackAdminChanges };
