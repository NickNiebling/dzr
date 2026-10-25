const test = require("node:test");
const assert = require("node:assert/strict");
const { createErrorDigest } = require("./errorDigest");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const state = {
    now: new Date("2026-10-25T07:00:00Z"),
    delivery: {
      id: "saved-delivery-id",
      day: "2026-10-25",
      channelId: "saved-channel",
      summary: {
        total: 2,
        firstAt: "2026-10-24T12:00:00Z",
        lastAt: "2026-10-25T06:00:00Z",
        groups: [{ source: "services/contentApi.js:53", count: 2 }],
        omitted: 0,
      },
    },
    flushes: 0, claims: [], fetched: [], sends: [], acknowledgements: [], releases: [], errors: [],
  };
  const failIf = (name) => { if (state[name]) throw new Error(name); };
  const store = {
    async claim(value) {
      state.claims.push(value);
      failIf("failClaim");
      return state.delivery;
    },
    async acknowledge(value) {
      state.acknowledgements.push(value);
      failIf("failAcknowledge");
      state.delivery = null;
    },
    async release(value) {
      state.releases.push(value);
      failIf("failRelease");
    },
  };
  const channel = {
    isSendable: () => !state.unsendable,
    async send(value) {
      state.sends.push(value);
      if (state.sendGate) await state.sendGate.promise;
      failIf("failSend");
      if (state.afterSend) state.afterSend();
    },
  };
  const client = {
    channels: {
      async fetch(id) {
        state.fetched.push(id);
        failIf("failFetch");
        return state.missingChannel ? null : channel;
      },
    },
  };
  const options = {
    getStore: () => store,
    async flush() {
      state.flushes += 1;
      if (state.flushGate) await state.flushGate.promise;
      failIf("failFlush");
    },
    channelId: "configured-channel",
    reportError: (...args) => state.errors.push(args),
    clock: () => state.now,
  };
  return { state, client, options, run: createErrorDigest(options) };
}

test("an empty daily log stays silent and never fetches Discord", async () => {
  const { state, run, client } = fixture();
  state.delivery = null;
  await run(client);
  assert.equal(state.flushes, 1);
  assert.equal(state.claims.length, 1);
  assert.equal(state.fetched.length, 0);
  assert.equal(state.sends.length, 0);
  assert.equal(state.acknowledgements.length, 0);
});

test("the reporting hour follows Copenhagen across both DST changes", async () => {
  for (const [before, due] of [
    ["2026-03-29T05:59:00Z", "2026-03-29T06:00:00Z"],
    ["2026-10-25T06:59:00Z", "2026-10-25T07:00:00Z"],
  ]) {
    const { state, run, client } = fixture();
    state.now = new Date(before);
    await run(client);
    assert.equal(state.flushes, 1, "counts are persisted before the report is due");
    assert.equal(state.claims.length, 0);
    state.now = new Date(due);
    await run(client);
    assert.equal(state.sends.length, 1);
    assert.equal(state.claims[0].day, due.slice(0, 10));
  }
});

test("a restart after the target minute catches up and uses the claimed destination", async () => {
  const { state, run, client } = fixture();
  state.now = new Date("2026-10-25T14:37:00Z");
  await run(client);
  assert.deepEqual(state.fetched, ["saved-channel"]);
  assert.equal(state.sends.length, 1);
  assert.match(state.sends[0].content, /2 fejllogninger/);
  assert.match(state.sends[0].content, /services\/contentApi\.js:53/);
  assert.deepEqual(state.sends[0].allowedMentions, { parse: [] });
  assert.equal(state.sends[0].enforceNonce, true);
  assert.ok(state.sends[0].nonce.length <= 25);
  assert.deepEqual(state.acknowledgements[0], {
    id: "saved-delivery-id", owner: state.claims[0].owner, day: "2026-10-25",
  });
  assert.equal(state.releases.length, 0);
  await run(client);
  assert.equal(state.sends.length, 1, "acknowledged delivery is not sent again");
});

