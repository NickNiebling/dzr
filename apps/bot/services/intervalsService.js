const crypto = require("crypto");
const { FieldValue } = require("firebase-admin/firestore");
const config = require("../config/config");
const shared = require("../constants.json");
const { db, getUserZwiftId, getLatestClubStats, isPaidClubMember } = require("./firebase");
const metrics = require("./streamMetrics");
const discovery = require("./activityDataDiscovery");
const { phenotypeLabel } = require("../utils/phenotype");
const weeklyLoad = require("./weeklyLoad");
const powerCurves = require("./powerCurves");
const {
  canEncryptTokens,
  encryptedTokenFields,
  needsTokenMigration,
  readConnectionTokens,
} = require("./tokenCrypto");

const COLLECTION = shared.firestore.intervalsConnections || "intervals_connections";
const API = "https://intervals.icu/api/v1";
// intervals.icu returns every activity, wellness row, and event in oldest/newest. It only
// truncates when limit is sent, so these calls do not send one.
const EARLIEST = "1970-01-01";
const CONNECT_TOKEN_TTL_MS = 15 * 60 * 1000;
const STREAM_CACHE_COLLECTION = "coach_activity_metrics";
const USER_AGENT = "DZR-Coach/1.0";
// Bump when activity metrics change shape or meaning, so stale cache rows are recomputed.
const METRICS_CACHE_VERSION = 8;

function notClubMemberResult() {
  return {
    success: false,
    not_club_member: true,
    message: "DZR Coach is only available to paid club members for the current year.",
  };
}

function hmac(body, secret) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

function connectSecret() {
  return String(config.intervals?.connectSecret || "").trim();
}

function mintConnectToken(discordId, ttlMs = CONNECT_TOKEN_TTL_MS) {
  const secret = connectSecret();
  if (!secret) return null;
  const payload = { d: String(discordId), e: Date.now() + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body, secret)}`;
}

function getConnectUrl(discordId) {
  const token = mintConnectToken(discordId);
  if (!token) return null;
  const origin = String(config.intervals?.siteOrigin || shared.siteOrigin || "").replace(/\/+$/, "");
  return `${origin}/intervals/connect?token=${encodeURIComponent(token)}&force=1`;
}

async function hasClubMemberRole(userId) {
  return isPaidClubMember(userId);
}

async function getConnection(discordId) {
  const snap = await db.collection(COLLECTION).doc(String(discordId)).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  let tokens;
  try {
    tokens = readConnectionTokens(data);
  } catch (err) {
    console.error("intervals token decrypt failed:", err?.message || err);
    return null;
  }
  const conn = {
    id: snap.id,
    ...data,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
  if (needsTokenMigration(data) && tokens.accessToken) {
    try {
      await persistEncryptedTokens(discordId, tokens.accessToken);
    } catch (err) {
      console.warn("intervals token migration failed:", err?.message || err);
    }
  }
  return conn;
}

async function persistEncryptedTokens(discordId, accessToken) {
  const patch = encryptedTokenFields(accessToken, "");
  if (canEncryptTokens()) {
    patch.accessToken = FieldValue.delete();
    patch.refreshToken = FieldValue.delete();
  }
  patch.updatedAt = new Date();
  await db.collection(COLLECTION).doc(String(discordId)).set(patch, { merge: true });
}

async function isConnected(discordId) {
  const conn = await getConnection(discordId);
  return Boolean(conn && String(conn.accessToken || "").trim());
}

function reconnectResult(discordId) {
  return {
    success: false,
    needs_reconnect: true,
    connectUrl: getConnectUrl(discordId),
    message: "intervals.icu connection was revoked. Reconnect via the link.",
  };
}

function copenhagenDate(offsetDays = 0) {
  const iso = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Copenhagen",
  }).format(new Date());
  if (!offsetDays) return iso;
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
}

async function intervalsFetch(discordId, path, { method = "GET", body = null } = {}) {
  const conn = await getConnection(discordId);
  if (!conn?.accessToken) {
    const err = new Error("not_connected");
    err.code = "not_connected";
    throw err;
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    const err = new Error("intervals_unauthorized");
    err.code = "needs_reconnect";
    err.status = res.status;
    throw err;
  }
  if (res.status === 403) {
    const err = new Error("intervals_forbidden");
    err.code = "scope_denied";
    err.status = res.status;
    throw err;
  }
  if (res.status === 429) {
    const err = new Error("intervals_rate_limited");
    err.code = "rate_limited";
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`intervals ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { data, conn };
}

async function wrapCall(discordId, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.code === "not_connected" || err?.code === "needs_reconnect") {
      return reconnectResult(discordId);
    }
    if (err?.code === "rate_limited") {
      return { success: false, message: "intervals.icu rate limit reached. Try again in a few minutes." };
    }
    if (err?.code === "scope_denied") {
      return {
        success: false,
        scope_denied: true,
        message: "intervals.icu refused that permission. Reconnect and allow the requested access.",
      };
    }
    console.error("intervalsService error:", err?.message || err);
    return { success: false, message: "Could not fetch intervals.icu data. Try again later." };
  }
}

function isUnreadableSource(activity) {
  return String(activity?.source || "").toUpperCase() === "STRAVA";
}

