const test = require("node:test");
const assert = require("node:assert/strict");
const { createProviders } = require("./providers");

const channel = { id: "UCaaaaaaaaaaaaaaaaaaaaaa", url: "https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa" };
const video = { id: "abcdefghijk", snippet: { channelId: channel.id, title: "Racing", liveBroadcastContent: "live" },
  status: { privacyStatus: "public" }, liveStreamingDetails: { actualStartTime: "2026-10-27T18:00:00Z" } };
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });

test("a supplied live YouTube video ID bypasses search and verifies channel, visibility and actual start", async () => {
  let item = video;
  const urls = [];
  const providers = createProviders({ youtubeApiKey: "test-key" }, { fetchImpl: async (url) => { urls.push(url); return json({ items: [item] }); } });
  const session = { platform: "youtube", videoId: video.id };
  const quota = { reserveSearch() { assert.fail("No search for known IDs"); } };
  assert.equal((await providers.verify(channel, session, quota)).streams.length, 1);
  const noBudget = { reserveSearch() { return false; } };
  item = { ...video, snippet: { ...video.snippet, channelId: "someone_else" } };
  assert.equal((await providers.verify(channel, session, noBudget)).streams.length, 0);
  item = { ...video, snippet: { ...video.snippet, liveBroadcastContent: "upcoming" }, liveStreamingDetails: {} };
  assert.equal((await providers.verify(channel, session, noBudget)).streams.length, 0);
  assert.ok(urls.every((url) => url.pathname.endsWith("/videos")));
});

test("YouTube discovery is callback-triggered, quota reserved, then video status checked", async () => {
  const order = [];
  const providers = createProviders({ youtubeApiKey: "test-key" }, { now: () => 1000000, fetchImpl: async (url) => {
    order.push(url.pathname.split("/").pop());
    if (url.pathname.endsWith("/search")) {
      assert.equal(url.searchParams.get("channelId"), channel.id);
      assert.equal(url.searchParams.get("eventType"), "live");
      return json({ items: [{ id: { videoId: video.id } }] });
    }
    return json({ items: [video] });
  } });
  const result = await providers.verify(channel, { platform: "youtube", startedAt: 1000000 }, { async reserveSearch() { order.push("reserve"); return true; } });
  assert.deepEqual(order, ["reserve", "search", "videos"]);
  assert.equal(result.streams[0].url, `https://www.youtube.com/watch?v=${video.id}`);
});

test("exhausted discovery budget prevents search requests", async () => {
  let calls = 0;
  const providers = createProviders({ youtubeApiKey: "test-key" }, { now: () => 1000000, fetchImpl: async () => { calls++; return json({ items: [] }); } });
  const result = await providers.verify(channel, { platform: "youtube", startedAt: 1000000 }, { async reserveSearch() { return false; } });
  assert.equal(result.error, "youtube_search_budget");
  assert.equal(calls, 0);
});

test("a scheduled preview is discovered once, while live searches continue until video polling finds it live", async () => {
  let time = 1000000, live = false, searches = 0;
  const providers = createProviders({ youtubeApiKey: "test-key" }, { now: () => time, fetchImpl: async (url) => {
    if (url.pathname.endsWith("/search")) {
      searches++;
      return json({ items: url.searchParams.get("eventType") === "upcoming" ? [{ id: { videoId: video.id } }] : [] });
    }
    return json({ items: [live ? video : { ...video, snippet: { ...video.snippet, liveBroadcastContent: "upcoming" }, liveStreamingDetails: { scheduledStartTime: "2026-10-27T18:00:00Z" } }] });
  } });
  const session = { platform: "youtube", startedAt: time };
  const quota = { async reserveSearch() { return true; } };
  const first = await providers.verify(channel, session, quota);
  assert.equal(first.streams.length, 0);
  assert.deepEqual(first.state.candidateIds, [video.id]);
  time += 20000;
  assert.equal((await providers.verify(channel, { ...session, ...first.state }, quota)).streams.length, 0);
  assert.equal(searches, 3, "an upcoming ID does not suppress the next live search");
  live = true; time += 20000;
  assert.equal((await providers.verify(channel, { ...session, ...first.state }, quota)).streams.length, 1);
  assert.equal(searches, 3, "a candidate that is now live avoids another search");
});

