// The roster is the current team roster, never a fixture's signups. Its table and
// embedded Ladder.roster must agree before we report a complete membership list.
function decodeEntities(value) {
  return String(value || "").replace(/&(?:amp|lt|gt|quot|apos|#39|#x[\da-f]+|#\d+);/gi, (entity) => {
    const named = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const code = entity.toLowerCase().startsWith("&#x") ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
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
  const error = new Error(`Ladder-truppen kunne ikke verificeres: ${detail}`);
  error.userMessage = error.message;
  return error;
}

// Read JSON, not JavaScript, even when a quoted name contains brackets or an
// escaped quote. Evaluating scripts from the remote site is unnecessary.
function embeddedRoster(html) {
  const assignment = /\bLadder\.roster\s*=\s*/.exec(html);
  if (!assignment) throw rosterError("den indlejrede medlemsliste mangler (ukendt rosterformat).");
  const start = assignment.index + assignment[0].length;
  if (html[start] !== "[") throw rosterError("den indlejrede medlemsliste har ukendt format.");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") {
      depth--;
      if (depth === 0) {
        try {
          const roster = JSON.parse(html.slice(start, index + 1));
          if (Array.isArray(roster)) return roster;
        } catch { /* Report a stable, concrete error below. */ }
        break;
      }
    }
  }
  throw rosterError("den indlejrede medlemsliste er ugyldig eller afkortet.");
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
  const declared = embeddedRoster(html);
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
  return { id, name, riders, nextPaths: [], expectedCount: declared.length };
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

module.exports = { parseRosterPage, parseProfileIdentity };
