const MAX_ATTEMPTS = 6;

function hasLabel(error, label) {
  return Boolean(error?.hasErrorLabel?.(label) || error?.errorLabels?.includes(label) ||
    error?.errorLabelSet?.has(label) || error?.errorResponse?.errorLabels?.includes(label));
}

function isTransient(error) {
  return error?.code === 112 || error?.codeName === "WriteConflict" || hasLabel(error, "TransientTransactionError");
}

const backoff = attempt => new Promise(resolve => setTimeout(resolve,
  Math.min(200, 10 * 2 ** attempt) + Math.floor(Math.random() * 20)));

// Retry the whole transaction from fresh reads, never an individual wallet
// increment. Unknown commits are retried on the SAME session without rerunning
// the callback, since its writes may already have committed.
async function runMongoTransaction(startSession, callback, wait = backoff) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const session = await startSession();
    let retry = false;
    let commitBecameUncertain = false;
    try {
      session.startTransaction();
      const result = await callback(session);
      for (let commitAttempt = 0; ; commitAttempt++) {
        try {
          await session.commitTransaction();
          return result;
        } catch (error) {
          if (hasLabel(error, "UnknownTransactionCommitResult")) commitBecameUncertain = true;
          if (!hasLabel(error, "UnknownTransactionCommitResult") || commitAttempt >= MAX_ATTEMPTS - 1) throw error;
          await wait(commitAttempt);
        }
      }
    } catch (error) {
      // An ambiguous commit must never replay a purchase, deposit or refund.
      const unknownCommit = commitBecameUncertain || hasLabel(error, "UnknownTransactionCommitResult");
      if (!unknownCommit && session.inTransaction()) {
        try { await session.abortTransaction(); } catch (_) { /* Preserve the original database error. */ }
      }
      if (unknownCommit || !isTransient(error) || attempt >= MAX_ATTEMPTS - 1) throw error;
      retry = true;
    } finally {
      // Cleanup errors cannot turn a committed payment into a failed response.
      try { await session.endSession(); }
      catch (error) { console.error("[Mongo transaction cleanup]", error.code || error.name); }
    }
    if (retry) await wait(attempt);
  }
}

module.exports = { runMongoTransaction };
