// /summary embeds the directory as JSON. No Ladder login or browser scripts run in the bot.
const { getPage } = require("./ladderClient");

const LADDER_BASE = "https://ladder.cycleracing.club";
const CATALOG_TTL_MS = 15 * 60 * 1000;
const RETRY_MS = 30 * 1000;

function scoutError(message) {
  const error = new Error(message);
  error.userMessage = message;
  return error;
}

// Find the end of a JSON array without evaluating the surrounding JavaScript.
function embeddedArray(html, name) {
  const assignment = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*\\[`).exec(html);
  if (!assignment) return null;
  const start = assignment.index + assignment[0].length - 1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[") depth += 1;
    else if (char === "]" && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { break; }
    }
  }
  throw scoutError("Ladders holdkatalog har et ukendt JSON-format. Prøv igen senere.");
}

function positiveId(value) {
  return /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function teamReference(id, name) {
  const path = `/team/n/${Number(id)}`;
  return { id: String(Number(id)), name, path, url: `${LADDER_BASE}${path}` };
}

function parseSummaryTeams(html) {
  const ranked = embeddedArray(html, "defaultLadderData");
  const all = embeddedArray(html, "playonTeams");
  if (!ranked && !all) throw scoutError("Ladders holdkatalog har et ukendt format: holdlisten mangler i /summary.");
  const teams = new Map();
  for (const item of [...(all || []), ...(ranked || [])]) {
    const team = item?.data || item;
    if (!team || !positiveId(team.id) || typeof team.name !== "string" || !team.name.trim()) {
      throw scoutError("Ladders holdkatalog indeholder en ugyldig holdidentitet.");
    }
    teams.set(String(Number(team.id)), teamReference(team.id, team.name.trim()));
  }
  if (!teams.size) throw scoutError("Ladders holdkatalog er tomt.");
  return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name, "da") || Number(a.id) - Number(b.id));
}

const normalize = (text) => text.trim().normalize("NFKC").toLocaleLowerCase("da");

function parseTeamInput(input) {
  const text = String(input || "").trim();
  if (!text) throw scoutError("Vælg en modstander ved navn eller holdlink.");
  if (!/^(?:https?:\/\/|\/)/i.test(text)) {
    if (/^[a-z][\w+.-]*:\/\//i.test(text)) throw scoutError("Brug et holdlink på ladder.cycleracing.club.");
    return { name: text };
  }
  let url;
  try { url = new URL(text, LADDER_BASE); } catch { throw scoutError("Holdlinket er ugyldigt."); }
  if (!["https:", "http:"].includes(url.protocol) || url.host !== "ladder.cycleracing.club" || url.username || url.password) {
    throw scoutError("Brug et holdlink på ladder.cycleracing.club.");
  }
  const numeric = /^\/team\/n\/([1-9]\d*)\/?$/.exec(url.pathname);
  if (numeric && positiveId(numeric[1])) return { id: String(Number(numeric[1])), path: `/team/n/${Number(numeric[1])}` };
  const named = /^\/(teamView|matchlist\/fixtures)\/([^/]+)\/?$/.exec(url.pathname);
  if (named) {
    let name;
    try { name = decodeURIComponent(named[2]).trim(); } catch { throw scoutError("Holdlinket har ugyldig tegnkodning."); }
    const unsafe = [...name].some((char) => "/\\?#".includes(char) || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
    if (name && !unsafe && name !== "." && name !== "..") {
      return { name, path: `/teamView/${encodeURIComponent(name)}` };
    }
  }
  throw scoutError("Brug et Ladder-holdlink med /team/n/{id}, /teamView/{navn} eller /matchlist/fixtures/{navn}.");
}

function createTeamCatalog({ fetchPage = getPage, readTeamPage = (html) => require("./ladderRoster").parseRosterPage(html), now = Date.now, warn = (message) => console.warn(message) } = {}) {
  let entries = null;
  let updatedAt = 0;
  let inFlight = null;
  let retryAfter = 0;

  function refresh() {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(() => fetchPage("/summary")).then((html) => {
      entries = parseSummaryTeams(html);
      updatedAt = now();
      retryAfter = 0;
      return entries;
    }).catch((error) => {
      retryAfter = now() + RETRY_MS;
      throw error;
    }).finally(() => { inFlight = null; });
    return inFlight;
  }

  function warmCatalog() {
    if ((!entries || now() - updatedAt >= CATALOG_TTL_MS) && now() >= retryAfter) {
      refresh().catch(() => warn("[ladder scout] Holdkataloget kunne ikke opdateres; prøver igen senere."));
    }
  }

  function autocomplete(input) {
    warmCatalog();
    let parsed;
    try { parsed = String(input || "").trim() ? parseTeamInput(input) : { name: "" }; } catch { return []; }
    const matches = (entries || []).filter((team) => parsed.id ? team.id === parsed.id : normalize(team.name).includes(normalize(parsed.name)));
    return matches.slice(0, 25).map((team) => ({ name: `${team.name} (#${team.id})`.slice(0, 100), value: team.url }));
  }

  async function validatePage(path, expectedId) {
    const team = readTeamPage(await fetchPage(path));
    if (!positiveId(team.id) || !team.name || (expectedId && String(team.id) !== expectedId)) {
      throw scoutError("Holdlinket førte ikke til det forventede Ladder-hold.");
    }
    return teamReference(team.id, team.name);
  }

  async function resolveTeam(input) {
    const parsed = parseTeamInput(input);
    // A numeric link is authoritative even when /summary has never listed the team.
    if (parsed.id) return validatePage(parsed.path, parsed.id);
    if (parsed.path) return validatePage(parsed.path);
    if (!entries || now() - updatedAt >= CATALOG_TTL_MS) {
      try { await refresh(); } catch (error) { if (!entries) throw error; }
    }
    const name = normalize(parsed.name);
    const exact = (entries || []).filter((team) => normalize(team.name) === name);
    const matches = exact.length ? exact : (entries || []).filter((team) => normalize(team.name).includes(name));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw scoutError(`Flere Ladder-hold matcher “${parsed.name}”. Vælg et konkret hold i forslagene, eller brug et holdlink.`);
    throw scoutError(`Intet Ladder-hold matcher “${parsed.name}”. Prøv et andet navn eller et holdlink.`);
  }

  return { autocomplete, resolveTeam, warmCatalog, refresh };
}

module.exports = { LADDER_BASE, CATALOG_TTL_MS, embeddedArray, parseSummaryTeams, parseTeamInput, createTeamCatalog, ...createTeamCatalog() };
