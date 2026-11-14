// Regex parsers for ladder.cycleracing.club pages; the site has no public API.
const { powerupName } = require("../powerupIcons");
const { parseArchPowerups, parsePowerupPercent } = require("../powerupPlaces");

const POWER_SECONDS = [5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    });
}

// A team page has a TEAMID and its own fixtures link, even when it has no upcoming matches.
// Do not use <title>: the site also returns login/404 pages with HTTP 200.
function parseTeamPage(html) {
  if (!/\bconst\s+TEAMID\s*=\s*\d+\s*;/.test(html)) return null;
  const path = html.match(/\bhref=(["'])\/matchlist\/fixtures\/(.*?)\1/i);
  if (!path) return null;
  try {
    return decodeURIComponent(decodeEntities(path[2])).trim() || null;
  } catch {
    return null;
  }
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

module.exports = { parseTeamPage, parseFixtureList, parseFixture, POWER_SECONDS };
