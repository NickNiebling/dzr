const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryDb } = require("./test-support");
const { createStore } = require("./store");
const { createStreamingService } = require("./service");
const { StreamingError, announcementKey } = require("./model");

const origin = Date.parse("2026-10-27T18:00:00Z");
const guildId = "1195850595014299669", userId = "111111111111111111", channelId = "1196454773558345768";
const channels = {
  youtube: { id: "UCaaaaaaaaaaaaaaaaaaaaaa", title: "DZR YouTube", url: "https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa" },
  twitch: { id: "12345", title: "DZR Twitch", url: "https://www.twitch.tv/dzr" },
};
const streams = {
  youtube: { platform: "youtube", id: "abcdefghijk", title: "Club Ladder", url: "https://www.youtube.com/watch?v=abcdefghijk",
    startedAt: new Date(origin).toISOString(), thumbnail: "https://i.ytimg.com/vi/abcdefghijk/default.jpg" },
  twitch: { platform: "twitch", id: "stream123", title: "Zwift Race", url: channels.twitch.url, startedAt: new Date(origin).toISOString() },
};

function setup() {
  let time = origin;
  let token;
  let sequence = 0;
  const db = memoryDb();
  const store = createStore(db, { now: () => time, searchBudget: 20 });
  const sent = [], edited = [], alerts = [], discovery = [], monitoring = [], recordingChecks = [];
  const live = { youtube: streams.youtube, twitch: null };
  const endedAt = {};
  const recordings = { youtube: [], twitch: [] };
  const platformFor = (channel) => channel.id === channels.youtube.id ? "youtube" : "twitch";
  const providers = {
    async resolveChannel(platform) { return channels[platform]; },
    async verify(channel) {
      const platform = platformFor(channel);
      discovery.push({ platform, time });
      return { streams: live[platform] ? [live[platform]] : [], state: {} };
    },
    async monitor(channel) {
      const platform = platformFor(channel);
      monitoring.push({ platform, time });
      return live[platform] ? { status: "live", stream: live[platform] }
        : { status: "offline", ...(endedAt[platform] ? { endedAt: endedAt[platform] } : {}) };
    },
    async recordings(channel) {
      const platform = platformFor(channel);
      recordingChecks.push({ platform, time });
      return recordings[platform];
    },
  };
  const publisher = {
    async send(notice, message) {
      sent.push({ notice: structuredClone(notice), message: structuredClone(message) });
      return `message-${sent.length}`;
    },
    async edit(notice, message) {
      edited.push({ notice: structuredClone(notice), message: structuredClone(message) });
      return { deleted: false };
    },
    async findExisting() { return sent.length ? { complete: true, messageId: "message-1" } : { complete: true }; },
    async reportError(alert) { alerts.push(structuredClone(alert)); },
  };
  const options = { store, providers, publisher, guildId, channelId, now: () => time, logger: { warn() {} } };
  const service = createStreamingService(options);
  const event = (overrides = {}) => ({ event: "started", platform: null, sessionId: "session_1234567890", sequence: ++sequence,
    startedAt: origin, sentAt: time, ...overrides });
  return { db, store, service, providers, publisher, options, sent, edited, alerts, discovery, monitoring, recordingChecks, live, endedAt, recordings,
    now: () => time, advance(ms) { time += ms; }, event,
    async start(inputs = { youtube: "@DZR", twitch: "dzr" }, overrides = {}) {
      ({ token } = await service.enroll(userId, "Rider", inputs));
      await service.callback(token, event(overrides));
      return token;
    },
    signal(kind, overrides = {}) { return service.callback(token, event({ event: kind, ...overrides })); },
    tick(restart = false) { return (restart ? createStreamingService(options) : service).tick(); },
    message() { return edited.at(-1)?.message || sent.at(-1)?.message; },
    broadcast() { return [...db.documents.values()].find((record) => record.kind === "broadcast"); },
  };
}

