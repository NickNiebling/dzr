const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryDb } = require("./test-support");
const { createStore } = require("./store");
const { createStreamingService } = require("./service");
const { tokenMatches } = require("./model");

const guildId = "1195850595014299669", userId = "111111111111111111", channelId = "1196454773558345768";
const channel = { id: "UCaaaaaaaaaaaaaaaaaaaaaa", title: "DZR", url: "https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa" };
const stream = { platform: "youtube", id: "abcdefghijk", title: "Live", url: "https://www.youtube.com/watch?v=abcdefghijk", startedAt: "2026-10-27T18:00:00.000Z" };

function setup() {
  let time = Date.parse("2026-10-27T18:00:00Z");
  const db = memoryDb();
  const store = createStore(db, { now: () => time, searchBudget: 3 });
  const published = [];
  const alerts = [];
  const providers = { async resolveChannel() { return channel; }, async verify() { return { streams: [stream], state: {} }; } };
  const publisher = { async reportError(alert) { alerts.push(alert); }, async send(notice, message) { published.push({ notice, message }); return "message-id"; },
    async findExisting() { return published.length ? { complete: true, messageId: "message-id" } : { complete: true }; } };
  const options = { store, providers, publisher, guildId, channelId, now: () => time, logger: { warn() {} } };
  const service = createStreamingService(options);
  return { db, store, providers, publisher, published, alerts, options, service,
    advance(ms) { time += ms; }, now: () => time,
    enroll: () => service.enroll(userId, "Rider", { youtube: "@DZR" }),
    event: (overrides = {}) => ({ event: "started", platform: "youtube", sessionId: "session_1234567890", sequence: 1, startedAt: time, sentAt: time, ...overrides }) };
}

test("onboarding stores only a hash; testing never announces or sets last-live", async () => {
  const s = setup(); const { token } = await s.enroll();
  const registration = await s.service.getRegistration(userId);
  assert.ok(tokenMatches(token, registration.tokenHash));
  assert.ok(!JSON.stringify([...s.db.documents]).includes(token));
  await s.service.callback(token, s.event({ event: "test" }));
  await s.service.tick();
  assert.equal(s.published.length, 0);
  assert.equal((await s.service.getRegistration(userId)).lastLiveAt, null);
  assert.equal((await s.service.getRegistration(userId)).lastCallbackAt, s.now());
});

test("a verified stream is announced once across repeated callbacks, new OBS sessions and bot restarts", async () => {
  const s = setup(); const { token } = await s.enroll();
  const started = s.event();
  await s.service.callback(token, started);
  await Promise.all([s.service.tick(), s.service.tick()]);
  await s.service.callback(token, started);
  s.advance(10_000);
  await s.service.callback(token, s.event({ sessionId: "new_session_1234567890" }));
  await createStreamingService(s.options).tick();
  assert.equal(s.published.length, 1);
  assert.equal((await s.service.getRegistration(userId)).lastLiveAt, Date.parse(stream.startedAt));
  assert.equal(s.published[0].notice.channelId, channelId);
});

test("two bot workers sharing Firestore cannot announce the same stream twice", async () => {
  const s = setup(); const { token } = await s.enroll();
  await s.service.callback(token, s.event());
  await Promise.all([s.service.tick(), createStreamingService(s.options).tick()]);
  assert.equal(s.published.length, 1);
});

test("upcoming, private and offline results cannot announce even after OBS starts", async () => {
  const s = setup(); const { token } = await s.enroll();
  s.providers.verify = async () => ({ streams: [], state: {} });
  await s.service.callback(token, s.event());
  await s.service.tick();
  assert.equal(s.published.length, 0);
  assert.equal((await s.service.getRegistration(userId)).lastLiveAt, null);
});

test("rotating the key cancels previous sessions and denies the old key immediately", async () => {
  const s = setup(); const first = await s.enroll();
  await s.service.callback(first.token, s.event());
  const second = await s.enroll();
  await assert.rejects(s.service.callback(first.token, s.event()), { code: "invalid_key" });
  await s.service.tick();
  assert.equal(s.published.length, 0);
  assert.notEqual(first.token, second.token);
});

test("remove during provider verification cannot enqueue or publish a notice", async () => {
  const s = setup(); const { token } = await s.enroll();
  await s.service.callback(token, s.event());
  s.providers.verify = async () => { await s.service.remove(userId); return { streams: [stream] }; };
  await s.service.tick();
  assert.equal(s.published.length, 0);
  assert.equal(await s.service.getRegistration(userId), null);
  await assert.rejects(s.service.callback(token, s.event()), { code: "invalid_key" });
});

