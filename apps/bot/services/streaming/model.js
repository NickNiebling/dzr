const crypto = require("node:crypto");

const PLATFORMS = ["youtube", "twitch"];
const HEARTBEAT_TTL_MS = 150_000;
const CHECK_INTERVAL_MS = 15_000;
const DISCOVERY_WINDOW_MS = 60 * 60_000;
const checkDelay = (attempt) => Math.min(300_000, CHECK_INTERVAL_MS * 2 ** Math.min(attempt, 5));
const discoveryExpired = (session, now) => !session.discoveredAt && now >= session.startedAt + DISCOVERY_WINDOW_MS;
const SNOWFLAKE = /^\d{17,20}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

class StreamingError extends Error {
  constructor(code, userMessage, status = 400) {
    super(code);
    this.code = code;
    this.userMessage = userMessage;
    this.status = status;
  }
}

function requirePlatform(platform) {
  if (!PLATFORMS.includes(platform)) {
    throw new StreamingError("unknown_platform", "Ukendt streamingplatform. DZR understøtter YouTube og Twitch.");
  }
}

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const registrationKey = (guildId, discordId) => `${guildId}_${discordId}`;
const sessionKey = (registration, platform) => `${registration.id}_${platform}`;
const announcementKey = (channelId, stream) => hash(`${channelId}:${stream.platform}:${stream.id}`);

function createToken(discordId) {
  return `dzrs_${discordId}.${crypto.randomBytes(32).toString("base64url")}`;
}

function tokenOwner(token) {
  return /^dzrs_(\d{17,20})\.[A-Za-z0-9_-]{43}$/.exec(token || "")?.[1] || null;
}

function tokenMatches(token, tokenHash) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash || "")) return false;
  return crypto.timingSafeEqual(Buffer.from(hash(token), "hex"), Buffer.from(tokenHash, "hex"));
}

