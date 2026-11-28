const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runMongoTransaction } = require("../utils/mongoTransaction");

const conflict = () => Object.assign(new Error("Write conflict"), { code: 112, codeName: "WriteConflict" });
const unknownCommit = () => Object.assign(new Error("Commit result unknown"), { errorLabels: ["UnknownTransactionCommitResult"] });

function database({ onCommit, onAbort, cleanupError = false } = {}) {
  let committed = { balance: 6, refunded: false, otp: "", ledger: [] };
  const sessions = [], waits = [];
  const startSession = async () => {
    const session = {
      active: false, ends: 0, aborts: 0, commits: 0,
      startTransaction() { this.active = true; this.draft = structuredClone(committed); },
      inTransaction() { return this.active; },
      async abortTransaction() { this.aborts++; this.active = false; onAbort?.(committed, this); },
      async commitTransaction() {
        this.commits++;
        if (await onCommit?.(this, sessions.length)) return;
        committed = structuredClone(this.draft); this.active = false;
      },
      async endSession() { this.ends++; if (cleanupError) throw new Error("Cleanup error"); },
    };
    sessions.push(session);
    return session;
  };
  return { startSession, wait: async attempt => { waits.push(attempt); }, sessions, waits, state: () => committed };
}

test("write-conflict retries restart all reads and credit a refund exactly once", async () => {
  const db = database();
  let calls = 0;
  const result = await runMongoTransaction(db.startSession, async session => {
    calls++;
    assert.equal(session.draft.balance, 6);
    session.draft.balance += 4;
    session.draft.refunded = true;
    session.draft.ledger.push("ORDER-REFUND:one");
    if (calls < 3) throw conflict();
    return { balance: session.draft.balance };
  }, db.wait);
  assert.equal(result.balance, 10);
  assert.equal(db.state().balance, 10);
  assert.deepEqual(db.state().ledger, ["ORDER-REFUND:one"]);
  assert.deepEqual(db.waits, [0, 1]);
  assert.deepEqual(db.sessions.map(session => session.aborts), [1, 1, 0]);
  assert.ok(db.sessions.every(session => session.ends === 1));
});

test("a retry observes an OTP committed concurrently and stops the refund", async () => {
  const db = database({ onAbort: state => { state.otp = "001234"; } });
  let calls = 0;
  const result = await runMongoTransaction(db.startSession, async session => {
    calls++;
    if (session.draft.otp) return { refunded: false };
    session.draft.balance += 4;
    throw conflict();
  }, db.wait);
  assert.equal(result.refunded, false);
  assert.equal(calls, 2);
  assert.equal(db.state().balance, 6);
  assert.equal(db.state().otp, "001234");
});

test("transient commit failures retry a fresh transaction instead of returning an uncommitted result", async () => {
  const db = database({ onCommit: (_, count) => { if (count === 1) throw conflict(); } });
  let callbacks = 0;
  const result = await runMongoTransaction(db.startSession, async session => {
    callbacks++;
    session.draft.balance += 4;
    return session.draft.balance;
  }, db.wait);
  assert.equal(result, 10);
  assert.equal(callbacks, 2);
  assert.equal(db.state().balance, 10);
});

test("unknown commits retry commit on the same session without rerunning the wallet operation", async () => {
  const db = database({ onCommit: session => { if (session.commits === 1) throw unknownCommit(); } });
  let callbacks = 0;
  await runMongoTransaction(db.startSession, async session => { callbacks++; session.draft.balance += 4; }, db.wait);
  assert.equal(callbacks, 1);
  assert.equal(db.sessions.length, 1);
  assert.equal(db.sessions[0].commits, 2);
  assert.equal(db.state().balance, 10);
});

test("persistent ambiguous commits are surfaced without replaying or aborting the callback", async () => {
  const db = database({ onCommit: () => { throw unknownCommit(); } });
  let callbacks = 0;
  await assert.rejects(runMongoTransaction(db.startSession, async () => { callbacks++; }, db.wait), /Commit result unknown/);
  assert.equal(callbacks, 1);
  assert.equal(db.sessions[0].commits, 6);
  assert.equal(db.sessions[0].aborts, 0);
  assert.equal(db.sessions[0].ends, 1);
});

test("an error after an uncertain commit never restarts the wallet callback", async () => {
  const db = database({ onCommit: session => { throw session.commits === 1 ? unknownCommit() : conflict(); } });
  let callbacks = 0;
  await assert.rejects(runMongoTransaction(db.startSession, async () => { callbacks++; }, db.wait), /Write conflict/);
  assert.equal(callbacks, 1);
  assert.equal(db.sessions.length, 1);
});

test("persistent conflicts stop after six attempts and leave no partial balance changes", async () => {
  const db = database();
  await assert.rejects(runMongoTransaction(db.startSession, async session => {
    session.draft.balance += 4;
    throw conflict();
  }, db.wait), /Write conflict/);
  assert.equal(db.sessions.length, 6);
  assert.equal(db.waits.length, 5);
  assert.equal(db.state().balance, 6);
  assert.ok(db.sessions.every(session => session.ends === 1 && session.aborts === 1));
});

test("business and duplicate-key errors propagate without retrying financial writes", async () => {
  for (const error of [new Error("INSUFFICIENT_BALANCE"), Object.assign(new Error("Duplicate reference"), { code: 11000 })]) {
    const db = database();
    await assert.rejects(runMongoTransaction(db.startSession, async () => { throw error; }, db.wait), value => value === error);
    assert.equal(db.sessions.length, 1);
    assert.equal(db.waits.length, 0);
  }
});

test("transient labels from the driver, wire response and serialized errors are recognized", async () => {
  for (const properties of [{ hasErrorLabel: label => label === "TransientTransactionError" },
    { errorLabelSet: new Set(["TransientTransactionError"]) },
    { errorResponse: { errorLabels: ["TransientTransactionError"] } }]) {
    const db = database();
    let calls = 0;
    await runMongoTransaction(db.startSession, async () => {
      if (++calls === 1) throw Object.assign(new Error("Transient"), properties);
    }, db.wait);
    assert.equal(calls, 2);
  }
});

test("session cleanup failure cannot turn a committed refund into a failed operation", async t => {
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args));
  const db = database({ cleanupError: true });
  let callbacks = 0;
  const result = await runMongoTransaction(db.startSession, async session => {
    callbacks++;
    session.draft.balance += 4;
    return "committed";
  }, db.wait);
  assert.equal(result, "committed");
  assert.equal(callbacks, 1);
  assert.equal(db.state().balance, 10);
  assert.equal(logged.length, 1);
});