test("first live platform posts immediately, and a late second platform edits the same message", async () => {
  const s = setup();
  // The public callback does not require a platform hint; only registered channels are investigated.
  const token = await s.service.enroll(userId, "Rider", { youtube: "@DZR", twitch: "dzr" });
  const first = s.event(); delete first.platform;
  await s.service.callback(token.token, first);
  await s.tick();
  assert.equal(s.sent.length, 1);
  assert.deepEqual(s.sent[0].message.embeds.map((embed) => embed.title), [streams.youtube.title]);
  s.advance(120_000);
  s.live.twitch = { ...streams.twitch, startedAt: new Date(s.now()).toISOString() };
  await s.tick(true);
  assert.equal(s.sent.length, 1);
  assert.ok(s.edited.length >= 1);
  assert.equal(s.edited.at(-1).notice.messageId, "message-1");
  assert.deepEqual(s.message().embeds.map((embed) => embed.title), [streams.youtube.title, streams.twitch.title]);
  assert.deepEqual(s.message().components[0].components.map((button) => button.label), ["Se på YouTube", "Se på Twitch"]);
  assert.deepEqual(s.message().allowedMentions, { parse: [] });
});

test("an unused registered platform is polled once per minute for only five minutes after first verification", async () => {
  const s = setup(); await s.start(); await s.tick();
  for (let minute = 1; minute <= 6; minute++) { s.advance(60_000); await s.tick(true); }
  assert.deepEqual(s.discovery.filter((call) => call.platform === "twitch").map((call) => (call.time - origin) / 1000),
    [0, 60, 120, 180, 240, 300]);
  s.advance(3600_000); await s.signal("heartbeat"); await s.tick(true);
  assert.equal(s.discovery.filter((call) => call.platform === "twitch").length, 6);
  assert.ok(!s.alerts.some((alert) => alert.code === "live_detection_timeout"));
  assert.equal(s.sent.length, 1);
  assert.equal(s.message().embeds.length, 1);
});

test("a Twitch OBS hint still discovers both registered channels", async () => {
  const s = setup(); s.live.twitch = streams.twitch;
  await s.start(undefined, { platform: "twitch" }); await s.tick();
  assert.equal(s.sent.length, 1);
  assert.deepEqual(s.message().embeds.map((embed) => embed.title), [streams.youtube.title, streams.twitch.title]);
});

test("OBS stop and missing heartbeats do not stop monitoring already verified streams", async () => {
  const s = setup(); await s.start({ youtube: "@DZR" }); await s.tick();
  const before = s.monitoring.length;
  s.advance(10_000); await s.signal("stopped"); await s.tick();
  assert.ok(s.monitoring.length > before, "OBS stop requests an immediate platform status check");
  const afterStop = s.monitoring.length;
  s.advance(31 * 60_000); await s.tick(true);
  assert.ok(s.monitoring.length > afterStop, "monitoring survives stale OBS heartbeats and process restart");
  assert.equal(s.sent.length, 1);
  assert.match(s.message().content, /er live nu/);
  assert.ok(!s.broadcast().endedAt);
});

test("a short offline period keeps the live button and resumes without another announcement", async () => {
  const s = setup(); await s.start({ youtube: "@DZR" }); await s.tick();
  s.live.youtube = null; s.advance(60_000); await s.tick();
  assert.match(s.message().components[0].components[0].label, /^Se på YouTube$/);
  s.advance(120_000); s.live.youtube = streams.youtube; await s.tick(true);
  s.advance(360_000); await s.tick();
  assert.equal(s.sent.length, 1);
  assert.match(s.message().content, /er live nu/);
  assert.ok(!s.broadcast().endedAt);
});