// Parse identities, never fetch user-supplied URLs (including redirects).
function parseChannel(platform, input) {
  requirePlatform(platform);
  let value = String(input || "").trim();
  if (!value) return null;
  if (value.length > 200) throw new StreamingError("invalid_channel", "Kanallinket er for langt.");
  if (/^(?:https?:\/\/|www\.|(?:www\.)?(?:youtube\.com|twitch\.tv)\/)/i.test(value)) {
    let url;
    try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { /* validated below */ }
    const hosts = platform === "youtube" ? ["youtube.com", "www.youtube.com"] : ["twitch.tv", "www.twitch.tv"];
    if (!url || !hosts.includes(url.hostname.toLowerCase()) || url.username || url.password || url.port || url.search || url.hash) {
      throw new StreamingError("invalid_channel", "Brug et direkte kanallink fra youtube.com eller twitch.tv.");
    }
    try { value = decodeURIComponent(url.pathname).replace(/\/$/, "").slice(1); } catch { value = ""; }
  }
  if (platform === "twitch" && /^[A-Za-z0-9_]{1,25}$/.test(value)) return { login: value.toLowerCase() };
  if (platform === "youtube") {
    value = value.replace(/^channel\//, "");
    if (/^UC[A-Za-z0-9_-]{22}$/.test(value)) return { id: value };
    if (/^@[\p{L}\p{N}_.·-]{3,30}$/u.test(value)) return { handle: value };
  }
  throw new StreamingError("invalid_channel", platform === "youtube"
    ? "YouTube: brug https://www.youtube.com/@kanal eller et /channel/UC…-link."
    : "Twitch: brug dit kanalnavn eller https://www.twitch.tv/kanal.");
}

function parseEvent(body, now = Date.now()) {
  // Legacy scripts supply their OBS output service. It is only a hint now:
  // discovery checks the member's registered channels, including multistream outputs.
  if (body?.platform != null) requirePlatform(body.platform);
  if (!body || !["started", "heartbeat", "stopped", "test"].includes(body.event)
      || !/^[A-Za-z0-9_-]{16,80}$/.test(body.sessionId || "") || !Number.isSafeInteger(body.sequence) || body.sequence < 1
      || !Number.isSafeInteger(body.startedAt) || !Number.isSafeInteger(body.sentAt)
      || Math.abs(body.sentAt - now) > 120_000 || body.startedAt > body.sentAt || body.startedAt < now - 7 * 86400_000
      || (body.videoId && !VIDEO_ID.test(body.videoId))) {
    throw new StreamingError("invalid_event", "Ugyldig eller udløbet OBS-hændelse. Tjek computerens ur.");
  }
  return { platform: body.platform ?? null, event: body.event, sessionId: body.sessionId, sequence: body.sequence,
    startedAt: body.startedAt, sentAt: body.sentAt, videoId: body.videoId || null };
}

function youtubeLive(video, channelId) {
  const live = video?.liveStreamingDetails;
  return video?.snippet?.channelId === channelId && video?.status?.privacyStatus === "public"
    && video.snippet.liveBroadcastContent === "live" && Number.isFinite(Date.parse(live?.actualStartTime)) && !live.actualEndTime;
}

function announcementMessage(registration, stream) {
  requirePlatform(stream.platform);
  return {
    content: `🔴 <@${registration.discordId}> er live på ${stream.platform === "youtube" ? "YouTube" : "Twitch"}!`,
    embeds: [{ title: String(stream.title || "Se livestream").slice(0, 256), url: stream.url,
      color: stream.platform === "youtube" ? 0xff0000 : 0x9146ff, timestamp: stream.startedAt }],
    allowedMentions: { parse: [] },
  };
}

const PLATFORM_PRESENTATION = {
  youtube: { name: "YouTube", color: 0xff0000, emoji: "🔴" },
  twitch: { name: "Twitch", color: 0x9146ff, emoji: "🟣" },
};

const asTime = (value) => typeof value === "number" ? value : Date.parse(value);

function durationText(state) {
  const duration = Number.isFinite(state.durationMs) ? state.durationMs
    : (state.segments || []).reduce((total, segment) => {
      const start = asTime(segment.stream?.startedAt);
      const end = asTime(segment.endedAt);
      return total + (Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0);
    }, 0);
  const minutes = Math.floor(Math.max(0, duration) / 60_000);
  const formatted = minutes < 1 ? "under 1 min."
    : minutes >= 60 ? `${Math.floor(minutes / 60)} t. ${minutes % 60} min.` : `${minutes} min.`;
  return `${state.approximate || state.segments?.some((segment) => segment.approximate) ? "ca. " : ""}${formatted}`;
}

function broadcastMessage(registration, broadcast) {
  const embeds = [];
  const buttons = [];
  for (const platform of PLATFORMS) {
    const state = broadcast.platforms?.[platform];
    if (!state?.stream) continue;
    const { name, color, emoji } = PLATFORM_PRESENTATION[platform];
    const ended = state.status === "ended";
    const stream = state.stream;
    const originalStart = state.segments?.[0]?.stream?.startedAt || stream.startedAt;
    const startedAt = asTime(originalStart);
    const recordings = state.recordings || [];
    const url = ended ? recordings[0]?.url : stream.url;
    const embed = {
      author: { name: `${name} · ${ended ? "⚪ Afsluttet" : "🔴 LIVE"}` },
      title: String(stream.title || "Se livestream").slice(0, 256),
      color,
      description: ended ? `⚪ Afsluttet · Var live i ${durationText(state)}`
        : `🕒 Startede kl. <t:${Math.floor(startedAt / 1000)}:t> · <t:${Math.floor(startedAt / 1000)}:R>`,
    };
    // Keep a stable original start in the machine-readable timestamp for send recovery.
    if (Number.isFinite(startedAt)) embed.timestamp = new Date(startedAt).toISOString();
    if (url) embed.url = url;
    if (stream.thumbnail) embed.thumbnail = { url: stream.thumbnail };
    if (ended && recordings.length > 1) {
      let parts = "";
      for (const [index, recording] of recordings.entries()) {
        const line = `\n[Del ${index + 1}](${recording.url})`;
        // Two embeds, their titles and author names must fit Discord's 6000-character total.
        if (embed.description.length + parts.length + line.length > 2400) break;
        parts += line;
      }
      embed.description += parts;
    }
    embeds.push(embed);
    if (url) buttons.push({ type: 2, style: 5, emoji: { name: emoji },
      label: `${ended ? "Se optagelsen på" : "Se på"} ${name}`, url });
  }
  return {
    content: broadcast.endedAt ? `⚪ <@${registration.discordId}> har afsluttet sin stream.` : `🔴 <@${registration.discordId}> er live nu!`,
    embeds,
    components: buttons.length ? [{ type: 1, components: buttons }] : [],
    allowedMentions: { parse: [] },
  };
}

module.exports = { PLATFORMS, HEARTBEAT_TTL_MS, CHECK_INTERVAL_MS, DISCOVERY_WINDOW_MS, checkDelay, discoveryExpired, SNOWFLAKE, VIDEO_ID, StreamingError,
  hash, registrationKey, sessionKey, announcementKey, createToken, tokenOwner, tokenMatches, requirePlatform, parseChannel, parseEvent,
  youtubeLive, announcementMessage, broadcastMessage };
