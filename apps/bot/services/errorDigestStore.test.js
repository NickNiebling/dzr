const test = require("node:test");
const assert = require("node:assert/strict");
const { createErrorDigestStore } = require("./errorDigestStore");

// Transactions are serialized, and failed callbacks never commit their staged document.
function fakeDb() {
  let document = null;
  let queue = Promise.resolve();
  let failure = null;
  const ref = { path: "bot_state/error_digest" };
  return {
    collection(name) {
      assert.equal(name, "bot_state");
      return {
        doc(id) {
          assert.equal(id, "error_digest");
          return ref;
        },
      };
    },
    runTransaction(callback) {
      const run = queue.then(async () => {
        let staged;
        const result = await callback({
          async get(target) {
            assert.equal(target, ref);
            if (failure === "read") throw new Error("Firestore unavailable");
            return { exists: document !== null, data: () => structuredClone(document) };
          },
          set(target, data, options) {
            assert.equal(target, ref);
            assert.equal(options, undefined, "replace the document instead of merging nested fields");
            if (failure === "write") throw new Error("Firestore unavailable");
            staged = structuredClone(data);
          },
        });
        if (staged !== undefined) document = staged;
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
    snapshot: () => structuredClone(document),
    fail: (phase) => { failure = phase; },
  };
}

const DAY = "2026-10-25";
const NEXT_DAY = "2026-10-26";
const NOW = Date.parse("2026-10-25T08:00:00Z");
const CHANNEL = "1544209256100794378";

function summary(source = "services/example.js:12", count = 1, at = NOW) {
  return {
    total: count,
    firstAt: new Date(at).toISOString(),
    lastAt: new Date(at).toISOString(),
    groups: [{ source, count }],
    omitted: 0,
  };
}

function claim(store, overrides = {}) {
  return store.claim({ day: DAY, now: NOW, owner: "one", channelId: CHANNEL, ...overrides });
}

test("concurrent bot instances merge errors and only one claims a delivery", async () => {
  const db = fakeDb();
  const first = createErrorDigestStore(db);
  const second = createErrorDigestStore(db);
  await Promise.all([first.append(summary()), second.append(summary())]);
  const [one, two] = await Promise.all([claim(first), claim(second, { owner: "two" })]);
  assert.equal(one.summary.total, 2);
  assert.equal(one.summary.groups[0].count, 2);
  assert.equal(one.channelId, CHANNEL);
  assert.equal(two, null);
  assert.equal(await claim(first), null, "the lease also prevents re-entry by its owner");
});

test("acknowledging a sent snapshot preserves errors appended during delivery", async () => {
  const db = fakeDb();
  const store = createErrorDigestStore(db);
  await store.append(summary("services/old.js:1", 3));
  const delivery = await claim(store);
  await store.append(summary("services/new.js:2", 2, NOW + 1000));
  assert.equal(await store.acknowledge({ id: delivery.id, owner: "one", day: DAY }), true);
  assert.equal(db.snapshot().pending.total, 2);
  assert.equal(db.snapshot().delivery, null);
  assert.equal(await claim(store, { now: NOW + 60000 }), null);
  const next = await claim(store, { day: NEXT_DAY, now: NOW + 86400000 });
  assert.equal(next.summary.total, 2);
  assert.equal(next.summary.groups[0].source, "services/new.js:2");
  assert.notEqual(next.id, delivery.id);
});

test("an empty check records the day without sending late arrivals that same day", async () => {
  const db = fakeDb();
  const store = createErrorDigestStore(db);
  await store.append(null);
  assert.equal(db.snapshot(), null);
  assert.equal(await claim(store), null);
  assert.equal(db.snapshot().lastReportDay, DAY);
  await store.append(summary());
  assert.equal(await claim(createErrorDigestStore(db)), null, "the daily marker survives restart");
  const delivery = await claim(store, { day: NEXT_DAY, now: NOW + 86400000 });
  assert.equal(delivery.summary.total, 1);
});

test("a released delivery survives restart and retries in the corrected channel", async () => {
  const db = fakeDb();
  const store = createErrorDigestStore(db);
  await store.append(summary());
  const delivery = await claim(store);
  assert.equal(await store.release({ id: delivery.id, owner: "one" }), true);
  await store.append(summary("services/later.js:3"));
  const restarted = createErrorDigestStore(db);
  const retry = await claim(restarted, {
    owner: "two", day: NEXT_DAY, now: NOW + 86400000, channelId: "new-channel",
  });
  assert.deepEqual(retry, { ...delivery, channelId: "new-channel" });
  assert.equal(db.snapshot().delivery.channelId, "new-channel");
  assert.equal(await restarted.acknowledge({ id: retry.id, owner: "two", day: NEXT_DAY }), true);
  assert.equal(db.snapshot().pending.total, 1);
  assert.equal(await claim(restarted, { day: NEXT_DAY, now: NOW + 86400000 + 60000 }), null);
});

test("a crashed owner can be replaced after five minutes and cannot clear its successor's delivery", async () => {
  const db = fakeDb();
  const store = createErrorDigestStore(db);
  await store.append(summary());
  const delivery = await claim(store);
  const restarted = createErrorDigestStore(db);
  assert.equal(await claim(restarted, { owner: "two", now: NOW + 299999, channelId: "new-channel" }), null);
  assert.equal(db.snapshot().delivery.channelId, CHANNEL, "a live lease keeps its destination");
  const reclaimed = await claim(restarted, { owner: "two", now: NOW + 300000, channelId: "new-channel" });
  assert.deepEqual(reclaimed, { ...delivery, channelId: "new-channel" });
  assert.equal(await store.acknowledge({ id: delivery.id, owner: "one", day: DAY }), false);
  assert.equal(await store.release({ id: delivery.id, owner: "one" }), false);
  assert.equal(await restarted.acknowledge({ id: "wrong-delivery", owner: "two", day: DAY }), false);
  assert.equal(await restarted.release({ id: "wrong-delivery", owner: "two" }), false);
  assert.equal(db.snapshot().leaseOwner, "two");
  assert.equal(await restarted.acknowledge({ id: delivery.id, owner: "two", day: DAY }), true);
});

test("Firestore failures reject instead of authorizing a send or discarding errors", async () => {
  const db = fakeDb();
  const store = createErrorDigestStore(db);
  db.fail("write");
  await assert.rejects(store.append(summary()), /Firestore unavailable/);
  assert.equal(db.snapshot(), null);
  db.fail(null);
  await store.append(summary());
  const pending = db.snapshot();
  for (const phase of ["read", "write"]) {
    db.fail(phase);
    await assert.rejects(claim(store), /Firestore unavailable/);
    assert.deepEqual(db.snapshot(), pending);
  }
  db.fail(null);
  const delivery = await claim(store);
  const inFlight = db.snapshot();
  db.fail("write");
  await assert.rejects(store.acknowledge({ id: delivery.id, owner: "one", day: DAY }), /Firestore unavailable/);
  await assert.rejects(store.release({ id: delivery.id, owner: "one" }), /Firestore unavailable/);
  assert.deepEqual(db.snapshot(), inFlight);
});