test("confirmed offline status ends after five minutes and excludes the grace time from duration", async () => {
  const s = setup(); await s.start({ youtube: "@DZR" }); await s.tick();
  s.live.youtube = null; s.endedAt.youtube = new Date(origin + 45_000).toISOString();
  s.advance(60_000); await s.tick();
  s.advance(299_000); await s.tick(true);
  assert.match(s.message().content, /er live nu/);
  s.advance(1000); await s.tick(true);
  assert.equal(s.sent.length, 1);
  assert.match(s.message().content, /har afsluttet/);
  assert.match(s.message().embeds[0].description, /Var live i 0 min\./);
  assert.deepEqual(s.message().components, []);
  assert.equal(s.message().embeds[0].url, undefined);
  assert.equal(s.message().embeds[0].title, streams.youtube.title);
});

test("API failure at the end of the grace period cannot falsely finalize a stream", async () => {
  const s = setup(); await s.start({ youtube: "@DZR" }); await s.tick();
  s.live.youtube = null; s.advance(60_000); await s.tick();
  const monitor = s.providers.monitor;
  s.providers.monitor = async () => { throw new StreamingError("provider_unavailable", "unavailable", 503); };
  s.advance(300_000); await s.tick(true);
  assert.ok(!s.broadcast().endedAt);
  assert.match(s.message().content, /er live nu/);
  s.providers.monitor = monitor; s.live.youtube = streams.youtube;
  s.advance(300_000); await s.tick(true);
  assert.ok(!s.broadcast().endedAt);
  assert.equal(s.sent.length, 1);
});

test("recording discovery retries at the persisted schedule and adds a replay button later", async () => {
  const s = setup(); await s.start({ youtube: "@DZR" }); await s.tick();
  s.live.youtube = null; s.endedAt.youtube = new Date(origin + 30_000).toISOString();
  s.advance(60_000); await s.tick(); s.advance(300_000); await s.tick();
  const ended = s.now();
  assert.deepEqual(s.message().components, []);
  s.advance(60_000); await s.tick(true);
  assert.deepEqual(s.recordingChecks.map((call) => call.time - ended), [0, 60_000]);
  s.recordings.youtube = [{ id: streams.youtube.id, streamId: streams.youtube.id, title: "Replay", url: streams.youtube.url }];
  s.advance(240_000); await s.tick(true);
  assert.equal(s.sent.length, 1);
  assert.equal(s.message().components[0].components[0].label, "Se optagelsen på YouTube");
  assert.equal(s.message().components[0].components[0].url, streams.youtube.url);
  assert.match(s.message().content, /har afsluttet/);
});

test("missing recordings stop retrying after the final one-hour check while retaining the ended card", async () => {
  const s = setup(); await s.start({ youtube: "@DZR" }); await s.tick();
  s.live.youtube = null; s.advance(60_000); await s.tick(); s.advance(300_000); await s.tick();
  const ended = s.now();
  for (const elapsed of [60_000, 300_000, 900_000, 1800_000, 3600_000, 7200_000]) {
    s.advance(ended + elapsed - s.now()); await s.tick(true);
  }
  assert.deepEqual(s.recordingChecks.map((call) => (call.time - ended) / 60_000), [0, 1, 5, 15, 30, 60]);
  assert.equal(s.message().embeds.length, 1);
  assert.deepEqual(s.message().components, []);
  assert.match(s.message().content, /har afsluttet/);
});

test("concurrent workers share one first send and one platform-addition edit", async () => {
  const s = setup(); await s.start();
  const other = createStreamingService(s.options);
  await Promise.all([s.tick(), other.tick()]);
  assert.equal(s.sent.length, 1);
  s.live.twitch = streams.twitch; s.advance(60_000);
  await Promise.all([s.tick(), other.tick()]);
  assert.equal(s.sent.length, 1);
  assert.equal(s.edited.length, 1);
  assert.equal(s.edited[0].notice.messageId, "message-1");
  assert.equal(s.edited[0].message.embeds.length, 2);
});