test("cached upcoming videos cannot hide a different broadcast that becomes indexed later", async () => {
  const upcoming = { ...video, id: "lmnopqrstuv", snippet: { ...video.snippet, liveBroadcastContent: "upcoming" }, liveStreamingDetails: {} };
  let indexed = false, liveSearches = 0, upcomingSearches = 0;
  const providers = createProviders({ youtubeApiKey: "key" }, { fetchImpl: async (url) => {
    if (url.pathname.endsWith("/search")) {
      if (url.searchParams.get("eventType") === "upcoming") {
        upcomingSearches++;
        return json({ items: [{ id: { videoId: upcoming.id } }] });
      }
      liveSearches++;
      return json({ items: indexed ? [{ id: { videoId: video.id } }] : [] });
    }
    return json({ items: [upcoming, video].filter((item) => url.searchParams.get("id").split(",").includes(item.id)) });
  } });
  const quota = { reserveSearch: () => true };
  const first = await providers.verify(channel, { platform: "youtube" }, quota);
  assert.deepEqual(first.streams, []);
  assert.deepEqual(first.state.candidateIds, [upcoming.id]);
  indexed = true;
  const second = await providers.verify(channel, { platform: "youtube", ...first.state }, quota);
  assert.equal(second.streams[0].id, video.id);
  assert.equal(liveSearches, 2);
  assert.equal(upcomingSearches, 1);
});

test("stale, unrelated, private and future saved YouTube links fall back to budgeted channel discovery", async () => {
  for (const saved of [null,
    { ...video, liveStreamingDetails: { ...video.liveStreamingDetails, actualEndTime: "2026-10-27T19:00:00Z" } },
    { ...video, snippet: { ...video.snippet, channelId: "other-channel" } },
    { ...video, status: { privacyStatus: "private" } },
    { ...video, snippet: { ...video.snippet, liveBroadcastContent: "upcoming" }, liveStreamingDetails: {} },
  ]) {
    const current = { ...video, id: "lmnopqrstuv" };
    let searches = 0, reservations = 0;
    const providers = createProviders({ youtubeApiKey: "key" }, { fetchImpl: async (url) => {
      if (url.pathname.endsWith("/search")) {
        searches++;
        assert.equal(url.searchParams.get("channelId"), channel.id);
        return json({ items: [{ id: { videoId: current.id } }] });
      }
      return json({ items: [saved, current].filter((item) => item && url.searchParams.get("id").split(",").includes(item.id)) });
    } });
    const result = await providers.verify(channel, { platform: "youtube", videoId: video.id }, { reserveSearch() { reservations++; return true; } });
    assert.deepEqual(result.streams.map((stream) => stream.id), [current.id]);
    assert.equal(searches, 1);
    assert.equal(reservations, 1);
  }
});

test("channel resolution uses the handle endpoint, never a quota-expensive search", async () => {
  const providers = createProviders({ youtubeApiKey: "test-key" }, { fetchImpl: async (url) => {
    assert.ok(url.pathname.endsWith("/channels"));
    assert.equal(url.searchParams.get("forHandle"), "@DZR");
    return json({ items: [{ id: channel.id, snippet: { title: "DZR" } }] });
  } });
  assert.deepEqual(await providers.resolveChannel("youtube", "@DZR"), { ...channel, title: "DZR" });
  await assert.rejects(providers.resolveChannel("twitch", "dzr"), { code: "provider_not_configured" });
});

