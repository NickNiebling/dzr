const { StreamingError, requirePlatform, parseChannel, youtubeLive } = require("./model");

// All outbound URLs are built here from validated IDs. No OBS/provider credentials cross to Discord.
function createProviders({ youtubeApiKey, twitchClientId, twitchClientSecret }, { fetchImpl = fetch, now = Date.now } = {}) {
  let twitchToken = null;
  let tokenRequest = null;
  const unavailable = () => new StreamingError("provider_unavailable", "Streamingtjenesten returnerede et ugyldigt svar. Prøv igen senere.", 503);
  const isoTime = (value) => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

  function thumbnail(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }

  function youtubeStream(video) {
    const image = ["medium", "high", "default"].map((size) => thumbnail(video.snippet?.thumbnails?.[size]?.url)).find(Boolean);
    return { platform: "youtube", id: video.id, title: String(video.snippet?.title || "Se livestream"),
      startedAt: isoTime(video.liveStreamingDetails?.actualStartTime), url: `https://www.youtube.com/watch?v=${video.id}`,
      ...(image ? { thumbnail: image } : {}) };
  }

  function twitchStream(channel, stream) {
    const startedAt = isoTime(stream.started_at);
    if (!stream.id || !startedAt) throw unavailable();
    const image = thumbnail(String(stream.thumbnail_url || "").replaceAll("{width}", "320").replaceAll("{height}", "180"));
    return { platform: "twitch", id: stream.id, title: String(stream.title || "Se livestream"), startedAt, url: channel.url,
      ...(image ? { thumbnail: image } : {}) };
  }

  async function readJson(response) {
    try { return await response.json(); }
    catch { throw unavailable(); }
  }

  function items(response, key) {
    if (!Array.isArray(response?.[key])) throw unavailable();
    return response[key];
  }

  async function request(url, options = {}) {
    let response;
    try { response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(8000) }); }
    catch { throw new StreamingError("provider_unavailable", "Streamingtjenesten svarer ikke. Prøv igen senere.", 503); }
    if (!response.ok) {
      throw new StreamingError(response.status === 429 || response.status === 403 ? "provider_quota" : "provider_unavailable",
        "Streamingtjenesten kunne ikke kontaktes. En admin kan kontrollere API-opsætningen.", 503);
    }
    return readJson(response);
  }

  function requireConfigured(platform) {
    requirePlatform(platform);
    if (platform === "youtube" ? !youtubeApiKey : !twitchClientId || !twitchClientSecret) {
      throw new StreamingError("provider_not_configured", `${platform === "youtube" ? "YouTube" : "Twitch"} er ikke konfigureret på DZR endnu. Kontakt en admin.`, 503);
    }
  }

  async function youtube(resource, params) {
    requireConfigured("youtube");
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    url.search = new URLSearchParams({ ...params, key: youtubeApiKey }).toString();
    return request(url);
  }

  async function accessToken() {
    requireConfigured("twitch");
    if (twitchToken && twitchToken.expiresAt > now() + 60_000) return twitchToken.value;
    if (!tokenRequest) {
      tokenRequest = request("https://id.twitch.tv/oauth2/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: twitchClientId, client_secret: twitchClientSecret, grant_type: "client_credentials" }).toString(),
      }).then((data) => {
        if (!data.access_token) throw new StreamingError("provider_unavailable", "Twitch-login mislykkedes.", 503);
        twitchToken = { value: data.access_token, expiresAt: now() + data.expires_in * 1000 };
        return twitchToken.value;
      }).finally(() => { tokenRequest = null; });
    }
    return tokenRequest;
  }

  async function twitch(resource, params) {
    const url = new URL(`https://api.twitch.tv/helix/${resource}`);
    url.search = new URLSearchParams(params).toString();
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await accessToken();
      let response;
      try { response = await fetchImpl(url, { headers: { "Client-Id": twitchClientId, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }); }
      catch { throw new StreamingError("provider_unavailable", "Twitch svarer ikke.", 503); }
      if (response.status === 401 && attempt === 0) { twitchToken = null; continue; }
      if (!response.ok) throw new StreamingError("provider_unavailable", "Twitch kunne ikke kontaktes.", 503);
      return readJson(response);
    }
  }

  async function resolveChannel(platform, input) {
    const parsed = parseChannel(platform, input);
    if (!parsed) return null;
    requireConfigured(platform);
    if (platform === "twitch") {
      const user = (await twitch("users", { login: parsed.login }))?.data?.[0];
      if (user && /^\d+$/.test(user.id)) return { id: user.id, title: user.display_name, url: `https://www.twitch.tv/${user.login}` };
    } else {
      let channelId = parsed.id;
      if (parsed.videoId) {
        const video = items(await youtube("videos", { part: "snippet", id: parsed.videoId }), "items")
          .find((item) => item?.id === parsed.videoId);
        if (!video) throw new StreamingError("channel_not_found", "Videoen blev ikke fundet. Brug et offentligt videolink eller et direkte kanallink.");
        channelId = video.snippet?.channelId;
        if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId || "")) throw unavailable();
      }
      const channels = items(await youtube("channels", { part: "snippet", ...(channelId ? { id: channelId } : { forHandle: parsed.handle }) }), "items");
      const channel = channelId ? channels.find((item) => item?.id === channelId) : channels[0];
      if (channel) {
        if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel.id) || typeof channel.snippet?.title !== "string") throw unavailable();
        const handle = channel.snippet.customUrl;
        const path = /^@[\p{L}\p{N}_.·-]{3,30}$/u.test(handle || "") ? handle : `channel/${channel.id}`;
        return { id: channel.id, title: channel.snippet.title, url: `https://www.youtube.com/${path}` };
      }
    }
    throw new StreamingError("channel_not_found", "Kanalen blev ikke fundet. Kontrollér link eller kanalnavn.");
  }

  // quota.reserveSearch is persistent and shared by every worker/registration, before each search call.
  async function verify(channel, session, quota) {
    requirePlatform(session.platform);
    if (session.platform === "twitch") {
      const streams = items(await twitch("streams", { user_id: channel.id, type: "live" }), "data");
      const stream = streams.find((item) => item.user_id === channel.id && item.type === "live");
      return { streams: stream ? [twitchStream(channel, stream)] : [], state: {} };
    }
    const state = { candidateIds: session.candidateIds || [],
      upcomingSearched: session.upcomingSearched || false };
    const found = [];
    async function checkVideos(ids) {
      if (!ids.length) return;
      const videos = items(await youtube("videos", { part: "snippet,status,liveStreamingDetails", id: ids.join(",") }), "items");
      state.candidateIds = videos.filter((video) => video.snippet?.channelId === channel.id
        && !video.liveStreamingDetails?.actualEndTime && ["upcoming", "live"].includes(video.snippet?.liveBroadcastContent))
        .map((video) => video.id).slice(0, 20);
      for (const video of videos) if (youtubeLive(video, channel.id)) {
        found.push(youtubeStream(video));
      }
    }
    await checkVideos(session.videoId ? [session.videoId] : state.candidateIds);
    if (!found.length) {
      // The durable worker owns backoff and the one-hour discovery window.
      if (await quota.reserveSearch()) {
        const result = await youtube("search", { part: "snippet", channelId: channel.id, type: "video", eventType: "live", maxResults: "10" });
        const ids = [...new Set([...state.candidateIds, ...items(result, "items").map((item) => item.id?.videoId).filter(Boolean)])];
        await checkVideos(ids);
        // OBS may send to YouTube's preview before Go Live. Discover upcoming IDs once,
        // then check their status first on later attempts. Keep searching for live videos
        // while candidates (including a saved OBS link) are not live; another scheduled
        // video must never hide the actual broadcast. A schedule cannot announce itself.
        if (!found.length && !state.candidateIds.length && !state.upcomingSearched && await quota.reserveSearch()) {
          state.upcomingSearched = true;
          const upcoming = await youtube("search", { part: "snippet", channelId: channel.id, type: "video", eventType: "upcoming", maxResults: "10" });
          await checkVideos(items(upcoming, "items").map((item) => item.id?.videoId).filter(Boolean));
        }
      } else {
        return { streams: found, state, error: "youtube_search_budget" };
      }
    }
    return { streams: found, state };
  }

  // Monitoring never uses YouTube search. Only discovery may spend the shared search budget.
  // API failures throw, so an unavailable provider cannot be mistaken for an ended broadcast.
  async function monitor(channel, stream) {
    requirePlatform(stream.platform);
    if (stream.platform === "twitch") {
      const streams = items(await twitch("streams", { user_id: channel.id, type: "live" }), "data");
      const current = streams.find((item) => item.user_id === channel.id);
      if (!current) return { status: "offline" };
      if (current.type !== "live") throw unavailable();
      return { status: "live", stream: twitchStream(channel, current) };
    }
    const videos = items(await youtube("videos", { part: "snippet,status,liveStreamingDetails", id: stream.id }), "items");
    const video = videos.find((item) => item.id === stream.id && item.snippet?.channelId === channel.id);
    if (youtubeLive(video, channel.id)) return { status: "live", stream: youtubeStream(video) };
    const endedAt = isoTime(video?.liveStreamingDetails?.actualEndTime);
    return { status: "offline", ...(endedAt ? { endedAt } : {}) };
  }

  async function recordings(channel, streams) {
    if (!streams.length) return [];
    const platform = streams[0].platform;
    requirePlatform(platform);
    if (streams.some((stream) => stream.platform !== platform)) throw unavailable();
    const expected = new Map(streams.map((stream) => [stream.id, stream]));
    const found = new Map();
    if (platform === "youtube") {
      const ids = [...expected.keys()];
      // The videos endpoint accepts at most 50 IDs per request.
      for (let offset = 0; offset < ids.length; offset += 50) {
        const videos = items(await youtube("videos", { part: "snippet,status,contentDetails,liveStreamingDetails",
          id: ids.slice(offset, offset + 50).join(",") }), "items");
        for (const video of videos) {
          const startedAt = isoTime(video.liveStreamingDetails?.actualStartTime);
          // Public stream replays can remain "uploaded" while YouTube processes the archive.
          if (!expected.has(video.id) || video.snippet?.channelId !== channel.id || video.status?.privacyStatus !== "public"
              || !["uploaded", "processed"].includes(video.status?.uploadStatus) || !startedAt || !isoTime(video.liveStreamingDetails?.actualEndTime)) continue;
          found.set(video.id, { id: video.id, streamId: video.id, title: String(video.snippet?.title || "Se optagelsen"),
            url: `https://www.youtube.com/watch?v=${video.id}`, startedAt });
        }
      }
    } else {
      let cursor;
      // Bound the work when some stream IDs have no saved VOD. Never fall back to a different archive.
      for (let page = 0; page < 5; page++) {
        const result = await twitch("videos", { user_id: channel.id, type: "archive", sort: "time", first: "100", ...(cursor ? { after: cursor } : {}) });
        for (const video of items(result, "data")) {
          if (!expected.has(video.stream_id) || video.user_id !== channel.id || video.type !== "archive"
              || video.viewable !== "public" || !/^\d+$/.test(video.id || "")) continue;
          const startedAt = isoTime(expected.get(video.stream_id).startedAt) || isoTime(video.created_at);
          found.set(video.stream_id, { id: video.id, streamId: video.stream_id, title: String(video.title || "Se optagelsen"),
            url: `https://www.twitch.tv/videos/${video.id}`, ...(startedAt ? { startedAt } : {}) });
        }
        cursor = result.pagination?.cursor;
        if (!cursor || found.size === expected.size) break;
      }
    }
    return [...found.values()].sort((a, b) => (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0) || a.id.localeCompare(b.id));
  }

  return { resolveChannel, verify, monitor, recordings, requireConfigured };
}

module.exports = { createProviders };