function num(value) {
  // Number(null) and Number("") are 0, which would turn a missing reading into a real zero.
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function compactActivity(activity) {
  if (!activity || typeof activity !== "object") return null;
  if (isUnreadableSource(activity)) {
    return {
      id: activity.id ?? null,
      start_date: activity.start_date_local || activity.start_date || null,
      source: "STRAVA",
      unavailable: true,
    };
  }
  const device = String(activity.device_name || "");
  const type = activity.type || activity.sport_type || null;
  return {
    id: activity.id,
    name: activity.name || null,
    sport_type: type,
    start_date: activity.start_date_local || activity.start_date || null,
    timezone: activity.timezone || null,
    moving_time: activity.moving_time ?? null,
    elapsed_time: activity.elapsed_time ?? null,
    distance_m: activity.distance ?? null,
    elevation_gain_m: activity.total_elevation_gain ?? null,
    average_heartrate: activity.average_heartrate ?? null,
    max_heartrate: activity.max_heartrate ?? null,
    average_watts: activity.icu_average_watts ?? activity.average_watts ?? null,
    weighted_average_watts: activity.icu_weighted_avg_watts ?? activity.weighted_average_watts ?? null,
    max_watts: activity.max_watts ?? null,
    kilojoules: activity.icu_joules != null ? Math.round(Number(activity.icu_joules) / 1000) : activity.kilojoules ?? null,
    training_load: activity.icu_training_load ?? null,
    trainer: type === "VirtualRide" || activity.indoor === true,
    commute: false,
    source: activity.source || null,
    device_name: device || null,
    garmin: /garmin/i.test(device),
  };
}

function readableActivities(list) {
  const rows = (Array.isArray(list) ? list : []).map(compactActivity).filter(Boolean);
  const activities = rows.filter((row) => !row.unavailable);
  const skippedUnreadable = rows.length - activities.length;
  return { activities, skippedUnreadable };
}

function unreadableSourceMessage(skipped) {
  if (!skipped) return null;
  return (
    `${skipped} activities came from the Strava API into intervals.icu and cannot be read. ` +
    "Connect Zwift directly in intervals.icu (Settings → Connections), and a head unit for outdoor rides. " +
    "Old rides need Download Old Data from Zwift, or Import All Strava Data from a Strava archive."
  );
}

function pickSportSettings(list) {
  const rows = Array.isArray(list) ? list : list ? [list] : [];
  const score = (row) => {
    const types = Array.isArray(row?.types) ? row.types : [];
    if (types.includes("VirtualRide")) return 3;
    if (types.includes("Ride")) return 2;
    if (row?.ftp || row?.indoor_ftp) return 1;
    return 0;
  };
  return rows.slice().sort((a, b) => score(b) - score(a))[0] || null;
}

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return { firstname: parts[0] || null, lastname: parts.slice(1).join(" ") || null };
}

function heightCm(athlete) {
  const height = num(athlete?.height);
  if (height == null || height <= 0) return null;
  const units = String(athlete?.height_units || "").toUpperCase();
  if (units.includes("METER") || units === "M" || height < 3) return Math.round(height * 1000) / 10;
  if (units.includes("FEET") || units === "FT") return Math.round(height * 30.48 * 10) / 10;
  return Math.round(height * 10) / 10;
}

