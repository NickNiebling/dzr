// Reads ladder.cycleracing.club through the Flask API (/ladder_page), which holds the club's ladder login.
const axios = require("axios");
const config = require("../../config/config");
const { parseTeamPage, parseFixtureList, parseFixture } = require("./ladderParser");

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

// URL text is only a lookup key. Fetch the team page before trusting it as a team name.
async function resolveTeamName(input, { fetchPage = getPage } = {}) {
  const text = input.trim();
  if (!/^(?:[a-z][a-z\d+.-]*:|\/\/|www\.)/i.test(text)) return text;
  let lookup;
  try {
    const url = new URL(text);
    const path = url.pathname.match(/^\/(?:teamView|matchlist\/fixtures)\/([^/]+)\/?$/i);
    if (!/^https?:$/.test(url.protocol) || url.hostname !== "ladder.cycleracing.club" || url.port || url.username || url.password || !path) throw new Error("Invalid ladder URL");
    lookup = decodeURIComponent(path[1]).trim();
    if (!lookup || /[/\\?#]/.test(lookup) || lookup.includes("..")) throw new Error("Invalid team path");
  } catch {
    const error = new Error("Invalid ladder team URL");
    error.userMessage = "Brug et hold-link fra ladder.cycleracing.club/teamView/ eller /matchlist/fixtures/.";
    throw error;
  }
  const name = parseTeamPage(await fetchPage(`/teamView/${encodeURIComponent(lookup)}`));
  if (!name) {
    const error = new Error("Ladder team page did not contain a team name");
    error.userMessage = "Kunne ikke finde holdnavnet på ladder-siden. Tjek hold-linket. Holdet er ikke linket.";
    throw error;
  }
  return name;
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

module.exports = { getPage, describeFailure, fixturesPath, resolveTeamName, getFixtures, getFixture, getFixtureStart, getNextFixture, refreshSignups, refreshFixture };
