const test = require("node:test");
const assert = require("node:assert/strict");
const { parseChannel, parseEvent, youtubeLive, createToken, tokenOwner, tokenMatches, hash, announcementMessage, broadcastMessage } = require("./model");

test("channel identity parsing rejects watch URLs, spoofed hosts, credentials and arbitrary endpoints", () => {
  assert.deepEqual(parseChannel("youtube", "https://www.youtube.com/@DZR"), { handle: "@DZR" });
  assert.deepEqual(parseChannel("youtube", "https://youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa/"), { id: "UCaaaaaaaaaaaaaaaaaaaaaa" });
  assert.deepEqual(parseChannel("twitch", "https://www.twitch.tv/DZR_Racing"), { login: "dzr_racing" });
  for (const url of ["https://youtube.com.evil.test/@DZR", "https://evil@youtube.com/@DZR", "https://youtube.com/watch?v=abcdefghijk", "http://127.0.0.1/@DZR", "https://youtube.com:8443/@DZR", "https://youtube.com/@DZR#secret"]) {
    assert.throws(() => parseChannel("youtube", url));
  }
});

test("public YouTube video must actually be live, in the registered channel", () => {
  const video = { snippet: { channelId: "channel", liveBroadcastContent: "live" }, status: { privacyStatus: "public" }, liveStreamingDetails: { actualStartTime: "2026-10-27T18:00:00Z" } };
  assert.ok(youtubeLive(video, "channel"));
  assert.equal(youtubeLive(video, "other"), false);
  for (const modified of [
    { ...video, snippet: { ...video.snippet, liveBroadcastContent: "upcoming" } },
    { ...video, liveStreamingDetails: { scheduledStartTime: "2026-10-27T18:00:00Z" } },
    { ...video, liveStreamingDetails: { ...video.liveStreamingDetails, actualEndTime: "2026-10-27T19:00:00Z" } },
    { ...video, status: { privacyStatus: "private" } },
    { ...video, status: { privacyStatus: "unlisted" } },
  ]) assert.ok(!youtubeLive(modified, "channel"));
});

test("personal keys are random, owner-bound and verified by hash", () => {
  const id = "111111111111111111";
  const token = createToken(id);
  assert.equal(tokenOwner(token), id);
  assert.equal(tokenMatches(token, hash(token)), true);
  assert.equal(tokenMatches(createToken(id), hash(token)), false);
  assert.equal(tokenMatches(token, "invalid"), false);
  assert.equal(tokenOwner("anything"), null);
});

test("callback events require bounded, ordered metadata and a fresh clock", () => {
  const now = Date.now();
  const event = { event: "started", platform: "youtube", sessionId: "session_1234567890", sequence: 1, startedAt: now, sentAt: now };
  assert.equal(parseEvent(event, now).videoId, null);
  for (const patch of [{ platform: "other" }, { sequence: -1 }, { sessionId: "../../x" }, { sentAt: now - 121000 }, { startedAt: now + 1 }, { videoId: "https://evil" }]) {
    assert.throws(() => parseEvent({ ...event, ...patch }, now));
  }
});

test("announcement contains verified stream URL, with all mentions disabled", () => {
  const payload = announcementMessage({ discordId: "111111111111111111" }, { title: "@everyone", platform: "youtube", url: "https://www.youtube.com/watch?v=abcdefghijk", startedAt: "2026-10-27T18:00:00Z" });
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.equal(payload.embeds[0].url, "https://www.youtube.com/watch?v=abcdefghijk");
});

test("unsupported platforms have a distinct error and cannot fall through to another provider", () => {
  const now = Date.now();
  for (const platform of ["unknown", "ukendt", "facebook", ""]) {
    assert.throws(() => parseEvent({ platform }, now), { code: "unknown_platform" });
  }
  for (const platform of ["unknown", "ukendt", "facebook", "", null, undefined]) {
    assert.throws(() => parseChannel(platform, "@DZR"), { code: "unknown_platform" });
    assert.throws(() => announcementMessage({}, { platform }), { code: "unknown_platform" });
  }
});

test("callbacks accept omitted or null OBS platform hints without relaxing other validation", () => {
  const now = Date.now();
  const event = { event: "started", sessionId: "session_1234567890", sequence: 1, startedAt: now, sentAt: now };
  assert.equal(parseEvent(event, now).platform, null);
  assert.equal(parseEvent({ ...event, platform: null }, now).platform, null);
  assert.equal(parseEvent({ ...event, platform: "twitch" }, now).platform, "twitch");
  assert.throws(() => parseEvent({ ...event, sentAt: now - 121_000 }, now), { code: "invalid_event" });
});

const member = { discordId: "111111111111111111" };
const youtube = { platform: "youtube", id: "abcdefghijk", title: "Club Ladder", url: "https://www.youtube.com/watch?v=abcdefghijk",
  startedAt: "2026-10-27T18:00:00.000Z", thumbnail: "https://i.ytimg.com/vi/abcdefghijk/default.jpg" };
const twitch = { platform: "twitch", id: "stream2", title: "Zwift Race", url: "https://www.twitch.tv/dzr", startedAt: "2026-10-27T18:04:00.000Z" };