async function latestWellnessWeight(discordId) {
  const newest = copenhagenDate(0);
  const oldest = EARLIEST;
  const { data } = await intervalsFetch(
    discordId,
    `/athlete/0/wellness?oldest=${oldest}&newest=${newest}`
  );
  const rows = (Array.isArray(data) ? data : [])
    .map((row) => ({ date: String(row.id || row.date || ""), weight: num(row.weight) }))
    .filter((row) => row.date && row.weight != null && row.weight > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  return rows[0] || null;
}

async function getAthleteProfile(discordId) {
  return wrapCall(discordId, async () => {
    const [{ data: athlete }, settingsRes, scale] = await Promise.all([
      intervalsFetch(discordId, "/athlete/0"),
      intervalsFetch(discordId, "/athlete/0/sport-settings").catch((err) => {
        if (err?.code === "needs_reconnect" || err?.code === "not_connected") throw err;
        return { data: [] };
      }),
      latestWellnessWeight(discordId).catch((err) => {
        if (err?.code === "needs_reconnect" || err?.code === "not_connected") throw err;
        return null;
      }),
    ]);
    const sport = pickSportSettings(settingsRes.data);
    const names = splitName(athlete?.name);
    const ftp = num(sport?.indoor_ftp) || num(sport?.ftp) || num(athlete?.icu_ftp);
    const profileWeight = num(athlete?.icu_weight) || num(athlete?.weight) || num(sport?.weight);
    return {
      success: true,
      athlete: {
        id: athlete?.id ?? null,
        firstname: names.firstname,
        lastname: names.lastname,
        city: null,
        country: null,
        sex: athlete?.sex || null,
        weight_kg: scale?.weight || profileWeight,
        weight_date: scale?.weight ? scale.date : null,
        height_cm: heightCm(athlete),
        ftp,
        clubs: [],
      },
    };
  });
}

function rideTotals(activities) {
  return activities.reduce(
    (acc, activity) => {
      const type = String(activity.sport_type || "");
      if (type && !/ride/i.test(type)) return acc;
      acc.count += 1;
      acc.distance += Number(activity.distance_m) || 0;
      acc.moving_time += Number(activity.moving_time) || 0;
      acc.elevation_gain += Number(activity.elevation_gain_m) || 0;
      return acc;
    },
    { count: 0, distance: 0, moving_time: 0, elevation_gain: 0 }
  );
}

function curvePoints(secs, watts) {
  const points = [];
  if (!Array.isArray(secs)) return points;
  const values = Array.isArray(watts) ? watts : [];
  secs.forEach((seconds, i) => {
    const s = num(seconds);
    const w = num(values[i]);
    if (s && w) points.push({ seconds: s, watts: Math.round(w) });
  });
  return points;
}

function compactCurves(data) {
  const list = Array.isArray(data?.list) ? data.list : [];
  if (list.length) {
    return list
      .map((curve) => ({
        id: curve.id || curve.label || null,
        points: curvePoints(curve.secs, Array.isArray(curve.values) ? curve.values : curve.watts),
      }))
      .filter((curve) => curve.points.length);
  }
  if (Array.isArray(data)) {
    return [{
      id: null,
      points: curvePoints(
        data.map((row) => row?.secs ?? row?.seconds ?? row?.duration),
        data.map((row) => row?.watts ?? row?.power)
      ),
    }].filter((curve) => curve.points.length);
  }
  if (data && Array.isArray(data.secs)) {
    const one = curvePoints(data.secs, data.watts);
    return one.length ? [{ id: null, points: one }] : [];
  }
  return [];
}

async function getAthleteStats(discordId) {
  return wrapCall(discordId, async () => {
    const newest = copenhagenDate(0);
    const yearStart = `${newest.slice(0, 4)}-01-01`;
    const recentStart = copenhagenDate(-28);
    const { data } = await intervalsFetch(
      discordId,
      `/athlete/0/activities?oldest=${EARLIEST}&newest=${newest}`
    );
    const { activities, skippedUnreadable } = readableActivities(data);
    const recent = activities.filter((activity) => String(activity.start_date || "") >= recentStart);
    const thisYear = activities.filter((activity) => String(activity.start_date || "") >= yearStart);
    let fitness = null;
    try {
      const wellness = await intervalsFetch(discordId, `/athlete/0/wellness/${newest}`);
      const row = wellness.data || {};
      const ctl = num(row.ctl);
      const atl = num(row.atl);
      if (ctl != null || atl != null) {
        fitness = { date: newest, ctl, atl, form: ctl != null && atl != null ? Math.round((ctl - atl) * 10) / 10 : null };
      }
    } catch (err) {
      if (err?.code === "needs_reconnect" || err?.code === "not_connected") throw err;
    }
    let powerCurves = [];
    try {
      const curve = await intervalsFetch(
        discordId,
        `/athlete/0/power-curves?type=Ride&curves=${encodeURIComponent("28d,all")}&newest=${newest}`
      );
      powerCurves = compactCurves(curve.data);
    } catch (err) {
      if (err?.code === "needs_reconnect" || err?.code === "not_connected") throw err;
    }
    return {
      success: true,
      stats: {
        recent_ride_totals: rideTotals(recent),
        ytd_ride_totals: rideTotals(thisYear),
        all_time_ride_totals: rideTotals(activities),
        fitness,
        power_curves: powerCurves,
      },
      message: unreadableSourceMessage(skippedUnreadable),
    };
  });
}

async function getAthleteZones(discordId) {
  return wrapCall(discordId, async () => {
    const { data: athlete } = await intervalsFetch(discordId, "/athlete/0");
    const sport = pickSportSettings(athlete?.sportSettings);
    if (!sport) return { success: true, zones: { heart_rate: null, power: null } };
    return {
      success: true,
      zones: {
        heart_rate: {
          lthr: sport.lthr ?? null,
          max_hr: sport.max_hr ?? null,
          resting_hr: num(athlete?.icu_resting_hr),
          zones: sport.hr_zones || null,
        },
        power: {
          ftp: num(sport.indoor_ftp) || num(sport.ftp),
          zones: sport.power_zones || null,
        },
      },
    };
  });
}

async function listActivities(discordId, oldest, newest) {
  const { data } = await intervalsFetch(
    discordId,
    `/athlete/0/activities?oldest=${encodeURIComponent(oldest)}&newest=${encodeURIComponent(newest)}`
  );
  return readableActivities(data);
}

function isoDay(value) {
  const day = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

function shiftIsoDay(iso, days) {
  const [year, month, day] = String(iso || "").split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return "";
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function lookbackDays(days, fallback) {
  const n = Math.floor(Number(days));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function spanDays(start, end) {
  const span = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000
  );
  return Number.isFinite(span) ? Math.max(0, span) : 0;
}

function activityListWindow({ days, oldest, newest } = {}) {
  const today = copenhagenDate(0);
  let end = isoDay(newest) || today;
  if (end > today) end = today;
  let start = isoDay(oldest);
  if (!start) start = shiftIsoDay(end, -lookbackDays(days, 14));
  if (start > end) start = end;
  return { oldest: start, newest: end, days: spanDays(start, end) };
}

async function getRecentActivities(discordId, options = {}) {
  const window = activityListWindow(options);
  return wrapCall(discordId, async () => {
    const { activities, skippedUnreadable } = await listActivities(discordId, window.oldest, window.newest);
    const ordered = activities
      .slice()
      .sort((a, b) => String(a.start_date || "").localeCompare(String(b.start_date || "")));
    const unread = unreadableSourceMessage(skippedUnreadable);
    return {
      success: true,
      days: window.days,
      oldest: window.oldest,
      newest: window.newest,
      activities: ordered,
      ...(unread ? { message: unread } : {}),
    };
  });
}

function compactIntervals(activity) {
  const rows = Array.isArray(activity?.icu_intervals) ? activity.icu_intervals : [];
  const normalized = new Set([
    "elapsed_time",
    "moving_time",
    "distance",
    "average_watts",
    "average_heartrate",
    "zone",
    "decoupling",
  ]);
  return rows.map((row) => {
    const discovered = discovery.discoverActivityFields(row).values;
    const sourceData = Object.fromEntries(
      Object.entries(discovered).filter(([key]) => !normalized.has(key))
    );
    return {
      name: row.type || null,
      elapsed_time: row.elapsed_time ?? null,
      moving_time: row.moving_time ?? null,
      distance_m: row.distance ?? null,
      average_watts: row.average_watts ?? null,
      average_heartrate: row.average_heartrate ?? null,
      zone: row.zone ?? null,
      decoupling: row.decoupling ?? null,
      ...(Object.keys(sourceData).length ? { sourceData } : {}),
    };
  });
}

async function getActivityDetails(discordId, activityId) {
  const id = String(activityId || "").trim();
  if (!/^[A-Za-z0-9]+$/.test(id)) return { success: false, message: "Invalid activity id." };
  return wrapCall(discordId, async () => {
    const { data, conn } = await intervalsFetch(discordId, `/activity/${encodeURIComponent(id)}?intervals=true`);
    if (isUnreadableSource(data)) {
      return { success: false, message: unreadableSourceMessage(1) };
    }
    const owner = data?.icu_athlete_id || data?.athlete_id;
    if (conn.athleteId && owner && String(owner) !== String(conn.athleteId)) {
      return { success: false, message: "That activity is not yours." };
    }
    const base = compactActivity(data);
    return {
      success: true,
      activity: {
        ...base,
        description: typeof data?.description === "string" ? data.description.slice(0, 400) : null,
        calories: data?.calories ?? null,
        average_cadence: data?.average_cadence ?? null,
        device_watts: data?.icu_ignore_power === true ? false : base?.average_watts != null || base?.weighted_average_watts != null,
        athlete_id: owner ?? null,
        laps: compactIntervals(data),
        garmin_note: base?.garmin
          ? "These numbers include data from a Garmin device. Say so if you display them."
          : null,
      },
    };
  });
}

/** The entries of `fields` whose value is not null or undefined. */
function withPresent(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value != null));
}

function streamArray(streams, names) {
  for (const name of names) {
    // intervals.icu returns streams as [{ type, data }]; older callers passed an object keyed by type.
    const value = Array.isArray(streams) ? streams.find((s) => s?.type === name) : streams?.[name];
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.data)) return value.data;
  }
  return [];
}

