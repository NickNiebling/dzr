// Reads ladder.cycleracing.club through the Flask API (/ladder_page), which holds the club's ladder login.
const axios = require("axios");
const config = require("../../config/config");
const { parseFixtureList, parseFixture } = require("./ladderParser");

// Short reason shown to the user, so a failing API can be told apart without looking in the logs.
function describeFailure(err) {
  if (err.response) return `API svarede ${err.response.status}`;
  if (err.code === "ECONNABORTED") return "API svarede ikke i tide";
  return "ingen forbindelse til API";
}

async function getPage(path) {
  const { baseUrl, apiKey } = config.contentApi;
  if (!baseUrl || !apiKey) throw new Error("CONTENT_API_BASE_URL and CONTENT_API_KEY must be set to read the ladder");
  try {
    const res = await axios.get(`${baseUrl}/ladder_page`, {
      params: { path },
      headers: { Authorization: `Bearer ${apiKey}` },
      responseType: "text",
      transformResponse: (body) => body,
      timeout: 60000,
    });
    return res.data;
  } catch (err) {
    const status = err.response ? err.response.status : "no response";
    const wrapped = new Error(`Ladder page ${path} failed: ${status} ${err.message}`);
    wrapped.userMessage = `Ladder-siden kunne ikke hentes lige nu (${describeFailure(err)}). Prøv igen senere.`;
    throw wrapped;
  }
}

function fixturesPath(team) {
  return `/matchlist/fixtures/${encodeURIComponent(team)}`;
}

async function getFixtures(team) {
  const html = await getPage(fixturesPath(team));
  const fixtures = parseFixtureList(html);
  // Shows up in the Render logs when a team page comes back without any parsable match.
  if (!fixtures.length) console.warn(`[ladder] No matches parsed for team "${team}" (page ${html.length} bytes, ${(html.match(/data-id="/g) || []).length} rows with a match id)`);
  return fixtures;
}

async function getFixture(id) {
  return { id: String(id), ...parseFixture(await getPage(`/fixture/${encodeURIComponent(id)}`)) };
}

// The ladder only re-reads signups from Zwift when someone presses "Refresh Signups" (GET /rSignups/{eventId}),
// at most once per 30 minutes, so a preview can miss late signups until then. Failures are not fatal.
const REFRESH_COOLDOWN_MS = 30 * 60 * 1000;
const lastRefresh = new Map();

async function refreshSignups(eventId, { fetchPage = getPage, now = Date.now() } = {}) {
  if (!eventId) return false;
  const last = lastRefresh.get(String(eventId));
  if (last !== undefined && now - last < REFRESH_COOLDOWN_MS) return false;
  lastRefresh.set(String(eventId), now);
  try {
    await fetchPage(`/rSignups/${encodeURIComponent(eventId)}`);
    return true;
  } catch (err) {
    console.warn(`[ladder] Signup refresh for event ${eventId} failed:`, err.message);
    return false;
  }
}

// Returns the fixture with up-to-date signups when the refresh went through, otherwise the fixture as given.
// A match that has started is left alone: its signups are final and the refresh is only meant for upcoming matches.
async function refreshFixture(fixture, now = Date.now()) {
  if (!fixture.start || new Date(fixture.start).getTime() <= now) return fixture;
  return (await refreshSignups(fixture.zwiftEventId)) ? getFixture(fixture.id) : fixture;
}

// A known start time never changes, so it is fetched at most once per process.
// A missing one is not stored: a stale fixture is the "Refreshing Signups" spinner and has no start until that finishes.
const startCache = new Map();

async function getFixtureStart(id, { load = getFixture, cache = startCache } = {}) {
  if (!cache.has(id)) {
    const start = (await load(id)).start;
    if (start) cache.set(id, start);
    return start;
  }
  return cache.get(id);
}

// Walks the fixture list in order and returns the first fixture that has not started yet, or null.
async function getNextFixture(team) {
  for (const { id } of await getFixtures(team)) {
    const fixture = await getFixture(id);
    if (fixture.start && new Date(fixture.start).getTime() > Date.now()) return fixture;
  }
  return null;
}

function rosterError(message) {
  const error = new Error(message);
  error.userMessage = message;
  return error;
}

function createRosterReader({ fetchPage = getPage, parseTeamPage = (html) => require("./ladderRoster").parseRosterPage(html), parseIdentity = (html) => require("./ladderRoster").parseProfileIdentity(html) } = {}) {
  return async function getRoster(team) {
    const id = String(team?.id || "");
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw rosterError("Holdets Ladder-id er ugyldigt.");
    // Read the complete current roster every time; only riderPower's existing power cache is reused.
    const roster = parseTeamPage(await fetchPage(`/team/n/${id}`));
    if (String(roster.id) !== id) throw rosterError("Ladder-siden viser et andet hold end det valgte.");
    const profiles = [...new Set(roster.riders.filter((rider) => !rider.zwiftId && rider.profileId).map((rider) => String(rider.profileId)))];
    const identities = new Map();
    const queue = [...profiles];
    const worker = async () => {
      for (let profileId = queue.shift(); profileId !== undefined; profileId = queue.shift()) {
        if (!/^[1-9]\d*$/.test(profileId) || !Number.isSafeInteger(Number(profileId))) continue;
        let html;
        try { html = await fetchPage(`/profile/${profileId}`); } catch { continue; }
        // A Ladder profile id alone is not proof of a Zwift identity.
        identities.set(profileId, parseIdentity(html));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    const known = new Map();
    const riders = [];
    for (const rider of roster.riders) {
      const zwiftId = rider.zwiftId || identities.get(String(rider.profileId)) || null;
      const mapped = { name: rider.name, zwiftId, wkg: { ...rider.wkg } };
      if (zwiftId && known.has(String(zwiftId))) {
        const existing = known.get(String(zwiftId));
        for (const [seconds, value] of Object.entries(mapped.wkg)) if (existing.wkg[seconds] == null) existing.wkg[seconds] = value;
        continue;
      }
      if (zwiftId) known.set(String(zwiftId), mapped);
      riders.push(mapped);
    }
    if (!known.size) throw rosterError(`${roster.name}: Ingen ryttere har et verificerbart Zwift-id fra et Zwift- eller ZwiftPower-profillink.`);
    return { ...team, id, name: roster.name, path: `/team/n/${id}`, url: `https://ladder.cycleracing.club/team/n/${id}`, riders };
  };
}

const getRoster = createRosterReader();

module.exports = { getPage, describeFailure, fixturesPath, getFixtures, getFixture, getFixtureStart, getNextFixture, refreshSignups, refreshFixture, createRosterReader, getRoster };