test("a failed send retains the delivery for the next tick with the same nonce", async () => {
  const { state, run, client } = fixture();
  state.failSend = true;
  await run(client);
  assert.equal(state.acknowledgements.length, 0);
  assert.equal(state.releases.length, 1);
  assert.equal(state.delivery.id, "saved-delivery-id");
  state.failSend = false;
  await run(client);
  assert.equal(state.sends.length, 2);
  assert.deepEqual(state.sends[0], state.sends[1]);
  assert.equal(state.acknowledgements.length, 1);
  assert.equal(state.errors.length, 1);
});

test("a failed acknowledgement retries the same delivery after a process restart", async () => {
  const { state, run, client, options } = fixture();
  state.failAcknowledge = true;
  await run(client);
  assert.equal(state.releases.length, 1);
  assert.equal(state.delivery.id, "saved-delivery-id");
  state.failAcknowledge = false;
  const restarted = createErrorDigest(options);
  await restarted(client);
  assert.notEqual(state.claims[0].owner, state.claims[1].owner);
  assert.equal(state.sends[0].nonce, state.sends[1].nonce);
  assert.equal(state.delivery, null);
});

test("missing or unsendable channels release the lease without acknowledging", async () => {
  for (const failure of ["missingChannel", "unsendable", "failFetch"]) {
    const { state, run, client } = fixture();
    state[failure] = true;
    await run(client);
    assert.equal(state.sends.length, 0);
    assert.equal(state.acknowledgements.length, 0);
    assert.equal(state.releases.length, 1);
    assert.equal(state.errors.length, 1);
  }
});

test("overlapping scheduler ticks do not flush or send a second time", async () => {
  const { state, run, client } = fixture();
  state.flushGate = deferred();
  const first = run(client);
  await run(client);
  assert.equal(state.flushes, 1);
  state.flushGate.resolve();
  await first;
  assert.equal(state.sends.length, 1);
  assert.equal(state.claims.length, 1);
});

test("a failed flush or claim never sends an incomplete report", async () => {
  for (const failure of ["failFlush", "failClaim"]) {
    const { state, run, client } = fixture();
    state[failure] = true;
    await run(client);
    assert.equal(state.fetched.length, 0);
    assert.equal(state.acknowledgements.length, 0);
    assert.equal(state.releases.length, 0);
    state[failure] = false;
    await run(client);
    assert.equal(state.sends.length, 1, "failure does not leave the in-process guard stuck");
  }
});

test("a slow flush uses the current clock for the reporting window and lease", async () => {
  const { state, run, client } = fixture();
  state.now = new Date("2026-10-25T06:59:00Z");
  state.flushGate = deferred();
  const tick = run(client);
  state.now = new Date("2026-10-25T07:06:00Z");
  state.flushGate.resolve();
  await tick;
  assert.equal(state.sends.length, 1);
  assert.equal(state.claims[0].now, state.now.getTime());
});

test("failed lease release is reported without rejecting the scheduler tick", async () => {
  const { state, run, client } = fixture();
  state.failSend = true;
  state.failRelease = true;
  await run(client);
  assert.equal(state.errors.length, 2);
  assert.equal(state.acknowledgements.length, 0);
});

test("delivery can be disabled while counts still flush", async () => {
  const { state, client, options } = fixture();
  const run = createErrorDigest({ ...options, channelId: "" });
  await run(client);
  assert.equal(state.flushes, 1);
  assert.equal(state.claims.length, 0);
  assert.equal(state.sends.length, 0);
});

test("a send spanning Copenhagen midnight marks the completion day", async () => {
  const { state, run, client } = fixture();
  state.now = new Date("2026-10-25T22:59:59Z");
  state.afterSend = () => { state.now = new Date("2026-10-25T23:00:01Z"); };
  await run(client);
  assert.equal(state.claims[0].day, "2026-10-25");
  assert.equal(state.acknowledgements[0].day, "2026-10-26");
});