const NORMALIZED_STREAM_TYPES = [
  "time",
  "watts",
  "fixed_watts",
  "heartrate",
  "heart_rate",
  "fixed_heartrate",
  "cadence",
  "core_temperature",
  "skin_temperature",
  "temp",
  "smo2",
  "thb",
  "respiration",
  "tidal_volume",
  "tidal_volume_min",
  "w_bal",
  "altitude",
  "fixed_altitude",
  "grade_smooth",
  "velocity_smooth",
];

const NORMALIZED_ACTIVITY_FIELDS = new Set([
  "moving_time",
  "elapsed_time",
  "distance",
  "total_elevation_gain",
  "average_heartrate",
  "max_heartrate",
  "average_cadence",
  "icu_average_watts",
  "average_watts",
  "icu_weighted_avg_watts",
  "weighted_average_watts",
  "max_watts",
  "icu_joules",
  "kilojoules",
  "icu_training_load",
  "icu_ftp",
  "icu_w_prime",
  "icu_pm_w_prime",
  "icu_zone_times",
  "icu_hr_zone_times",
  "icu_ignore_power",
  "indoor",
]);

function safeStreamTypes(types) {
  const rows = Array.isArray(types) ? types : typeof types === "string" ? types.split(",") : [];
  return [...new Set(rows
    .map(String)
    .map((type) => type.trim())
    .filter((type) => /^[A-Za-z0-9_:-]{1,80}$/.test(type)))];
}

function streamWindow(series, fromSeconds = 0, toSeconds = Infinity) {
  if (!Array.isArray(series)) return [];
  const from = Math.max(0, Math.floor(Number(fromSeconds) || 0));
  const numericTo = Number(toSeconds);
  const to = Number.isFinite(numericTo) ? Math.max(from, Math.floor(numericTo)) : series.length;
  return series.slice(from, to);
}

function additionalStreamSummary(streams, fromSeconds = 0, toSeconds = Infinity) {
  const window = (name) => streamWindow(streams[name], fromSeconds, toSeconds);
  const positive = (name, digits = 1) =>
    metrics.seriesStats(window(name), { digits, positiveOnly: true });
  const signed = (name, digits = 1) =>
    metrics.seriesStats(window(name), { digits });
  const speed = positive("speed", 1);
  const wPrime = signed("wPrimeBalance", 0);
  const wPrimeValues = window("wPrimeBalance")
    .filter((value) => value != null && value !== "" && Number.isFinite(Number(value)))
    .map(Number);

  const summary = {
    ambientTemperatureC: signed("ambientTemperature", 2),
    skinTemperatureC: metrics.temperatureStats(window("skinTemperature")),
    muscleOxygenPercent: positive("smo2", 1),
    totalHemoglobinGdl: positive("thb", 2),
    respirationBreathsPerMinute: positive("respiration", 1),
    tidalVolumeLitresPerBreath: positive("tidalVolume", 2),
    minuteVentilationLitresPerMinute: positive("minuteVentilation", 1),
    altitudeM: signed("altitude", 1),
    gradientPercent: signed("gradient", 1),
    speedKph: speed
      ? {
          average: Number((speed.average * 3.6).toFixed(1)),
          min: Number((speed.min * 3.6).toFixed(1)),
          max: Number((speed.max * 3.6).toFixed(1)),
        }
      : null,
    wPrimeBalanceJ: wPrime
      ? {
          start: Math.round(wPrimeValues[0]),
          end: Math.round(wPrimeValues[wPrimeValues.length - 1]),
          min: Math.round(wPrime.min),
          max: Math.round(wPrime.max),
        }
      : null,
  };
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value != null));
}

/**
 * Seconds per zone as intervals.icu computed them, keyed by zone name. Power zone times arrive as
 * [{ id: "Z1", secs }] (including a sweet-spot "SS" entry that overlaps Z3/Z4); HR zone times as a
 * plain array of seconds.
 */
function zoneSeconds(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = {};
  raw.forEach((entry, i) => {
    const isObject = entry && typeof entry === "object";
    const seconds = num(isObject ? entry.secs ?? entry.seconds : entry);
    if (seconds == null) return;
    const name = isObject && entry.id ? String(entry.id) : `Z${i + 1}`;
    out[name] = Math.round(seconds);
  });
  return Object.keys(out).length ? out : null;
}

/** Minutes from the tool call to a [from, to) window in seconds, or null for the whole ride. */
function parseMinuteRange(fromMinute, toMinute) {
  const from = fromMinute == null || fromMinute === "" ? null : Number(fromMinute);
  const to = toMinute == null || toMinute === "" ? null : Number(toMinute);
  if (from == null && to == null) return null;
  if ((from != null && (!Number.isFinite(from) || from < 0)) || (to != null && !Number.isFinite(to))) {
    return { error: "from_minute and to_minute must be minutes from the start of the ride." };
  }
  const fromSeconds = Math.round((from ?? 0) * 60);
  const toSeconds = to == null ? Infinity : Math.round(to * 60);
  if (toSeconds - fromSeconds < 30) return { error: "The time range must be at least 30 seconds long." };
  return { fromSeconds, toSeconds };
}