test("out-of-order old-session events and post-stop heartbeats do not reactivate monitoring", async () => {
  const s = setup(); const { token } = await s.enroll();
  const first = s.event();
  await s.service.callback(token, first);
  s.advance(1000);
  const second = s.event({ sessionId: "second_session_12345" });
  await s.service.callback(token, second);
  await s.service.callback(token, { ...first, event: "stopped", sequence: 5, sentAt: s.now() });
  assert.equal((await s.store.listSessions())[0].sessionId, second.sessionId);
  await s.service.callback(token, { ...second, event: "stopped", sequence: 2 });
  await s.service.callback(token, { ...second, event: "heartbeat", sequence: 3 });
  assert.equal((await s.store.listSessions()).length, 0);
});

test("missing heartbeats expire durable sessions without posting", async () => {
  const s = setup(); const { token } = await s.enroll();
  await s.service.callback(token, s.event());
  s.advance(151_000);
  await s.service.tick();
  assert.equal(s.published.length, 0);
  assert.equal((await s.store.listSessions()).length, 0);
});

test("a fresh heartbeat recovers an expired session after a bot/network outage", async () => {
  const s = setup(); const { token } = await s.enroll();
  const first = s.event();
  await s.service.callback(token, first);
  s.advance(151_000);
  await s.service.tick();
  await s.service.callback(token, { ...first, event: "heartbeat", sequence: 2, sentAt: s.now() });
  await s.service.tick();
  assert.equal(s.published.length, 1);
});

test("Discord accepted a message but the receipt failed: restart reconciles without sending again", async () => {
  const s = setup(); const { token } = await s.enroll();
  await s.service.callback(token, s.event());
  const send = s.publisher.send;
  s.publisher.send = async (...args) => { await send(...args); throw new Error("connection_dropped_after_accept"); };
  await s.service.tick();
  s.advance(31_000);
  await createStreamingService(s.options).tick();
  assert.equal(s.published.length, 1);
  assert.equal((await s.store.listNotices()).length, 0);
});

test("ambiguous delivery with unavailable history never blindly resends", async () => {
  const s = setup(); const { token } = await s.enroll();
  await s.service.callback(token, s.event());
  s.publisher.send = async () => { throw new Error("timeout"); };
  await s.service.tick();
  s.publisher.findExisting = async () => ({ complete: false });
  s.publisher.send = async () => { throw new Error("should_not_send"); };
  s.advance(31_000);
  await s.service.tick();
  assert.equal((await s.store.listNotices())[0].lastError, "discord_history_unavailable");
});

test("queued announcement is reverified and cancelled if the broadcast ended", async () => {
  const s = setup(); const { token } = await s.enroll();
  await s.service.callback(token, s.event());
  s.publisher.send = async () => { throw new Error("unavailable"); };
  await s.service.tick();
  s.providers.verify = async () => ({ streams: [], state: {} });
  s.advance(31_000);
  await s.service.tick();
  assert.equal((await s.store.listNotices()).length, 0);
});

test("channel claims prevent two members taking the same channel and release on removal", async () => {
  const s = setup(); await s.enroll();
  await assert.rejects(s.service.enroll("222222222222222222", "Other", { youtube: "@DZR" }), { code: "channel_in_use" });
  await s.service.remove(userId);
  await s.service.enroll("222222222222222222", "Other", { youtube: "@DZR" });
});

test("persistent YouTube search budget is shared by concurrent callers and resets at Pacific midnight", async () => {
  const s = setup();
  assert.equal((await Promise.all(Array.from({ length: 8 }, () => s.store.reserveSearch()))).filter(Boolean).length, 3);
  s.advance(86400_000);
  assert.equal(await s.store.reserveSearch(), true);
});

test("callbacks cannot select an unregistered platform or impersonate a different member", async () => {
  const s = setup(); const { token } = await s.enroll();
  await assert.rejects(s.service.callback(token, s.event({ platform: "twitch" })), { code: "channel_not_registered" });
  await assert.rejects(s.service.callback(token.replace(userId, "222222222222222222"), s.event()), { code: "invalid_key" });
});

test("discovery backs off durably to five minutes and expires at one hour despite fresh heartbeats", async () => {
  const s = setup(); const { token } = await s.enroll();
  const started = s.event(); const origin = s.now(); const checks = [];
  s.providers.verify = async () => { checks.push((s.now() - origin) / 1000); return { streams: [] }; };
  await s.service.callback(token, started);
  await s.service.tick();
  // Heartbeats keep OBS active throughout. Restart the service on each pass: scheduling is not in memory.
  for (let elapsed = 15; elapsed <= 3705; elapsed += 15) {
    s.advance(15_000);
    await s.service.callback(token, { ...started, event: "heartbeat", sequence: elapsed, sentAt: s.now() });
    await createStreamingService(s.options).tick();
  }
  assert.deepEqual(checks, [0, 15, 45, 105, 225, 465, 765, 1065, 1365, 1665, 1965, 2265, 2565, 2865, 3165, 3465]);
  assert.equal(s.published.length, 0);
  assert.equal((await s.store.listSessions()).length, 0);
  assert.deepEqual(s.alerts.map((item) => item.code), ["live_detection_timeout"]);
  assert.equal((await s.service.getRegistration(userId)).lastLiveAt, null);
  // Only a new start can open a new window.
  s.providers.verify = async () => ({ streams: [stream] });
  await s.service.callback(token, s.event({ sessionId: "new_attempt_123456789" }));
  await s.service.tick();
  assert.equal(s.published.length, 1);
});