test("YouTube video links resolve through videos and channels to the owning channel handle", async () => {
  const videoId = "y_pQmA_dZuE";
  for (const input of [
    `https://youtu.be/${videoId}?si=0lLgbMjLZVMRm9fV`,
    `https://www.youtube.com/watch?v=${videoId}&si=share&t=30`,
    `https://youtube.com/shorts/${videoId}?si=share`,
    `https://youtube.com/live/${videoId}?si=share`,
    `https://youtube.com/embed/${videoId}?start=30`,
  ]) {
    const calls = [];
    const providers = createProviders({ youtubeApiKey: "test-key" }, { fetchImpl: async (url) => {
      calls.push(url.pathname);
      assert.equal(url.origin, "https://www.googleapis.com");
      assert.equal(url.searchParams.get("part"), "snippet");
      assert.equal(url.searchParams.get("si"), null);
      if (url.pathname.endsWith("/videos")) {
        assert.equal(url.searchParams.get("id"), videoId);
        return json({ items: [{ id: videoId, snippet: { channelId: channel.id } }] });
      }
      assert.equal(url.pathname, "/youtube/v3/channels");
      assert.equal(url.searchParams.get("id"), channel.id);
      assert.equal(url.searchParams.get("forHandle"), null);
      return json({ items: [{ id: channel.id, snippet: { title: "Dybt Godnat Danmark", customUrl: "@dybtgonatdanmark" } }] });
    } });
    assert.deepEqual(await providers.resolveChannel("youtube", input), {
      id: channel.id, title: "Dybt Godnat Danmark", url: "https://www.youtube.com/@dybtgonatdanmark",
    });
    assert.deepEqual(calls, ["/youtube/v3/videos", "/youtube/v3/channels"]);
  }
});

test("shared channel links discard tracking parameters and keep the API's canonical handle", async () => {
  const providers = createProviders({ youtubeApiKey: "key" }, { fetchImpl: async (url) => {
    assert.equal(url.pathname, "/youtube/v3/channels");
    assert.equal(url.searchParams.get("forHandle"), "@dybtgonatdanmark");
    assert.equal(url.searchParams.get("si"), null);
    return json({ items: [{ id: channel.id, snippet: { title: "Dybt Godnat Danmark", customUrl: "@dybtgonatdanmark" } }] });
  } });
  const resolved = await providers.resolveChannel("youtube", "https://youtube.com/@dybtgonatdanmark?si=2zPFIbHT7P1uyOuV");
  assert.equal(resolved.url, "https://www.youtube.com/@dybtgonatdanmark");
});

test("channels without a valid handle retain a canonical channel-ID URL", async () => {
  for (const customUrl of [undefined, "legacy-name", "@bad?si=tracking", "https://example.com/@DZR", "@bad/path"]) {
    const providers = createProviders({ youtubeApiKey: "key" }, { fetchImpl: async (url) => {
      if (url.pathname.endsWith("/videos")) return json({ items: [video] });
      return json({ items: [{ id: channel.id, snippet: { title: "DZR", customUrl } }] });
    } });
    assert.deepEqual(await providers.resolveChannel("youtube", `https://youtu.be/${video.id}`), { ...channel, title: "DZR" });
  }
});

test("missing videos and channels cannot register a different or guessed channel", async () => {
  for (const missingVideo of [true, false]) {
    let calls = 0;
    const providers = createProviders({ youtubeApiKey: "key" }, { fetchImpl: async (url) => {
      calls++;
      if (url.pathname.endsWith("/videos")) return json({ items: missingVideo ? [] : [video] });
      return json({ items: [] });
    } });
    await assert.rejects(providers.resolveChannel("youtube", `https://youtu.be/${video.id}`), { code: "channel_not_found" });
    assert.equal(calls, missingVideo ? 1 : 2);
  }
  const providers = createProviders({ youtubeApiKey: "key" }, { fetchImpl: async (url) => {
    if (url.pathname.endsWith("/videos")) return json({ items: [video] });
    return json({ items: [{ id: `UC${"b".repeat(22)}`, snippet: { title: "Unrelated", customUrl: "@unrelated" } }] });
  } });
  await assert.rejects(providers.resolveChannel("youtube", `https://youtu.be/${video.id}`), { code: "channel_not_found" });
});

