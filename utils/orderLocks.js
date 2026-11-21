/**
 * Centralized, memory-efficient order lock manager.
 * Prevents race conditions and database WriteConflict errors by ensuring 
 * only one execution path can process a specific order at any given time.
 */

const activeLocks = new Set();

/**
 * Attempts to acquire an exclusive lock for a given order ID immediately.
 * @param {string} orderId 
 * @returns {boolean} True if lock was successfully acquired, false if already locked.
 */
function acquireLock(orderId) {
  if (!orderId) return false;
  const idStr = String(orderId);
  if (activeLocks.has(idStr)) {
    return false;
  }
  activeLocks.add(idStr);
  return true;
}

/**
 * Attempts to acquire an exclusive lock for a given order ID, retrying with a timeout.
 * @param {string} orderId 
 * @param {number} timeoutMs Max time to wait in milliseconds.
 * @param {number} checkIntervalMs Time between retries in milliseconds.
 * @returns {Promise<boolean>} Resolves to true if lock was acquired, false if timeout reached.
 */
async function acquireLockWithTimeout(orderId, timeoutMs = 5000, checkIntervalMs = 100) {
  if (!orderId) return false;
  const idStr = String(orderId);
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (!activeLocks.has(idStr)) {
      activeLocks.add(idStr);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
  }

  return false;
}

/**
 * Releases the exclusive lock for a given order ID.
 * @param {string} orderId 
 */
function releaseLock(orderId) {
  if (!orderId) return;
  const idStr = String(orderId);
  activeLocks.delete(idStr);
}

module.exports = { acquireLock, acquireLockWithTimeout, releaseLock };