async function getActivityMetrics(discordId, activityId, { fromMinute, toMinute } = {}) {
  const id = String(activityId || "").trim();
  if (!/^[A-Za-z0-9]+$/.test(id)) return { success: false, message: "Invalid activity id." };
  const range = parseMinuteRange(fromMinute, toMinute);
  if (range?.error) return { success: false, message: range.error };

  const cacheRef = db.collection(STREAM_CACHE_COLLECTION).doc(id);
  // A time range needs the streams themselves; the cache only holds the whole-ride summary.
  if (!range) {
    try {
      const cached = await cacheRef.get();
      if (cached.exists) {
        const data = cached.data() || {};
        if (String(data.discordId) === String(discordId) && data.version === METRICS_CACHE_VERSION) {
          return { success: true, cached: true, metrics: data.metrics || null, message: data.message || null };
        }
      }
    } catch (err) {
      console.warn("activity metrics cache read failed:", err?.message || err);
    }
  }

  return wrapCall(discordId, async () => {
    const { data: activity, conn } = await intervalsFetch(
      discordId,
      `/activity/${encodeURIComponent(id)}?intervals=true`
    );
    if (isUnreadableSource(activity)) {
      return { success: true, metrics: null, message: unreadableSourceMessage(1) };
    }
    const powerUsable = activity?.icu_ignore_power !== true;
    const activityWPrime = num(activity?.icu_w_prime);
    const modelWPrime = num(activity?.icu_pm_w_prime);
    const wPrimeCapacityJ = activityWPrime ?? modelWPrime;
    const advertisedStreamTypes = safeStreamTypes(activity?.stream_types);
    const activityDiscovery = discovery.discoverActivityFields(activity);

    let streams = null;
    let streamsFailed = false;
    try {
      const baseStreamTypes = ["time", "watts", "heartrate", "cadence"];
      // Request every stream Intervals advertises. Known streams get sport-specific calculations;
      // future or custom numeric streams automatically get compact generic summaries below.
      const requestedTypes = [...new Set([...baseStreamTypes, ...advertisedStreamTypes])];
      // W′bal is often derived from FTP, W′ and power instead of being advertised like a sensor
      // stream. Request it whenever Intervals supplied a W′ capacity; we still compute a local
      // fallback below if no trace comes back.
      if (wPrimeCapacityJ != null && !requestedTypes.includes("w_bal")) requestedTypes.push("w_bal");
      const streamRes = await intervalsFetch(
        discordId,
        `/activity/${encodeURIComponent(id)}/streams.json?types=${requestedTypes.map(encodeURIComponent).join(",")}`
      );
      streams = streamRes.data;
    } catch (err) {
      if (err?.code === "needs_reconnect" || err?.code === "not_connected" || err?.code === "rate_limited") throw err;
      streamsFailed = true;
      console.warn(`activity ${id} streams fetch failed:`, err?.message || err);
    }

    const time = streamArray(streams, ["time"]);
    const watts = powerUsable
      ? metrics.resampleTo1Hz(time, streamArray(streams, ["watts", "fixed_watts"]), "zero")
      : [];
    const heartrate = metrics.resampleTo1Hz(time, streamArray(streams, ["heartrate", "heart_rate", "fixed_heartrate"]), "hold");
    const cadence = metrics.resampleTo1Hz(time, streamArray(streams, ["cadence"]), "zero");
    const coreTemperature = metrics.resampleTo1Hz(
      time,
      streamArray(streams, ["core_temperature"]),
      "hold"
    );
    const ftp = num(activity?.icu_ftp) || num(conn.ftp) || null;
    const returnedWPrimeBalance = metrics.resampleTo1Hz(
      time,
      streamArray(streams, ["w_bal"]),
      "hold"
    );
    const wPrimeBalance = returnedWPrimeBalance.length
      ? returnedWPrimeBalance
      : metrics.wPrimeBalance(watts, ftp, wPrimeCapacityJ);
    const additionalStreams = {
      skinTemperature: metrics.resampleTo1Hz(time, streamArray(streams, ["skin_temperature"]), "hold"),
      ambientTemperature: metrics.resampleTo1Hz(time, streamArray(streams, ["temp"]), "hold"),
      smo2: metrics.resampleTo1Hz(time, streamArray(streams, ["smo2"]), "hold"),
      thb: metrics.resampleTo1Hz(time, streamArray(streams, ["thb"]), "hold"),
      respiration: metrics.resampleTo1Hz(time, streamArray(streams, ["respiration"]), "hold"),
      tidalVolume: metrics.resampleTo1Hz(time, streamArray(streams, ["tidal_volume"]), "hold"),
      minuteVentilation: metrics.resampleTo1Hz(time, streamArray(streams, ["tidal_volume_min"]), "hold"),
      wPrimeBalance,
      altitude: metrics.resampleTo1Hz(time, streamArray(streams, ["altitude", "fixed_altitude"]), "hold"),
      gradient: metrics.resampleTo1Hz(time, streamArray(streams, ["grade_smooth"]), "hold"),
      speed: metrics.resampleTo1Hz(time, streamArray(streams, ["velocity_smooth"]), "hold"),
    };
    const hr = metrics.positiveStats(heartrate);
    const cad = metrics.positiveStats(cadence);
    const core = metrics.temperatureStats(coreTemperature);
    const additional = additionalStreamSummary(additionalStreams);
    const discoveredStreams = discovery.discoverStreamSummaries(streams, {
      time,
      exclude: NORMALIZED_STREAM_TYPES,
    });
    const sourceData = Object.fromEntries(
      Object.entries(activityDiscovery.values)
        .filter(([key]) => !NORMALIZED_ACTIVITY_FIELDS.has(key))
    );
    const additionalStreamData = discoveredStreams.summaries;
    const dataAvailability = {
      streamTypes: [...new Set([...advertisedStreamTypes, ...discoveredStreams.available])].sort(),
      ...(discoveredStreams.redacted.length
        ? { redactedLocationStreams: discoveredStreams.redacted }
        : {}),
      ...(activityDiscovery.truncated ? { sourceDataTruncated: true } : {}),
    };
    const timelineSeries = {
      watts,
      heartrate,
      cadence,
      coreTemperature,
      skinTemperature: additionalStreams.skinTemperature,
    };
    const timeline = metrics.activityTimeline(timelineSeries);
    const heat = metrics.heatAnalysis({ watts, heartrate, coreTemperature });
    const common = {
      averageHeartRate: hr?.average ?? num(activity?.average_heartrate),
      maxHeartRate: hr?.max ?? num(activity?.max_heartrate),
      averageCadence: cad?.average ?? num(activity?.average_cadence),
      // Only riders with a core sensor get these, so the model never sees an empty temperature
      // field and starts talking about data the rider never recorded.
      ...(core
        ? {
            averageCoreTemperatureC: core.average,
            minCoreTemperatureC: core.min,
            maxCoreTemperatureC: core.max,
          }
        : {}),
      ...(heat ? { heat } : {}),
      ...(timeline ? { timeline } : {}),
      ...(wPrimeCapacityJ != null
        ? {
            wPrimeCapacityJ,
            wPrimeCapacitySource: activityWPrime != null ? "activity" : "power_model",
          }
        : {}),
      ...additional,
      powerZoneSeconds: powerUsable ? zoneSeconds(activity?.icu_zone_times) : null,
      heartRateZoneSeconds: zoneSeconds(activity?.icu_hr_zone_times),
      ...(Object.keys(sourceData).length ? { sourceData } : {}),
      ...(Object.keys(additionalStreamData).length ? { additionalStreamData } : {}),
      ...(dataAvailability.streamTypes.length || dataAvailability.sourceDataTruncated
        ? { dataAvailability }
        : {}),
    };

    let summary = null;
    if (watts.length) {
      const np = metrics.normalizedPower(watts);
      const durationSeconds = watts.length;
      summary = {
        durationSeconds,
        averageWatts: Math.round(watts.reduce((a, b) => a + b, 0) / watts.length),
        normalizedPower: np,
        intensityFactor: metrics.intensityFactor(np, ftp),
        trainingStressScore: num(activity?.icu_training_load) || metrics.trainingStressScore(np, ftp, durationSeconds),
        meanMaxPower: metrics.meanMaxPower(watts),
        aerobicDecouplingPercent: metrics.aerobicDecoupling(watts, heartrate),
        ...common,
        intervals: ftp
          ? metrics.enrichIntervals(
              metrics.detectIntervals(watts, { thresholdWatts: Math.round(ftp * 0.95) }),
              { heartrate, cadence, coreTemperature }
            )
          : compactIntervals(activity),
        ftpUsed: ftp,
      };
    } else if (powerUsable && (activity?.icu_weighted_avg_watts || activity?.icu_training_load)) {
      const np = num(activity.icu_weighted_avg_watts);
      summary = {
        durationSeconds: num(activity.moving_time),
        averageWatts: num(activity.icu_average_watts ?? activity.average_watts),
        normalizedPower: np,
        intensityFactor: metrics.intensityFactor(np, ftp),
        trainingStressScore: num(activity.icu_training_load),
        meanMaxPower: null,
        aerobicDecouplingPercent: null,
        ...common,
        intervals: compactIntervals(activity),
        ftpUsed: ftp,
      };
    } else if (
      common.averageHeartRate != null ||
      common.averageCoreTemperatureC != null ||
      timeline != null ||
      Object.keys(additional).length > 0 ||
      Object.keys(sourceData).length > 0 ||
      Object.keys(additionalStreamData).length > 0
    ) {
      summary = {
        durationSeconds: heartrate.length || coreTemperature.length || num(activity?.moving_time),
        powerAvailable: false,
        ...common,
        intervals: compactIntervals(activity),
      };
    }

    if (!summary) {
      return { success: true, metrics: null, message: "No power, heart-rate or core-temperature data on this activity." };
    }
    const message = summary.powerAvailable === false
      ? "This ride has no usable power data. Use only the available sensor fields without implying missing data exists."
      : null;

    // A ride cached without its streams would stay that way for good, and the coach would then
    // contradict a fresh time-range call that does see them. Only cache complete results.
    const coreAdvertised = advertisedStreamTypes.includes("core_temperature");
    const streamsIncomplete = streamsFailed || (coreAdvertised && !core);
    if (!streamsIncomplete) {
      try {
        await cacheRef.set({
          discordId: String(discordId),
          activityId: id,
          metrics: summary,
          message,
          version: METRICS_CACHE_VERSION,
          cachedAt: new Date(),
        });
      } catch (err) {
        console.warn("activity metrics cache write failed:", err?.message || err);
      }
    }

    if (range) {
      const segment = metrics.segmentSummary(
        { watts, heartrate, cadence, coreTemperature },
        range.fromSeconds,
        range.toSeconds,
        { ftp }
      );
      if (!segment) {
        return {
          success: true,
          metrics: summary,
          message: `That time range is outside this ride, which lasted ${Math.round((summary.durationSeconds || 0) / 60)} minutes. Whole-ride metrics are included instead.`,
        };
      }
      const segmentStreamData = discovery.discoverStreamSummaries(streams, {
        time,
        exclude: NORMALIZED_STREAM_TYPES,
        fromSeconds: range.fromSeconds,
        toSeconds: range.toSeconds,
      }).summaries;
      return {
        success: true,
        metrics: {
          ...summary,
          segment: {
            ...segment,
            ...additionalStreamSummary(additionalStreams, range.fromSeconds, range.toSeconds),
            ...withPresent({
              // A part of the ride gets a finer timeline than the whole ride.
              timeline: metrics.activityTimeline(timelineSeries, {
                fromSeconds: range.fromSeconds,
                toSeconds: range.toSeconds,
                minBucketSeconds: 30,
                maxRows: 60,
              }),
              heat: metrics.heatAnalysis(
                { watts, heartrate, coreTemperature },
                { fromSeconds: range.fromSeconds, toSeconds: range.toSeconds }
              ),
            }),
            ...(Object.keys(segmentStreamData).length
              ? { additionalStreamData: segmentStreamData }
              : {}),
          },
        },
        message,
      };
    }
    return { success: true, metrics: summary, message };
  });
}

