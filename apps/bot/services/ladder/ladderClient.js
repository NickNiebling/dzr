// Reads ladder.cycleracing.club through the Flask API (/ladder_page), which holds the club's ladder login.
const axios = require("axios");
const config = require("../../config/config");
const { parseFixtureList, parseFixture, parseRosterPage, parseProfileIdentity, parseSummaryTeams, parseTeamInput, teamReference } = require("./ladderParser");

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

// Scout searches share one in-memory catalog; complete rosters are fetched on every command.
const CATALOG_TTL_MS = 15 * 60 * 1000;
let catalog = [];
let catalogExpires = 0;
let catalogRefresh = null;
let retryAfter = 0;
const normalize = (name) => name.trim().normalize("NFKC").toLocaleLowerCase("da");
const scoutError = (message) => Object.assign(new Error(message), { userMessage: message });

function refreshCatalog() {
  if (!catalogRefresh) {
    catalogRefresh = getPage("/summary").then((html) => {
      catalog = parseSummaryTeams(html);
      catalogExpires = Date.now() + CATALOG_TTL_MS;
      retryAfter = 0;
    }).catch((error) => {
      retryAfter = Date.now() + 30000;
      throw error;
    }).finally(() => { catalogRefresh = null; });
  }
  return catalogRefresh;
}

function warmCatalog() {
  if (Date.now() >= catalogExpires && Date.now() >= retryAfter && !catalogRefresh) {
    refreshCatalog().catch(() => console.warn("[ladder scout] Holdkataloget kunne ikke opdateres."));
  }
}

function autocomplete(input) {
  warmCatalog();
  let parsed;
  try { parsed = input.trim() ? parseTeamInput(input) : { name: "" }; } catch { return []; }
  return catalog.filter((team) => parsed.id ? team.id === parsed.id : normalize(team.name).includes(normalize(parsed.name)))
    .slice(0, 25).map((team) => ({ name: `${team.name} (#${team.id})`.slice(0, 100), value: team.url }));
}

async function resolveTeam(input) {
  const parsed = parseTeamInput(input);
  // Links validate the actual team page, even when the team is absent from /summary.
  if (parsed.path) {
    const team = parseRosterPage(await getPage(parsed.path));
    if (parsed.id && String(team.id) !== parsed.id) throw scoutError("Holdlinket førte ikke til det forventede Ladder-hold.");
    return teamReference(team.id, team.name);
  }
  if (Date.now() >= catalogExpires) {
    try { await refreshCatalog(); } catch (error) { if (!catalog.length) throw error; }
  }
  const name = normalize(parsed.name);
  const exact = catalog.filter((team) => normalize(team.name) === name);
  const matches = exact.length ? exact : catalog.filter((team) => normalize(team.name).includes(name));
  if (matches.length === 1) return matches[0];
  throw scoutError(matches.length
    ? `Flere Ladder-hold matcher “${parsed.name}”. Vælg et konkret forslag eller et holdlink.`
    : `Intet Ladder-hold matcher “${parsed.name}”. Prøv et andet navn eller et holdlink.`);
}

async function getRoster(team, { fetchPage = getPage } = {}) {
  const id = String(team.id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw scoutError("Holdets Ladder-id er ugyldigt.");
  const roster = parseRosterPage(await fetchPage(`/team/n/${id}`));
  if (String(roster.id) !== id) throw scoutError("Ladder-siden viser et andet hold end det valgte.");
  const profiles = [...new Set(roster.riders.map((rider) => rider.profileId).filter(Boolean))];
  const identities = new Map();
  const worker = async () => {
    for (let profileId = profiles.shift(); profileId !== undefined; profileId = profiles.shift()) {
      let html;
      try { html = await fetchPage(`/profile/${profileId}`); } catch { continue; }
      identities.set(profileId, parseProfileIdentity(html));
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, profiles.length) }, worker));
  const known = new Map();
  const riders = [];
  for (const rider of roster.riders) {
    const zwiftId = identities.get(rider.profileId) || null;
    const mapped = { name: rider.name, zwiftId, wkg: rider.wkg };
    if (zwiftId && known.has(zwiftId)) {
      const existing = known.get(zwiftId);
      for (const [seconds, value] of Object.entries(mapped.wkg)) if (existing.wkg[seconds] == null) existing.wkg[seconds] = value;
      continue;
    }
    if (zwiftId) known.set(zwiftId, mapped);
    riders.push(mapped);
  }
  if (!known.size) throw scoutError(`${roster.name}: Ingen ryttere har et verificerbart Zwift-id fra et profillink.`);
  return { ...teamReference(id, roster.name), riders };
}

module.exports = { getPage, describeFailure, fixturesPath, getFixtures, getFixture, getFixtureStart, getNextFixture, refreshSignups, refreshFixture, warmCatalog, autocomplete, resolveTeam, getRoster };