test("a Discord message deleted by a moderator is never recreated or edited again", async () => {
  const s = setup(); await s.start({ youtube: "@DZR" }); await s.tick();
  let edits = 0;
  s.publisher.edit = async () => { edits++; return { deleted: true }; };
  s.live.youtube = { ...streams.youtube, title: "Updated title" };
  s.advance(60_000); await s.tick();
  assert.equal(edits, 1);
  s.live.youtube = { ...streams.youtube, title: "Another title" };
  s.advance(60_000); await s.tick(true);
  s.live.youtube = null; s.advance(60_000); await s.tick(); s.advance(300_000); await s.tick();
  assert.equal(s.sent.length, 1);
  assert.equal(edits, 1);
});

test("a genuinely new broadcast after full ending posts a new announcement", async () => {
  const s = setup(); await s.start({ youtube: "@DZR" }); await s.tick();
  s.live.youtube = null; s.advance(60_000); await s.tick(); s.advance(300_000); await s.tick();
  assert.match(s.message().content, /har afsluttet/);
  s.advance(1000);
  s.live.youtube = { ...streams.youtube, id: "lmnopqrstuv", url: "https://www.youtube.com/watch?v=lmnopqrstuv", startedAt: new Date(s.now()).toISOString() };
  await s.signal("started", { sessionId: "next_session_1234567890", startedAt: s.now() });
  await s.tick(true);
  assert.equal(s.sent.length, 2);
  assert.equal(s.sent[1].message.embeds[0].url, s.live.youtube.url);
  assert.match(s.sent[1].message.content, /er live nu/);
  assert.notEqual(s.sent[0].notice.id, s.sent[1].notice.id);
});

test("rotation after receipt reservation but before any send allows the same unsent stream to announce later", async () => {
  const s = setup(); await s.start({ youtube: "@DZR" });
  const save = s.store.saveBroadcast;
  let replacementToken;
  s.store.saveBroadcast = async (...args) => {
    const saved = await save(...args);
    if (saved && !saved.firstAttemptAt && saved.platforms.youtube?.stream && !replacementToken) {
      ({ token: replacementToken } = await s.service.enroll(userId, "Rider", { youtube: "@DZR" }));
    }
    return saved;
  };
  await s.tick();
  assert.equal(s.sent.length, 0, "rotation cancels the old generation before sending");
  assert.ok(replacementToken);
  s.store.saveBroadcast = save;
  s.advance(1000);
  await s.service.callback(replacementToken, s.event({ sessionId: "replacement_session_12345", startedAt: s.now() }));
  await s.tick(true);
  assert.equal(s.sent.length, 1, "an unattempted reservation must not suppress the stream forever");
  assert.equal(s.sent[0].message.embeds[0].url, streams.youtube.url);
});

test("an estimated same-ID dropout remains approximate even when the final end time is exact", async () => {
  const s = setup(); await s.start({ youtube: "@DZR" }); await s.tick();
  s.live.youtube = null; s.advance(60_000); await s.tick();
  s.live.youtube = streams.youtube; s.advance(60_000); await s.tick();
  s.live.youtube = null; s.endedAt.youtube = new Date(origin + 170_000).toISOString();
  s.advance(60_000); await s.tick(); s.advance(300_000); await s.tick(true);
  assert.equal(s.sent.length, 1);
  assert.match(s.message().embeds[0].description, /Var live i ca\. 1 min\./);
});