test("malformed YouTube lookup responses fail without making requests with invalid channel IDs", async () => {
  for (const body of [{}, { items: null }, { items: [{ id: video.id }] },
    { items: [{ id: video.id, snippet: { channelId: "invalid/channel?key=secret" } }] }]) {
    let calls = 0;
    const providers = createProviders({ youtubeApiKey: "key" }, { fetchImpl: async (url) => {
      calls++;
      assert.equal(url.pathname, "/youtube/v3/videos");
      return json(body);
    } });
    await assert.rejects(providers.resolveChannel("youtube", `https://youtu.be/${video.id}`), { code: "provider_unavailable" });
    assert.equal(calls, 1);
  }
  for (const body of [{}, { items: [{ id: channel.id }] }, { items: [{ id: "bad", snippet: { title: "DZR" } }] }]) {
    const providers = createProviders({ youtubeApiKey: "key" }, { fetchImpl: async () => json(body) });
    await assert.rejects(providers.resolveChannel("youtube", "@DZR"), { code: "provider_unavailable" });
  }
});

test("video lookup API failures preserve safe error codes without exposing credentials", async () => {
  for (const stage of ["videos", "channels"]) {
    for (const status of [403, 429, 503, "network", "json"]) {
      const providers = createProviders({ youtubeApiKey: "do-not-leak" }, { fetchImpl: async (url) => {
        if (!url.pathname.endsWith(`/${stage}`)) return json({ items: [video] });
        if (status === "network") throw new Error("URL contains do-not-leak");
        if (status === "json") return { ok: true, async json() { throw new Error("do-not-leak"); } };
        return json({}, status);
      } });
      await assert.rejects(providers.resolveChannel("youtube", `https://youtu.be/${video.id}`), (error) => {
        assert.equal(error.code, [403, 429].includes(status) ? "provider_quota" : "provider_unavailable");
        assert.ok(!JSON.stringify(error).includes("do-not-leak"));
        assert.ok(!error.stack.includes("do-not-leak"));
        return true;
      });
    }
  }
});

test("Twitch app tokens are cached, and only the registered live broadcaster is accepted", async () => {
  let tokens = 0;
  const providers = createProviders({ twitchClientId: "client", twitchClientSecret: "secret" }, { fetchImpl: async (url, options) => {
    if (String(url).includes("oauth2/token")) { tokens++; assert.ok(options.body.includes("client_secret=secret")); return json({ access_token: "token", expires_in: 3600 }); }
    assert.equal(options.headers.Authorization, "Bearer token");
    assert.equal(url.searchParams.get("user_id"), "1234");
    return json({ data: [{ id: "stream1", user_id: "1234", type: "live", title: "Racing", started_at: "2026-10-27T18:00:00Z" }] });
  } });
  const twitch = { id: "1234", url: "https://www.twitch.tv/dzr" };
  assert.equal((await providers.verify(twitch, { platform: "twitch" }, {})).streams[0].id, "stream1");
  await providers.verify(twitch, { platform: "twitch" }, {});
  assert.equal(tokens, 1);
});

test("provider errors never retain request headers, URLs or credentials", async () => {
  const providers = createProviders({ youtubeApiKey: "do-not-leak" }, { fetchImpl: async () => { throw new Error("URL contains do-not-leak"); } });
  await assert.rejects(providers.resolveChannel("youtube", "@DZR"), (error) => {
    assert.equal(error.code, "provider_unavailable");
    assert.ok(!JSON.stringify(error).includes("do-not-leak"));
    assert.ok(!error.stack.includes("do-not-leak"));
    return true;
  });
});

test("unknown platforms never call YouTube, Twitch or quota reservation", async () => {
  const providers = createProviders({}, { fetchImpl() { assert.fail("must not fetch for an unknown platform"); } });
  assert.throws(() => providers.requireConfigured("unknown"), { code: "unknown_platform" });
  await assert.rejects(providers.resolveChannel("unknown", "@DZR"), { code: "unknown_platform" });
  await assert.rejects(providers.verify(channel, { platform: "unknown" }, { reserveSearch() { assert.fail(); } }), { code: "unknown_platform" });
  await assert.rejects(providers.monitor(channel, { platform: "unknown" }), { code: "unknown_platform" });
  await assert.rejects(providers.recordings(channel, [{ platform: "unknown" }]), { code: "unknown_platform" });
});