test("multistream presentation orders brand-colored cards and link buttons with independent timestamps", () => {
  const message = broadcastMessage(member, { platforms: {
    twitch: { status: "live", stream: twitch }, youtube: { status: "offline_pending", stream: youtube },
  } });
  assert.equal(message.content, `🔴 <@${member.discordId}> er live nu!`);
  assert.deepEqual(message.allowedMentions, { parse: [] });
  assert.deepEqual(message.embeds.map((embed) => embed.color), [0xff0000, 0x9146ff]);
  assert.deepEqual(message.embeds.map((embed) => embed.title), ["Club Ladder", "Zwift Race"]);
  assert.deepEqual(message.embeds.map((embed) => embed.timestamp), [youtube.startedAt, twitch.startedAt]);
  assert.match(message.embeds[0].description, /<t:1793124000:t>.*<t:1793124000:R>/);
  assert.match(message.embeds[1].description, /<t:1793124240:t>.*<t:1793124240:R>/);
  assert.deepEqual(message.embeds[0].thumbnail, { url: youtube.thumbnail });
  assert.equal(message.embeds[1].thumbnail, undefined);
  assert.deepEqual(message.components[0].components.map((button) => [button.style, button.label, button.url]),
    [[5, "Se på YouTube", youtube.url], [5, "Se på Twitch", twitch.url]]);
});

test("ended cards remain and never link to a live channel when a recording is unavailable", () => {
  const message = broadcastMessage(member, { endedAt: Date.parse("2026-10-27T19:42:00Z"), platforms: {
    youtube: { status: "ended", stream: youtube, durationMs: 102 * 60_000 },
    twitch: { status: "ended", stream: twitch, durationMs: 98 * 60_000, approximate: true,
      recordings: [{ id: "archive2", url: "https://www.twitch.tv/videos/1234", streamId: "stream2" }] },
  } });
  assert.equal(message.content, `⚪ <@${member.discordId}> har afsluttet sin stream.`);
  assert.equal(message.embeds.length, 2);
  assert.equal(message.embeds[0].url, undefined);
  assert.match(message.embeds[0].description, /Var live i 1 t\. 42 min\./);
  assert.match(message.embeds[1].description, /Var live i ca\. 1 t\. 38 min\./);
  assert.deepEqual(message.components[0].components.map((button) => button.label), ["Se optagelsen på Twitch"]);
  assert.equal(message.components[0].components[0].url, "https://www.twitch.tv/videos/1234");
});

test("mixed live and ended platforms preserve one live header, with recording parts in the ended card", () => {
  const parts = [{ id: "part1", url: youtube.url }, { id: "part2", url: "https://www.youtube.com/watch?v=lmnopqrstuv" }];
  const message = broadcastMessage(member, { platforms: {
    youtube: { status: "ended", stream: { ...youtube, title: "x".repeat(300) }, recordings: parts,
      segments: [{ stream: youtube, endedAt: "2026-10-27T19:00:00Z" },
        { stream: { ...youtube, startedAt: "2026-10-27T19:04:00Z" }, endedAt: "2026-10-27T19:46:00Z" }] },
    twitch: { status: "live", stream: twitch },
  } });
  assert.match(message.content, /er live nu/);
  assert.equal(message.embeds[0].title.length, 256);
  assert.match(message.embeds[0].description, /1 t\. 42 min\./);
  assert.ok(message.embeds[0].description.includes(`[Del 1](${parts[0].url})`));
  assert.ok(message.embeds[0].description.includes(`[Del 2](${parts[1].url})`));
  assert.deepEqual(message.components[0].components.map((button) => button.url), [parts[0].url, twitch.url]);
});

test("completed streams without recordings clear all buttons", () => {
  const message = broadcastMessage(member, { endedAt: 1, platforms: { youtube: { status: "ended", stream: youtube, durationMs: 60_000 } } });
  assert.deepEqual(message.components, []);
  assert.equal(message.embeds[0].url, undefined);
  assert.equal(message.embeds[0].thumbnail.url, youtube.thumbnail);
});

test("restarted streams retain their original start fingerprint and large recording lists fit Discord limits", () => {
  const recordings = Array.from({ length: 50 }, (_, i) => ({ id: String(i), url: `https://example.test/${"a".repeat(400)}?part=${i}` }));
  const state = { status: "ended", stream: { ...youtube, title: "t".repeat(300), startedAt: "2026-10-27T19:04:00.000Z" },
    segments: [{ stream: youtube, endedAt: "2026-10-27T19:00:00Z" }], recordings };
  const message = broadcastMessage(member, { endedAt: 1, platforms: {
    youtube: state, twitch: { ...state, stream: { ...state.stream, platform: "twitch" } },
  } });
  assert.equal(message.embeds[0].timestamp, youtube.startedAt);
  const total = message.embeds.reduce((sum, embed) => sum + embed.title.length + embed.description.length + embed.author.name.length, 0);
  assert.ok(total <= 6000);
  assert.ok(message.embeds.every((embed) => embed.description.length <= 4096));
  assert.equal(message.components[0].components.length, 2);
});