test("a new Twitch broadcast ID during grace preserves the post and links all recording parts", async () => {
  const s = setup(); s.live.youtube = null; s.live.twitch = streams.twitch;
  await s.start({ twitch: "dzr" }); await s.tick();
  s.live.twitch = null; s.endedAt.twitch = new Date(origin + 45_000).toISOString();
  s.advance(60_000); await s.tick();
  const second = { ...streams.twitch, id: "stream456", title: "Reconnected race", startedAt: new Date(origin + 90_000).toISOString() };
  s.live.twitch = second; s.advance(60_000); await s.tick(true);
  assert.equal(s.sent.length, 1);
  assert.equal(s.message().embeds[0].title, second.title);
  s.live.twitch = null; s.endedAt.twitch = new Date(origin + 165_000).toISOString();
  s.recordings.twitch = [
    { id: "archive1", streamId: streams.twitch.id, url: "https://www.twitch.tv/videos/100" },
    { id: "archive2", streamId: second.id, url: "https://www.twitch.tv/videos/200" },
  ];
  s.advance(60_000); await s.tick(); s.advance(300_000); await s.tick(true);
  assert.equal(s.sent.length, 1);
  assert.match(s.message().content, /har afsluttet/);
  assert.match(s.message().embeds[0].description, /Var live i 2 min\./);
  assert.ok(s.message().embeds[0].description.includes("[Del 1](https://www.twitch.tv/videos/100)"));
  assert.ok(s.message().embeds[0].description.includes("[Del 2](https://www.twitch.tv/videos/200)"));
  assert.equal(s.message().components[0].components[0].url, "https://www.twitch.tv/videos/100");
});

test("a first send accepted before a lost response is recovered after restart without another announcement", async () => {
  const s = setup(); await s.start({ youtube: "@DZR" });
  const send = s.publisher.send;
  s.publisher.send = async (...args) => { await send(...args); throw new Error("response lost after acceptance"); };
  await s.tick();
  assert.equal(s.sent.length, 1);
  s.publisher.send = send;
  s.advance(60_000); await s.tick(true);
  assert.equal(s.sent.length, 1);
  assert.equal(s.broadcast().messageId, "message-1");
  s.advance(60_000); await s.tick(true);
  assert.equal(s.sent.length, 1);
});

test("uncertain first delivery does not blindly resend when Discord history cannot be checked", async () => {
  const s = setup(); await s.start({ youtube: "@DZR" });
  let attempts = 0;
  s.publisher.send = async () => { attempts++; throw new Error("network timeout"); };
  await s.tick();
  s.publisher.findExisting = async () => ({ complete: false });
  s.advance(60_000); await s.tick(true);
  s.advance(60_000); await s.tick(true);
  assert.equal(attempts, 1);
  assert.equal(s.sent.length, 0);
  assert.ok(s.alerts.some((alert) => alert.code === "discord_history_unavailable"));
});

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

function bounded(promise) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("expected streaming operation did not complete")), 1500);
  })]).finally(() => clearTimeout(timer));
}

test("a slow secondary provider does not delay the first verified platform's announcement", { timeout: 5000 }, async () => {
  const s = setup(); await s.start();
  const secondary = deferred(), firstSent = deferred();
  const verify = s.providers.verify;
  s.providers.verify = async (channel, ...args) => channel.id === channels.twitch.id ? secondary.promise : verify(channel, ...args);
  const send = s.publisher.send;
  s.publisher.send = async (...args) => {
    const id = await send(...args);
    firstSent.resolve();
    return id;
  };
  const tick = s.tick();
  try {
    await bounded(firstSent.promise);
    assert.equal(s.sent.length, 1);
    assert.deepEqual(s.sent[0].message.embeds.map((embed) => embed.title), [streams.youtube.title]);
  } finally {
    secondary.resolve({ streams: [], state: {} });
    await bounded(tick);
  }
  assert.equal(s.sent.length, 1);
});

