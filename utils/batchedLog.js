const { Buffer } = require("node:buffer");

// One append at a time, with bounded memory if the disk cannot keep up.
function createBatchedLog(append) {
  const queue = [];
  const MAX_BYTES = 256 * 1024, MAX_LINES = 2048, BATCH_BYTES = 64 * 1024;
  let queuedBytes = 0, dropped = 0, timer = null, writing = false;

  function schedule() {
    if (timer || writing || (!queue.length && !dropped)) return;
    timer = setTimeout(flush, 100);
    timer.unref?.();
  }

  function flush() {
    timer = null;
    let batch = dropped ? `[Log buffer] Dropped ${dropped} lines while disk writes were backed up.\n` : "";
    dropped = 0;
    let bytes = Buffer.byteLength(batch);
    while (queue.length && bytes + queue[0].bytes <= BATCH_BYTES) {
      const entry = queue.shift();
      queuedBytes -= entry.bytes;
      bytes += entry.bytes;
      batch += entry.line;
    }
    if (!batch) return;
    writing = true;
    const done = () => { writing = false; schedule(); };
    try { append(batch, done); }
    catch { done(); }
  }

  return function log(line) {
    // Bound individual provider responses too; keep each record on its own line.
    let text = String(line);
    if (text.length > 16000) text = text.slice(0, 16000) + " [truncated]\n";
    const bytes = Buffer.byteLength(text);
    if (queue.length >= MAX_LINES || queuedBytes + bytes > MAX_BYTES) dropped++;
    else { queue.push({ line: text, bytes }); queuedBytes += bytes; }
    schedule();
  };
}

module.exports = { createBatchedLog };
