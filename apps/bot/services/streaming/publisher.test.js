const test = require("node:test");
const assert = require("node:assert/strict");
const { createPublisher } = require("./publisher");

test("publication uses a stable nonce; recovery matches the bot, URL and actual start", async () => {
  const notice = { channelId: "channel", nonce: "stable-stream-nonce", firstAttemptAt: 100000,
    stream: { url: "https://twitch.tv/dzr", startedAt: "2026-10-27T18:00:00.000Z" } };
  let sent;
  const channel = { guild_id: "guild", type: 0 };
  const rest = { async post(_route, payload) { sent = payload.body; return { id: "message" }; },
    async get(route) { return route.endsWith("/messages") ? [
      { id: "wrong-author", author: { id: "someone" }, embeds: [{ url: notice.stream.url, timestamp: notice.stream.startedAt }], timestamp: "2026-10-27T18:00:01.000Z" },
      { id: "right", author: { id: "bot" }, embeds: [{ url: notice.stream.url, timestamp: notice.stream.startedAt }], timestamp: "2026-10-27T18:00:01.000Z" },
    ] : channel; } };
  const publisher = createPublisher({ user: { id: "bot" } }, "guild", { rest });
  assert.equal(await publisher.send(notice, { content: "Live" }), "message");
  assert.equal(sent.enforce_nonce, true);
  assert.equal(sent.nonce, notice.nonce);
  assert.equal((await publisher.findExisting(notice)).messageId, "right");
  channel.guild_id = "other-guild";
  await assert.rejects(publisher.send(notice, {}), /invalid_streaming_channel/);
});

test("IT reports resolve #it inside the configured guild and send only sanitized fields without pings", async () => {
  const sent = [];
  const rest = { async get(route) {
    if (route === "/guilds/guild/channels") return [{ id: "it-channel", name: "it", type: 0 }, { id: "chat", name: "general", type: 0 }];
    assert.equal(route, "/channels/it-channel");
    return { guild_id: "guild", type: 0 };
  }, async post(route, payload) { sent.push({ route, body: payload.body }); } };
  const publisher = createPublisher({}, "guild", { rest });
  await publisher.reportError({ id: "alert_test", discordId: "member", code: "provider_unavailable", createdAt: 1793124000000, secret: "must-not-leak" });
  assert.equal(sent[0].route, "/channels/it-channel/messages");
  assert.deepEqual(sent[0].body.allowed_mentions, { parse: [] });
  assert.match(sent[0].body.content, /provider_unavailable/);
  assert.ok(!JSON.stringify(sent).includes("must-not-leak"));
});

test("ambiguous #it lookup fails closed rather than reporting to an arbitrary channel", async () => {
  const publisher = createPublisher({}, "guild", { rest: {
    async get() { return [{ id: "one", name: "it", type: 0 }, { id: "two", name: "it", type: 0 }]; },
    async post() { assert.fail(); },
  } });
  await assert.rejects(publisher.reportError({}), /streaming_it_channel_not_found/);
});

test("edits replace embeds and buttons on the existing message with mentions disabled", async () => {
  let edited;
  const publisher = createPublisher({}, "guild", { rest: {
    async get() { return { guild_id: "guild", type: 0 }; },
    async patch(route, payload) { edited = { route, body: payload.body }; return { id: "original" }; },
    async post() { assert.fail("an update must never create another message"); },
  } });
  const result = await publisher.edit({ channelId: "channel", messageId: "original" }, {
    content: "Afsluttet", embeds: [{ title: "Afsluttet" }], components: [], allowedMentions: { parse: ["everyone"] },
  });
  assert.deepEqual(result, { deleted: false });
  assert.equal(edited.route, "/channels/channel/messages/original");
  assert.equal(edited.body.content, "Afsluttet");
  assert.deepEqual(edited.body.components, []);
  assert.deepEqual(edited.body.allowed_mentions, { parse: [] });
  assert.equal("allowedMentions" in edited.body, false);
  assert.equal("nonce" in edited.body, false);
});

test("deleted messages are reported as deleted; transient edit failures still throw", async () => {
  let error = { status: 404, code: 10008 };
  const publisher = createPublisher({}, "guild", { rest: {
    async get() { return { guild_id: "guild", type: 0 }; },
    async patch() { throw error; },
  } });
  assert.deepEqual(await publisher.edit({ channelId: "channel", messageId: "original" }, {}), { deleted: true });
  error = new Error("network unavailable");
  await assert.rejects(publisher.edit({ channelId: "channel", messageId: "original" }, {}), error);
});

test("uncertain first sends recover against all immutable initial embed fingerprints", async () => {
  const initialMessage = { embeds: [
    { url: "https://www.youtube.com/watch?v=abcdefghijk", timestamp: "2026-10-27T18:00:00.000Z" },
    { url: "https://www.twitch.tv/dzr", timestamp: "2026-10-27T18:04:00.000Z" },
  ] };
  const messages = [
    { id: "only-one-platform", author: { id: "bot" }, embeds: [initialMessage.embeds[0]] },
    { id: "other-bot", author: { id: "other" }, embeds: initialMessage.embeds },
    { id: "right", author: { id: "bot" }, embeds: initialMessage.embeds },
  ].map((message) => ({ ...message, timestamp: "2026-10-27T18:04:01.000Z" }));
  const publisher = createPublisher({ user: { id: "bot" } }, "guild", { rest: {
    async get(route) { return route.endsWith("/messages") ? messages : { guild_id: "guild", type: 0 }; },
  } });
  const result = await publisher.findExisting({ channelId: "channel", firstAttemptAt: Date.parse("2026-10-27T18:04:00Z"), initialMessage });
  assert.deepEqual(result, { complete: true, messageId: "right" });
});