async function getZwiftPowerContext(discordId) {
  try {
    const zwiftId = await getUserZwiftId(discordId);
    if (!zwiftId) return { success: true, zwiftpower: { linked: false } };
    const latest = await getLatestClubStats();
    const riders = Array.isArray(latest?.riders) ? latest.riders : [];
    const rider = riders.find((r) => String(r.riderId) === String(zwiftId));
    if (!rider) return { success: true, zwiftpower: { linked: true, zwiftId, inClubStats: false } };
    return {
      success: true,
      zwiftpower: {
        linked: true,
        zwiftId,
        inClubStats: true,
        // club_stats rows are ZwiftRacing riders (see app/utils/fetchZPdata.ts).
        name: rider.name || null,
        paceGroup: rider.zpCategory ?? null,
        veloCategory: rider.race?.current?.mixed?.category ?? null,
        veloRating: num(rider.race?.current?.rating),
        racingScore: num(rider.racingScore ?? rider.zrs?.score),
        phenotype: phenotypeLabel(rider.phenotype),
        ftp: num(rider.zpFTP),
        weight_kg: num(rider.weight),
        races: rider.race?.finishes != null
          ? { finishes: num(rider.race.finishes), wins: num(rider.race.wins), podiums: num(rider.race.podiums), dnfs: num(rider.race.dnfs) }
          : null,
      },
    };
  } catch (err) {
    console.error("getZwiftPowerContext error:", err?.message || err);
    return { success: false, message: "Could not load ZwiftPower context." };
  }
}