test("verification includes a small provider thumbnail and tolerates missing or unsafe images", async () => {
  let image = "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg";
  const providers = createProviders({ youtubeApiKey: "key" }, { fetchImpl: async () => json({ items: [{ ...video,
    snippet: { ...video.snippet, thumbnails: { medium: { url: image } } } }] }) });
  const session = { platform: "youtube", videoId: video.id };
  const first = (await providers.verify(channel, session, {})).streams[0];
  assert.equal(first.thumbnail, image);
  image = "javascript:alert(1)";
  assert.ok(!Object.hasOwn((await providers.verify(channel, session, {})).streams[0], "thumbnail"));
  image = null;
  assert.ok(!Object.hasOwn((await providers.verify(channel, session, {})).streams[0], "thumbnail"));
});

test("YouTube monitoring checks the known ID directly and returns the actual end time", async () => {
  let current = video;
  const calls = [];
  const providers = createProviders({ youtubeApiKey: "key" }, { fetchImpl: async (url) => {
    calls.push(url);
    return json({ items: current ? [current] : [] });
  } });
  const stream = { platform: "youtube", id: video.id };
  assert.equal((await providers.monitor(channel, stream)).status, "live");
  current = { ...video, snippet: { ...video.snippet, liveBroadcastContent: "none" },
    liveStreamingDetails: { ...video.liveStreamingDetails, actualEndTime: "2026-10-27T19:42:00Z" } };
  assert.deepEqual(await providers.monitor(channel, stream), { status: "offline", endedAt: "2026-10-27T19:42:00.000Z" });
  current = { ...video, snippet: { ...video.snippet, channelId: "other-channel" } };
  assert.deepEqual(await providers.monitor(channel, stream), { status: "offline" });
  current = { ...video, status: { privacyStatus: "private" } };
  assert.deepEqual(await providers.monitor(channel, stream), { status: "offline" });
  current = null;
  assert.deepEqual(await providers.monitor(channel, stream), { status: "offline" });
  assert.ok(calls.every((url) => url.pathname.endsWith("/videos") && url.searchParams.get("id") === video.id));
});

test("Twitch monitoring follows the registered channel after a reconnect and resolves thumbnail dimensions", async () => {
  const twitchChannel = { id: "1234", url: "https://www.twitch.tv/dzr" };
  let current = { id: "stream2", user_id: "1234", type: "live", title: "Reconnected", started_at: "2026-10-27T18:02:00Z",
    thumbnail_url: "https://static-cdn.jtvnw.net/previews-ttv/live_user_dzr-{width}x{height}.jpg" };
  const providers = createProviders({ twitchClientId: "client", twitchClientSecret: "secret" }, { fetchImpl: async (url) => {
    if (String(url).includes("oauth2/token")) return json({ access_token: "token", expires_in: 3600 });
    assert.equal(url.searchParams.get("user_id"), "1234");
    return json({ data: current ? [current] : [] });
  } });
  const stream = { platform: "twitch", id: "stream1" };
  const result = await providers.monitor(twitchChannel, stream);
  assert.equal(result.status, "live");
  assert.equal(result.stream.id, "stream2");
  assert.equal(result.stream.thumbnail, "https://static-cdn.jtvnw.net/previews-ttv/live_user_dzr-320x180.jpg");
  current = null;
  assert.deepEqual(await providers.monitor(twitchChannel, stream), { status: "offline" });
});

test("monitoring errors and malformed responses never become confirmed offline status", async () => {
  for (const response of [json({}, 503), json({ unexpected: [] }), { ok: true, async json() { throw new Error("raw body"); } }]) {
    const providers = createProviders({ youtubeApiKey: "secret-key" }, { fetchImpl: async () => response });
    await assert.rejects(providers.monitor(channel, { platform: "youtube", id: video.id }), (error) => {
      assert.equal(error.code, "provider_unavailable");
      assert.ok(!error.stack.includes("raw body"));
      assert.ok(!JSON.stringify(error).includes("secret-key"));
      return true;
    });
  }
});