test("heartbeats during deferred provider and Discord requests preserve progress and the latest OBS liveness", { timeout: 5000 }, async () => {
  const s = setup(); await s.start({ youtube: "@DZR" });
  const providerStarted = deferred(), providerResult = deferred(), discordStarted = deferred(), discordResult = deferred();
  const verify = s.providers.verify;
  let firstCheck = true;
  s.providers.verify = async (...args) => {
    if (!firstCheck) return verify(...args);
    firstCheck = false;
    providerStarted.resolve();
    return providerResult.promise;
  };
  const send = s.publisher.send;
  s.publisher.send = async (...args) => {
    discordStarted.resolve();
    await discordResult.promise;
    return send(...args);
  };
  const tick = s.tick();
  try {
    await bounded(providerStarted.promise);
    s.advance(30_000); await s.signal("heartbeat");
    providerResult.resolve({ streams: [streams.youtube], state: {} });
    await bounded(discordStarted.promise);
    s.advance(30_000); await s.signal("heartbeat");
  } finally {
    providerResult.resolve({ streams: [streams.youtube], state: {} });
    discordResult.resolve();
    await bounded(tick);
  }
  assert.equal(s.sent.length, 1);
  assert.equal(s.broadcast().messageId, "message-1");
  assert.equal(s.broadcast().firstVerifiedAt, origin + 30_000);
  assert.equal(Math.max(...Object.values(s.broadcast().obs).map((source) => source.lastSeenAt)), s.now());
  s.advance(60_000); await s.tick(true);
  assert.equal(s.sent.length, 1);
  assert.equal(s.broadcast().firstVerifiedAt, origin + 30_000);
});

test("an already delivered legacy receipt suppresses the same broadcast without posting an empty live message", async () => {
  const s = setup(); await s.start({ youtube: "@DZR" });
  const receiptId = `notice_${announcementKey(channelId, streams.youtube)}`;
  s.db.documents.set(receiptId, { kind: "notice", status: "sent", channelId, stream: streams.youtube,
    firstAttemptAt: origin - 1000, messageId: "legacy-message", sentAt: origin - 500 });
  await s.tick();
  assert.equal(s.sent.length, 0);
  assert.equal(s.edited.length, 0);
  assert.equal(s.db.documents.get(receiptId).messageId, "legacy-message");
  assert.equal(s.broadcast().phase, "cancelled");
  assert.equal(s.broadcast().work, false);
  s.advance(60_000); await s.tick(true);
  assert.equal(s.sent.length, 0);
});

test("exhausted multistream discovery with only a legacy-owned stream allows a later genuinely new stream", async () => {
  const s = setup(); await s.start();
  const receiptId = `notice_${announcementKey(channelId, streams.youtube)}`;
  s.db.documents.set(receiptId, { kind: "notice", status: "sent", channelId, stream: streams.youtube,
    firstAttemptAt: origin - 1000, messageId: "legacy-message", sentAt: origin - 500 });
  await s.tick();
  for (let minute = 1; minute <= 6; minute++) { s.advance(60_000); await s.tick(true); }
  assert.equal(s.sent.length, 0);
  assert.equal(s.edited.length, 0);
  assert.equal(s.broadcast().phase, "cancelled");
  assert.equal(s.broadcast().work, false);
  s.advance(1000);
  s.live.youtube = { ...streams.youtube, id: "lmnopqrstuv", url: "https://www.youtube.com/watch?v=lmnopqrstuv", startedAt: new Date(s.now()).toISOString() };
  await s.signal("started", { sessionId: "new_after_legacy_123456", startedAt: s.now() });
  await s.tick(true);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].message.embeds[0].url, s.live.youtube.url);
  assert.equal(s.db.documents.get(receiptId).messageId, "legacy-message");
});

test("a new OBS session after an unverified stopped session receives its own full discovery window", async () => {
  const s = setup(); s.live.youtube = null;
  await s.start({ youtube: "@DZR" }); await s.tick();
  s.advance(60_000); await s.signal("stopped"); await s.tick();
  assert.equal(s.sent.length, 0);
  s.advance(600_000);
  const restartedAt = s.now(), sessionId = "fresh_discovery_1234567";
  await s.signal("started", { sessionId, startedAt: restartedAt }); await s.tick();
  // Move past the original session's hour, while still within the new session's hour.
  s.advance(origin + 3600_000 + 1000 - s.now());
  await s.signal("heartbeat", { sessionId, startedAt: restartedAt });
  s.live.youtube = { ...streams.youtube, startedAt: new Date(s.now()).toISOString() };
  await s.tick(true);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].message.embeds[0].url, streams.youtube.url);
  assert.ok(!s.alerts.some((alert) => alert.code === "live_detection_timeout"));
});