function compactWellness(row) {
  if (!row || typeof row !== "object") return null;
  const ctl = num(row.ctl);
  const atl = num(row.atl);
  const sleepSecs = num(row.sleepSecs);
  return {
    date: row.id || row.date || null,
    weight_kg: num(row.weight),
    resting_hr: num(row.restingHR),
    hrv_rmssd: num(row.hrv),
    hrv_sdnn: num(row.hrvSDNN),
    sleep_hours: sleepSecs != null ? Math.round((sleepSecs / 3600) * 10) / 10 : null,
    sleep_score: num(row.sleepScore),
    sleep_quality: num(row.sleepQuality),
    avg_sleeping_hr: num(row.avgSleepingHR),
    readiness: num(row.readiness),
    soreness: num(row.soreness),
    fatigue: num(row.fatigue),
    stress: num(row.stress),
    mood: num(row.mood),
    motivation: num(row.motivation),
    ctl,
    atl,
    form: ctl != null && atl != null ? Math.round((ctl - atl) * 10) / 10 : null,
    ramp_rate: num(row.rampRate),
  };
}

const RECOVERY_FIELDS = [
  "resting_hr", "hrv_rmssd", "hrv_sdnn", "sleep_hours", "sleep_score",
  "sleep_quality", "avg_sleeping_hr", "readiness",
];

async function getWellness(discordId, options = {}) {
  const window = activityListWindow({ days: options.days ?? 14, oldest: options.oldest, newest: options.newest });
  return wrapCall(discordId, async () => {
    const newest = window.newest;
    const oldest = window.oldest;
    const { data } = await intervalsFetch(
      discordId,
      `/athlete/0/wellness?oldest=${oldest}&newest=${newest}`
    );
    const raw = Array.isArray(data) ? data : [];
    const rows = raw.map(compactWellness).filter((row) => row && row.date);
    const hasRecovery = rows.some((row) => RECOVERY_FIELDS.some((key) => row[key] != null));
    if (rows.length && !hasRecovery) {
      // Log which raw keys intervals.icu actually sent, so a missing sync can be told apart from a mapping bug.
      const keys = new Set();
      for (const r of raw) for (const [k, v] of Object.entries(r || {})) if (v != null) keys.add(k);
      console.warn(`getWellness: no recovery fields for ${discordId}; non-null keys: ${[...keys].sort().join(",")}`);
    }
    let message;
    if (!rows.length) message = "No wellness rows in this window.";
    else if (!hasRecovery) {
      message =
        "intervals.icu has no sleep, HRV, resting HR or readiness for this window. It may come from a device sync (Oura, Garmin, Whoop) that has not run yet, so do not tell the athlete they forgot to log it, and do not treat it as fine.";
    } else {
      message = "Null fields are unknown for that day, not fine.";
    }
    return { success: true, days: window.days, oldest, newest, wellness: rows, message };
  });
}

async function getPowerCurves(discordId, { windows } = {}) {
  const requested = (Array.isArray(windows) && windows.length ? windows : [{ days: 28 }])
    .slice(0, powerCurves.MAX_WINDOWS)
    .map((w) => activityListWindow({ days: w?.days ?? 28, oldest: w?.oldest, newest: w?.newest }));
  return wrapCall(discordId, async () => {
    const ids = requested.map((w) => powerCurves.rangeCurveId(w.oldest, w.newest)).join(",");
    const { data } = await intervalsFetch(
      discordId,
      `/athlete/0/power-curves?type=Ride&curves=${encodeURIComponent(ids)}&newest=${copenhagenDate(0)}`
    );
    return {
      success: true,
      curves: powerCurves.rangeCurves(data, requested),
      message:
        "Best power per duration across the rides in each window, with the date it was set. A missing duration means no ride in that window was that long. Rides intervals.icu only holds from Strava have no power here. A low curve in a window with few rides is lack of data, not lost fitness.",
    };
  });
}

