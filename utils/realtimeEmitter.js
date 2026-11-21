/**
 * realtimeEmitter.js
 * ─────────────────────────────────────────────────
 * Singleton store for Socket.io instance and helpers
 * to emit events from anywhere in the server.
 */

let io = null;

/**
 * Initialize Socket.io
 * @param {import('socket.io').Server} socketIoInstance
 */
function init(socketIoInstance) {
  io = socketIoInstance;

  io.on('connection', (socket) => {
    // Verify the JWT token from the client handshake query, NOT raw userId
    const token = socket.handshake.query.token;
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const verifiedUserId = String(decoded.user_id || decoded.id);
        socket.join(`user:${verifiedUserId}`);
        socket.__userId = verifiedUserId;
      } catch {
        // Invalid token — join anonymous room only, no order events
        socket.join('anonymous');
      }
    } else {
      socket.join('anonymous');
    }

    socket.on('disconnect', () => {
      // Socket.io handles room cleanup automatically
    });
  });
}

/**
 * Send an event to a specific user's connections.
 */
function emitToUser(userId, event, data = {}) {
  if (["order", "balance", "wallet_update"].includes(event)) {
    require("./adminRealtime").notifyAdminChange();
  }
  // 1. Socket.io
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }

  // 2. SSE (Server-Sent Events) fallback
  try {
    const auth = require("../routes/auth");
    if (auth && typeof auth.ssePush === "function") {
      auth.ssePush(userId, event, data);
    }
  } catch (e) {
    // auth route might not be loaded yet or cyclic dependency avoided by require() in fn
  }
}

/**
 * Broadcast an event to ALL connected clients.
 */
function emitToAll(event, data = {}) {
  // 1. Socket.io
  if (io) {
    io.emit(event, data);
  }

  // 2. SSE Fallback
  try {
    const auth = require("../routes/auth");
    if (auth && typeof auth.ssePushAll === "function") {
      auth.ssePushAll(event, data);
    }
  } catch (e) {
    // Cyclic dependency guard
  }
}

/**
 * Returns total connected client count (for debugging).
 */
async function clientCount() {
  if (!io) return 0;
  const sockets = await io.fetchSockets();
  return sockets.length;
}

// Keepalive ping every 20s (Socket.io has built-in heartbeats, but this is for custom UI)
setInterval(() => {
  emitToAll('ping', { t: Date.now() });
}, 20000);

module.exports = { init, emitToUser, emitToAll, clientCount };