test("YouTube recordings accept public uploaded or processed replays of the matching ended broadcast", async () => {
  const archive = { ...video, snippet: { ...video.snippet, liveBroadcastContent: "none" },
    status: { privacyStatus: "public", uploadStatus: "processed" }, contentDetails: { duration: "PT1H42M" },
    liveStreamingDetails: { ...video.liveStreamingDetails, actualEndTime: "2026-10-27T19:42:00Z" } };
  let current = archive;
  const providers = createProviders({ youtubeApiKey: "key" }, { fetchImpl: async (url) => {
    assert.ok(url.pathname.endsWith("/videos"));
    assert.equal(url.searchParams.get("id"), video.id);
    assert.ok(url.searchParams.get("part").includes("contentDetails"));
    return json({ items: [current] });
  } });
  const stream = { platform: "youtube", id: video.id };
  for (const uploadStatus of ["uploaded", "processed"]) {
    current = { ...archive, status: { ...archive.status, uploadStatus } };
    assert.deepEqual(await providers.recordings(channel, [stream]), [{ id: video.id, streamId: video.id, title: "Racing",
      url: `https://www.youtube.com/watch?v=${video.id}`, startedAt: "2026-10-27T18:00:00.000Z" }]);
  }
  for (const changed of [
    { ...archive, id: "other-video" },
    { ...archive, snippet: { ...archive.snippet, channelId: "other-channel" } },
    { ...archive, status: { ...archive.status, privacyStatus: "private" } },
    ...["failed", "rejected", "deleted", undefined].map((uploadStatus) => ({ ...archive, status: { ...archive.status, uploadStatus } })),
    { ...archive, liveStreamingDetails: { actualStartTime: video.liveStreamingDetails.actualStartTime } },
  ]) {
    current = changed;
    assert.deepEqual(await providers.recordings(channel, [stream]), []);
  }
});

test("Twitch recordings follow pagination, match exact stream IDs and sort reconnect parts chronologically", async () => {
  const twitchChannel = { id: "1234", url: "https://www.twitch.tv/dzr" };
  const archive = { id: "900", stream_id: "stream2", user_id: "1234", type: "archive", viewable: "public", title: "Part two" };
  const cursors = [];
  const providers = createProviders({ twitchClientId: "client", twitchClientSecret: "secret" }, { fetchImpl: async (url) => {
    if (String(url).includes("oauth2/token")) return json({ access_token: "token", expires_in: 3600 });
    assert.ok(url.pathname.endsWith("/videos"));
    assert.equal(url.searchParams.get("user_id"), "1234");
    assert.equal(url.searchParams.get("type"), "archive");
    const cursor = url.searchParams.get("after"); cursors.push(cursor);
    return cursor ? json({ data: [{ ...archive, id: "899", stream_id: "stream1", title: "Part one" }] })
      : json({ data: [archive,
        { ...archive, id: "901", stream_id: "unrelated-latest" },
        { ...archive, id: "902", stream_id: "stream1", user_id: "other-user" },
        { ...archive, id: "903", stream_id: "stream1", viewable: "private" },
        { ...archive, id: "904", stream_id: "stream1", type: "highlight" }], pagination: { cursor: "next" } });
  } });
  const result = await providers.recordings(twitchChannel, [
    { platform: "twitch", id: "stream2", startedAt: "2026-10-27T18:10:00Z" },
    { platform: "twitch", id: "stream1", startedAt: "2026-10-27T18:00:00Z" },
  ]);
  assert.deepEqual(cursors, [null, "next"]);
  assert.deepEqual(result.map(({ id, streamId, url }) => ({ id, streamId, url })), [
    { id: "899", streamId: "stream1", url: "https://www.twitch.tv/videos/899" },
    { id: "900", streamId: "stream2", url: "https://www.twitch.tv/videos/900" },
  ]);
});

test("Twitch archive lookup is bounded when a matching recording is unavailable", async () => {
  let pages = 0;
  const providers = createProviders({ twitchClientId: "client", twitchClientSecret: "secret" }, { fetchImpl: async (url) => {
    if (String(url).includes("oauth2/token")) return json({ access_token: "token", expires_in: 3600 });
    pages++;
    return json({ data: [], pagination: { cursor: `page-${pages}` } });
  } });
  assert.deepEqual(await providers.recordings({ id: "1234" }, [{ platform: "twitch", id: "not-saved" }]), []);
  assert.equal(pages, 5);
});
