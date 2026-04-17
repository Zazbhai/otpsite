/**
 * realtimeEmitter.js
 * ─────────────────────────────────────────────────
 * Singleton store for active SSE clients + helpers
 * to emit events from anywhere in the server.
 *
 * Event types (string):
 *   "balance"   – user balance changed         { userId, balance }
 *   "order"     – order status/OTP updated     { userId, orderId, status, otp }
 *   "settings"  – site settings changed        {}
 *   "ping"      – keepalive (no data needed)   {}
 */

const clients = new Map(); // userId (string) → Set<res>
const anonClients = new Set(); // unauthenticated SSE connections

/**
 * Register an SSE client response object.
 * @param {string|null} userId
 * @param {import('express').Response} res
 */
function addClient(userId, res) {
  if (userId) {
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(res);
  } else {
    anonClients.add(res);
  }
}

/**
 * Remove an SSE client response object.
 */
function removeClient(userId, res) {
  if (userId) {
    const set = clients.get(userId);
    if (set) {
      set.delete(res);
      if (set.size === 0) clients.delete(userId);
    }
  } else {
    anonClients.delete(res);
  }
}

/**
 * Send an SSE event to a specific user's connections.
 * @param {string} userId
 * @param {string} event
 * @param {object} data
 */
function emitToUser(userId, event, data = {}) {
  const set = clients.get(String(userId));
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  set.forEach(res => {
    try { res.write(payload); } catch (_) {}
  });
}

/**
 * Broadcast an event to ALL connected clients (auth + anon).
 * @param {string} event
 * @param {object} data
 */
function emitToAll(event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(set => set.forEach(res => {
    try { res.write(payload); } catch (_) {}
  }));
  anonClients.forEach(res => {
    try { res.write(payload); } catch (_) {}
  });
}

/**
 * Returns total connected client count (for debugging).
 */
function clientCount() {
  let n = anonClients.size;
  clients.forEach(s => { n += s.size; });
  return n;
}

// Keepalive ping every 20s to prevent proxy timeouts
setInterval(() => {
  emitToAll('ping', { t: Date.now() });
}, 20000);

module.exports = { addClient, removeClient, emitToUser, emitToAll, clientCount };