test("a provider response crossing the hour deadline cannot announce, even when it reports live", async () => {
  const s = setup(); const { token } = await s.enroll(); const started = s.event();
  await s.service.callback(token, started);
  s.providers.verify = async () => {
    s.advance(3600_000);
    await s.service.callback(token, { ...started, event: "heartbeat", sequence: 2, sentAt: s.now() });
    return { streams: [stream] };
  };
  await s.service.tick();
  assert.equal(s.published.length, 0);
  assert.equal((await s.store.listNotices()).length, 0);
  assert.equal(s.alerts[0].code, "live_detection_timeout");
});

test("first verification stops discovery; delayed delivery may complete after the hour", async () => {
  const s = setup(); const { token } = await s.enroll(); const started = s.event();
  let checks = 0;
  s.providers.verify = async () => { checks++; return { streams: [stream] }; };
  await s.service.callback(token, started);
  // Queue a verified notice, but simulate an outage until the original discovery window has closed.
  const send = s.publisher.send;
  s.publisher.send = async () => { throw new Error("unavailable"); };
  await s.service.tick();
  s.advance(3600_000);
  await s.service.callback(token, { ...started, event: "heartbeat", sequence: 2, sentAt: s.now() });
  s.publisher.send = send;
  await s.service.tick();
  assert.equal(checks, 2); // Initial discovery plus the mandatory delayed-delivery recheck only.
  assert.equal(s.published.length, 1);
  s.advance(30_000);
  await s.service.tick();
  assert.equal(checks, 2);
});

test("IT alerts survive restarts, retry delivery, and coalesce repeated errors without secrets", async () => {
  const s = setup(); const { token } = await s.enroll(); const started = s.event();
  s.providers.verify = async () => { throw new Error(`private header ${token}`); };
  s.publisher.reportError = async () => { throw new Error("IT unavailable"); };
  await s.service.callback(token, started);
  await s.service.tick();
  assert.equal((await s.store.listAlerts()).length, 1);
  s.advance(15_000);
  await s.service.tick(); // Same verification error: do not enqueue another report.
  assert.equal((await s.store.listAlerts()).length, 1);
  s.publisher.reportError = async (alert) => { s.alerts.push(alert); };
  s.advance(45_000);
  await createStreamingService(s.options).tick();
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0].code, "verification_failed");
  assert.equal(s.alerts[0].discordId, userId);
  assert.ok(!JSON.stringify(s.alerts).includes(token));
  assert.equal((await s.store.listAlerts()).length, 0);
});

test("invalid keys never create IT alerts; authenticated callback failures do", async () => {
  const s = setup(); const { token } = await s.enroll();
  await assert.rejects(s.service.callback("bad", s.event()));
  assert.equal((await s.store.listAlerts()).length, 0);
  await assert.rejects(s.service.callback(token, { ...s.event(), sequence: 0 }));
  await s.service.tick();
  assert.equal(s.alerts[0].code, "invalid_event");
});

test("authenticated unknown platforms report to IT once, without sessions, provider checks or announcements", async () => {
  const s = setup(); const { token } = await s.enroll();
  s.providers.verify = () => assert.fail("unknown platforms cannot reach verification");
  for (let i = 0; i < 3; i++) {
    await assert.rejects(s.service.callback(token, s.event({ platform: null })), { code: "unknown_platform" });
  }
  await s.service.tick();
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0].code, "unknown_platform");
  assert.equal(s.alerts[0].discordId, userId);
  assert.equal(s.published.length, 0);
  assert.equal((await s.store.listSessions()).length, 0);
});

test("concurrent workers share one durable IT report and Firestore outages use a bounded fallback", async () => {
  const s = setup(); const { token } = await s.enroll();
  await assert.rejects(s.service.callback(token, { ...s.event(), sequence: 0 }));
  await Promise.all([s.service.tick(), createStreamingService(s.options).tick()]);
  assert.equal(s.alerts.length, 1);
  s.alerts.length = 0;
  s.store.getRegistration = async () => { throw new Error("db unavailable with private details"); };
  s.store.queueAlert = async () => { throw new Error("db unavailable"); };
  for (let i = 0; i < 3; i++) await assert.rejects(s.service.callback(token, s.event()), { code: "temporarily_unavailable" });
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0].code, "callback_store_unavailable");
  assert.ok(!JSON.stringify(s.alerts).includes("private details"));
});