async function getPlannedWorkouts(discordId, { days = 14, oldest, newest } = {}) {
  const start = isoDay(oldest) || copenhagenDate(0);
  const end = isoDay(newest) || shiftIsoDay(start, lookbackDays(days, 14));
  const oldestDate = start <= end ? start : end;
  const newestDate = start <= end ? end : start;
  return wrapCall(discordId, async () => {
    const { data } = await intervalsFetch(
      discordId,
      `/athlete/0/events?oldest=${oldestDate}&newest=${newestDate}&category=WORKOUT`
    );
    const events = (Array.isArray(data) ? data : []).map((event) => ({
      id: event.id ?? null,
      name: event.name || null,
      start_date: event.start_date_local || null,
      type: event.type || null,
      moving_time: event.moving_time ?? null,
      training_load: event.icu_training_load ?? null,
      description: typeof event.description === "string" ? event.description.slice(0, 240) : null,
    }));
    return { success: true, days: spanDays(oldestDate, newestDate), oldest: oldestDate, newest: newestDate, workouts: events };
  });
}

async function fetchActivityHistory(discordId, { days = 182 } = {}) {
  return wrapCall(discordId, async () => {
    const newest = copenhagenDate(0);
    const oldest = copenhagenDate(-days);
    const { activities, skippedUnreadable } = await listActivities(discordId, oldest, newest);
    return { success: true, days, activities, message: unreadableSourceMessage(skippedUnreadable) };
  });
}

function weeklyFitness(rows) {
  const byWeek = new Map();
  for (const row of rows) {
    if (!row?.date || row.ctl == null) continue;
    const week = weeklyLoad.weekStart(`${row.date}T12:00:00Z`);
    if (!week) continue;
    byWeek.set(week, { week, ctl: row.ctl, atl: row.atl, form: row.form });
  }
  return Array.from(byWeek.values()).sort((a, b) => a.week.localeCompare(b.week));
}

async function getTrainingTrend(discordId, { days = 182, oldest } = {}) {
  const newest = copenhagenDate(0);
  let start = isoDay(oldest) || shiftIsoDay(newest, -lookbackDays(days, 182));
  if (start > newest) start = newest;
  const weeks = Math.max(1, Math.ceil(spanDays(start, newest) / 7) + 2);
  return wrapCall(discordId, async () => {
    const [listed, settingsRes, wellnessRes] = await Promise.all([
      listActivities(discordId, start, newest),
      intervalsFetch(discordId, "/athlete/0/sport-settings").catch((err) => {
        if (err?.code === "needs_reconnect" || err?.code === "not_connected") throw err;
        return { data: [] };
      }),
      intervalsFetch(discordId, `/athlete/0/wellness?oldest=${start}&newest=${newest}`).catch((err) => {
        if (err?.code === "needs_reconnect" || err?.code === "not_connected") throw err;
        return { data: [] };
      }),
    ]);
    const sport = pickSportSettings(settingsRes.data);
    const ftp = num(sport?.indoor_ftp) || num(sport?.ftp);
    const weekly = weeklyLoad.rollupWeeks(listed.activities, { ftp, weeks });
    const trend = weeklyLoad.loadTrend(weekly);
    const fitness = weeklyFitness(
      (Array.isArray(wellnessRes.data) ? wellnessRes.data : []).map(compactWellness).filter(Boolean)
    );
    const unread = unreadableSourceMessage(listed.skippedUnreadable);
    return {
      success: true,
      weeks: weekly.length,
      oldest: start,
      newest,
      summary: weeklyLoad.formatWeeklyLoadForPrompt(weekly, trend),
      fitness,
      message:
        "Fetched for this question and not stored. The current week only includes days already ridden, so a low number mid-week is not a drop in training." +
        (unread ? ` ${unread}` : ""),
    };
  });
}

function workoutExternalId(date, name) {
  const slug = String(name || "workout")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `dzr-${date}-${slug || "workout"}`;
}

async function upsertPlannedWorkout(discordId, { name, filename, xml, date }) {
  const rideDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : copenhagenDate(1);
  const externalId = workoutExternalId(rideDate, name);
  return wrapCall(discordId, async () => {
    await intervalsFetch(discordId, "/athlete/0/events/bulk?upsert=true", {
      method: "POST",
      body: [
        {
          category: "WORKOUT",
          type: "VirtualRide",
          start_date_local: `${rideDate}T00:00:00`,
          name: String(name || "DZR Coach workout").slice(0, 80),
          filename,
          file_contents: xml,
          external_id: externalId,
        },
      ],
    });
    const { data } = await intervalsFetch(
      discordId,
      `/athlete/0/events?oldest=${rideDate}&newest=${rideDate}&category=WORKOUT`
    );
    const event = (Array.isArray(data) ? data : []).find((row) => String(row.external_id) === externalId);
    const steps = event?.workout_doc?.steps;
    const parsed = Array.isArray(steps) && steps.length > 0;
    return {
      success: true,
      calendar: parsed,
      date: rideDate,
      message: parsed
        ? `Workout is on the intervals.icu calendar for ${rideDate}. If Zwift is connected in intervals.icu with planned-workout upload on, the next week of workouts appears under Zwift → Workouts → Custom → Intervals.icu. FTP on Zwift and intervals.icu must match.`
        : "The calendar write did not come back with workout steps. The Discord file was still sent.",
    };
  });
}

module.exports = {
  mintConnectToken,
  getConnectUrl,
  hasClubMemberRole,
  notClubMemberResult,
  isConnected,
  getAthleteProfile,
  getAthleteStats,
  getAthleteZones,
  getRecentActivities,
  getActivityDetails,
  getZwiftPowerContext,
  getActivityMetrics,
  getWellness,
  getPowerCurves,
  getPlannedWorkouts,
  fetchActivityHistory,
  getTrainingTrend,
  upsertPlannedWorkout,
  copenhagenDate,
};
