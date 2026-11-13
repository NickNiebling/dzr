// Regex parsers for ladder.cycleracing.club pages; the site has no public API.
const { powerupName } = require("../powerupIcons");
const { parseArchPowerups, parsePowerupPercent } = require("../powerupPlaces");

const POWER_SECONDS = [5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];

function decodeEntities(value) {
  return String(value || "").replace(/&(?:amp|lt|gt|quot|apos|#39|#x[\da-f]+|#\d+);/gi, (entity) => {
    const named = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const code = entity.toLowerCase().startsWith("&#x") ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

// Returns [{ id, home, away, route }] from /matchlist/fixtures/{team}.
function parseFixtureList(html) {
  const fixtures = [];
  const rowRegex = /<tr\b[^>]*\bdata-id="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g;
  let row;
  while ((row = rowRegex.exec(html))) {
    const teams = [...row[2].matchAll(/class="teamOpener[^"]*"[^>]*data-team-id="\d+"[^>]*>([^<]+)</g)].map((m) =>
      decodeEntities(m[1].trim())
    );
    if (teams.length < 2) continue;
    const route = row[2].match(/<span class="route-detail">\s*([^<]+?)\s*(?:<|$)/);
    fixtures.push({ id: row[1], home: teams[0], away: teams[1], route: route ? decodeEntities(route[1]) : null });
  }
  return fixtures;
}

// Extracts the HTML of one team's signup section (home or away).
function signupSection(html, side) {
  const start = html.indexOf(`<section class="${side}TeamSignins`);
  if (start === -1) return "";
  const rest = html.slice(start + 10);
  const next = rest.search(/<section class="(?:home|away|merge)TeamSignins/);
  return next === -1 ? rest : rest.slice(0, next);
}

function parseSignups(sectionHtml) {
  const teamName = (sectionHtml.match(/<h2 class="px-2">([^<]+)<\/h2>/) || [])[1];
  const riders = [];
  for (const part of sectionHtml.split(/<tr\b/).slice(1)) {
    if (!part.includes("data-goto=/profile/")) continue;
    const nameMatch = part.match(/class="sticky-truncate">([^<]*)</);
    if (!nameMatch) continue;
    // The ladder profile id is the rider's Zwift id (matches zwiftpower.com/profile.php?z=...).
    const zwiftId = (part.match(/data-goto=\/profile\/(\d+)/) || [])[1];
    const wkg = {};
    const cellRegex = /data-format="(w|wkg)"\s+data-time="(\w+)"\s+data-power-time="(\d+)"[^>]*>\s*([^<\s]+)\s*</g;
    let cell;
    while ((cell = cellRegex.exec(part))) {
      if (cell[1] !== "wkg" || cell[2] !== "90") continue;
      const value = Number(cell[4]);
      wkg[cell[3]] = Number.isFinite(value) && value > 0 ? value : null;
    }
    riders.push({ name: decodeEntities(nameMatch[1].trim()), zwiftId: zwiftId ? Number(zwiftId) : null, wkg });
  }
  return { name: teamName ? decodeEntities(teamName.trim()) : null, riders };
}

function parseTags(html) {
  const tagsMatch = html.match(/const tags = (\[[^\n]*\]);/);
  if (!tagsMatch) return [];
  try {
    const tags = JSON.parse(tagsMatch[1]);
    return Array.isArray(tags) ? tags : [];
  } catch {
    return [];
  }
}

// Club colours come from the clubPill(...) calls: the first is the home club, the second the away club.
function parseClubColors(html) {
  const colors = [];
  for (const m of html.matchAll(/clubPill\("[^"]*",\s*(\{[^;]*?\})\);/g)) {
    try {
      const club = JSON.parse(m[1]);
      colors.push(club.color1 || null);
    } catch {
      colors.push(null);
    }
  }
  return { home: colors[0] || null, away: colors[1] || null };
}

// Returns route, start time (ISO, UTC), powerups, club colours and both teams' signups from /fixture/{id}.
function parseFixture(html) {
  const start = (html.match(/let forTime = '([^']+)'/) || [])[1] || null;
  const routeName = (html.match(/<div class="h2 card-text">([^<]+)<\/div>/) || [])[1];
  const world = (html.match(/<div class="ribbon resultRibbon card-title"><b>\s*([^<]+?)\s*<\/b>/) || [])[1];
  const laps = (html.match(/laps\s*<span class="badge[^"]*">(\d+)</) || [])[1] || (html.match(/let laps\s*=\s*(\d+)/) || [])[1];
  // Race length in metres when the fixture ends at a distance instead of a lap count (same variable the ladder page uses).
  const distance = (html.match(/let distance\s*=\s*(\d+(?:\.\d+)?)/) || [])[1];
  const named = [1, 2]
    .map((n) => (html.match(new RegExp(`const fixturePU${n} = '(\\w+)'`)) || [])[1])
    .filter(Boolean);
  const tags = parseTags(html);
  const powerupIds = parsePowerupPercent(tags);
  const powerups = powerupIds.length ? powerupIds.map((id) => powerupName(id) || String(id)) : named;
  const routeId = (html.match(/let routeId\s*=\s*(\d+)/) || [])[1] || null;
  // Event id the ladder reads signups from: a hidden form field, or the "Sign-in link (event N)" button.
  const zwiftEventId = (html.match(/name="zwiftEventId"[^>]*value="(\d+)"/) || html.match(/Sign-in link \(event (\d+)\)/) || [])[1] || null;
  return {
    start,
    routeId,
    zwiftEventId,
    archPowerups: parseArchPowerups(tags),
    route: routeName ? decodeEntities(routeName.trim()) : null,
    world: world ? decodeEntities(world.trim()) : null,
    laps: laps ? Number(laps) : null,
    distance: distance ? Number(distance) : null,
    powerupIds,
    powerups,
    colors: parseClubColors(html),
    home: parseSignups(signupSection(html, "home")),
    away: parseSignups(signupSection(html, "away")),
  };
}

const LADDER_BASE = "https://ladder.cycleracing.club";
function parserError(message) {
  return Object.assign(new Error(message), { userMessage: message });
}

// Read embedded JSON without running any of the surrounding JavaScript.
function embeddedArray(html, name) {
  const escapedName = name.replaceAll(".", "\\.");
  const assignment = new RegExp(`\\b${escapedName}\\s*=\\s*\\[`).exec(html);
  if (!assignment) return null;
  const start = assignment.index + assignment[0].length - 1;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { break; }
    }
  }
  throw parserError("Ladder-siden har ugyldig eller afkortet indlejret JSON.");
}

function plainText(value) {
  return decodeEntities(String(value || "").replace(/<[^>]*>/g, "")).trim();
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3]) : null;
}

function positiveId(value) {
  if (!/^\d+$/.test(String(value ?? ""))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function rosterError(detail) {
  return parserError(`Ladder-truppen kunne ikke verificeres: ${detail}`);
}

function parseRosterPage(input) {
  const html = String(input || "").replace(/<!--[\s\S]*?-->/g, "");
  const id = positiveId((html.match(/\b(?:const|let|var)\s+TEAMID\s*=\s*(\d+)\s*;/) || [])[1]);
  const name = plainText((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  if (!id || !name) throw rosterError("holdets id eller navn mangler (ukendt rosterformat).");
  const pane = /<div\b[^>]*\bid\s*=\s*["']pane-roster["'][^>]*>/i.exec(html);
  if (!pane) throw rosterError("den aktuelle roster-sektion mangler (ukendt rosterformat).");
  const afterPane = html.slice(pane.index + pane[0].length);
  // Subsequent team tabs contain match history, which must never become members.
  const nextPane = /<div\b[^>]*\bid\s*=\s*["']pane-(?!roster\b)[^"']+["'][^>]*>/i.exec(afterPane);
  const section = nextPane ? afterPane.slice(0, nextPane.index) : afterPane;
  if (/\b(?:pagination|paginator|paginate|paging|loadMore|infiniteScroll|serverSide)\b|\brel\s*=\s*["']next["']|[?&](?:page|offset|cursor)=/i.test(section)) {
    throw rosterError("medlemslisten er pagineret eller indlæses i flere dele; det komplette format er ikke verificeret.");
  }
  const tables = [...section.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)]
    .filter(([table]) => /\bnewPowerTable\b/.test(attribute(table.slice(0, table.indexOf(">") + 1), "class") || ""));
  if (tables.length !== 1) throw rosterError("der forventes præcis én tabel med aktuelle medlemmer (ukendt rosterformat).");
  const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(tables[0][0]);
  if (!tbody) throw rosterError("medlemstabellens indhold mangler (ukendt rosterformat).");
  const riders = [];
  for (const [row] of tbody[1].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const riderName = plainText((row.match(/<[^>]*\bclass\s*=\s*["'][^"']*\bsticky-truncate\b[^"']*["'][^>]*>([\s\S]*?)<\//i) || [])[1]);
    if (!riderName) throw rosterError("en medlemsrække mangler navn (ukendt rosterformat).");
    const profile = (row.match(/\bdata-goto\s*=\s*["']?\/profile\/(\d+)(?=["'\s>])/i) || [])[1];
    const profileId = positiveId(profile);
    const rowId = positiveId(attribute(row.slice(0, row.indexOf(">") + 1), "data-rider-id"));
    if (rowId && profileId && rowId !== profileId) throw rosterError("en medlemsrække har modstridende profil-id'er.");
    const wkg = {};
    for (const [, opening, value] of row.matchAll(/(<td\b[^>]*>)([\s\S]*?)<\/td>/gi)) {
      if (attribute(opening, "data-format") !== "wkg" || attribute(opening, "data-time") !== "90") continue;
      const seconds = positiveId(attribute(opening, "data-power-time"));
      if (!seconds) continue;
      const power = Number(plainText(value));
      wkg[seconds] = Number.isFinite(power) && power > 0 ? power : null;
    }
    riders.push({ name: riderName, profileId, zwiftId: null, wkg });
  }
  const declared = embeddedArray(html, "Ladder.roster");
  if (!declared) throw rosterError("den indlejrede medlemsliste mangler (ukendt rosterformat).");
  if (!declared.length) throw rosterError("holdet har ingen medlemmer med brugbare id'er.");
  if (declared.some((rider) => !rider || typeof rider !== "object" || Number(rider.LadderTeam) !== id)) {
    throw rosterError("medlemslisten kan ikke afgrænses til holdets nuværende medlemmer.");
  }
  const expectedIds = new Set(declared.map((rider) => positiveId(rider.id)).filter(Boolean));
  const remaining = [...declared];
  let complete = true;
  // Consume identity matches first: a missing-id row must not take the place of
  // a different member who happens to share its name. Extra rows with an already
  // matched profile id remain available for the later explicit-id deduplication.
  for (const rider of riders.filter((member) => member.profileId)) {
    const index = remaining.findIndex((member) => positiveId(member.id) === rider.profileId);
    if (index !== -1) remaining.splice(index, 1);
    else if (!expectedIds.has(rider.profileId)) complete = false;
  }
  for (const rider of riders.filter((member) => !member.profileId)) {
    const index = remaining.findIndex((member) => String(member.ZPName || "").trim() === rider.name);
    if (index !== -1) remaining.splice(index, 1);
    else complete = false;
  }
  if (!complete || remaining.length) {
    throw rosterError(`medlemstabellen og den indlejrede liste stemmer ikke overens (${riders.length} rækker, ${declared.length} registrerede medlemmer).`);
  }
  if (!riders.length) throw rosterError("medlemstabellen er tom.");
  return { id, name, riders };
}

// A Ladder profile id is not assumed to be a Zwift id. Only explicit external
// profile links provide identity; Zwift's UUID athlete URLs cannot supply one.
function parseProfileIdentity(input) {
  const html = String(input || "").replace(/<!--[\s\S]*?-->/g, "");
  const ids = new Set();
  for (const [anchor] of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attribute(anchor, "href");
    if (!href) continue;
    let url;
    try { url = new URL(href); } catch { continue; }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const host = url.hostname.toLowerCase();
    let id = null;
    if ((host === "zwiftpower.com" || host === "www.zwiftpower.com") && url.pathname === "/profile.php") {
      id = positiveId(url.searchParams.get("z"));
    } else if (["zwift.com", "www.zwift.com", "my.zwift.com"].includes(host)) {
      id = positiveId((url.pathname.match(/^\/(?:athlete|profile)\/(\d+)\/?$/) || [])[1]);
    }
    if (id) ids.add(id);
  }
  if (ids.size > 1) throw rosterError("profilen har modstridende eksplicitte Zwift-id'er.");
  return ids.size ? [...ids][0] : null;
}

function teamReference(id, name) {
  const path = `/team/n/${Number(id)}`;
  return { id: String(Number(id)), name, path, url: `${LADDER_BASE}${path}` };
}

function parseSummaryTeams(html) {
  const ranked = embeddedArray(html, "defaultLadderData");
  const all = embeddedArray(html, "playonTeams");
  if (!ranked && !all) throw parserError("Ladders holdkatalog har et ukendt format: holdlisten mangler i /summary.");
  const teams = new Map();
  for (const item of [...(all || []), ...(ranked || [])]) {
    const team = item?.data || item;
    if (!team || !positiveId(team.id) || typeof team.name !== "string" || !team.name.trim()) {
      throw parserError("Ladders holdkatalog indeholder en ugyldig holdidentitet.");
    }
    teams.set(String(Number(team.id)), teamReference(team.id, team.name.trim()));
  }
  if (!teams.size) throw parserError("Ladders holdkatalog er tomt.");
  return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name, "da") || Number(a.id) - Number(b.id));
}

function parseTeamInput(input) {
  const text = String(input || "").trim();
  if (!text) throw parserError("Vælg en modstander ved navn eller holdlink.");
  if (!/^(?:https?:\/\/|\/)/i.test(text)) {
    if (/^[a-z][\w+.-]*:\/\//i.test(text)) throw parserError("Brug et holdlink på ladder.cycleracing.club.");
    return { name: text };
  }
  let url;
  try { url = new URL(text, LADDER_BASE); } catch { throw parserError("Holdlinket er ugyldigt."); }
  if (!["https:", "http:"].includes(url.protocol) || url.host !== "ladder.cycleracing.club" || url.username || url.password) {
    throw parserError("Brug et holdlink på ladder.cycleracing.club.");
  }
  const numeric = /^\/team\/n\/([1-9]\d*)\/?$/.exec(url.pathname);
  if (numeric && positiveId(numeric[1])) return { id: String(Number(numeric[1])), path: `/team/n/${Number(numeric[1])}` };
  const named = /^\/(teamView|matchlist\/fixtures)\/([^/]+)\/?$/.exec(url.pathname);
  if (named) {
    let name;
    try { name = decodeURIComponent(named[2]).trim(); } catch { throw parserError("Holdlinket har ugyldig tegnkodning."); }
    const unsafe = [...name].some((char) => "/\\?#".includes(char) || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
    if (name && !unsafe && name !== "." && name !== "..") {
      return { name, path: `/teamView/${encodeURIComponent(name)}` };
    }
  }
  throw parserError("Brug et Ladder-holdlink med /team/n/{id}, /teamView/{navn} eller /matchlist/fixtures/{navn}.");
}

module.exports = { parseFixtureList, parseFixture, POWER_SECONDS, parseRosterPage, parseProfileIdentity, parseSummaryTeams, parseTeamInput, teamReference };
