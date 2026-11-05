/**
 * Compact Zwift's public event feed into calendar suggestions.
 *
 * Pure: the raw feed goes in, calendar-shaped rows come out, no I/O. The feed URL lives here so
 * the site has one place for it. app/lib/zwiftPublicEvents.ts does the fetching and caching.
 * Unlike the modules in coach/, this one is not copied into apps/bot —
 * only the website offers the picker — so it is imported directly by the site and tested from the
 * repo root.
 *
 * Feed shape verified 2026-09-07 against the live endpoint: a rolling ~7-day window of DZR-tagged
 * events. ZRL is absent, being WTRL-organised rather than DZR-tagged.
 *
 * The one detail everything else hangs on: each subgroup has its own eventSubgroupStart. DZR After
 * Party runs 15:15Z for category A through 15:19Z for E, so the parent event's eventStart is the
 * A-group's time and wrong for everyone else. Telling a rider the wrong minute is how they miss
 * their race, so the subgroup's own start is what reaches the calendar.
 */

const TZ = "Europe/Copenhagen";
const DZR_UPCOMING_EVENTS_URL =
  "https://us-or-rly101.zwift.com/api/public/events/upcoming?limit=200&tags=dzr";
const MAX_EVENTS = 40;
const MAX_SUBGROUPS = 10;

/**
 * Split a UTC instant into the club's local date and wall-clock time, both as text.
 *
 * Done here rather than in the browser so every member sees the same start time wherever they
 * are, and so the stored calendar row needs no timezone to interpret later.
 */
function localParts(iso) {
  const date = new Date(String(iso || ""));
  if (Number.isNaN(date.getTime())) return null;
  return {
    eventDate: new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: TZ,
    }).format(date),
    startTime: new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: TZ,
    }).format(date),
  };
}

function compactSubgroup(raw) {
  const parts = localParts(raw?.eventSubgroupStart);
  if (!parts) return null;
  const from = Number(raw?.fromPaceValue);
  const to = Number(raw?.toPaceValue);
  const hasPace = Number.isFinite(from) && Number.isFinite(to) && to > 0;
  return {
    id: Number(raw?.id) || 0,
    label: String(raw?.subgroupLabel || "").trim() || "—",
    eventDate: parts.eventDate,
    startTime: parts.startTime,
    // Zwift Racing Score band, e.g. "350-520". Null when the event does not enforce categories.
    scoreRange: raw?.rangeAccessLabel ? String(raw.rangeAccessLabel) : null,
    paceRange: hasPace ? `${from.toFixed(1)}–${to.toFixed(1)} W/kg` : null,
  };
}

function compactEvent(raw) {
  const id = Number(raw?.id);
  const name = String(raw?.name || "").trim();
  const parts = localParts(raw?.eventStart);
  if (!id || !name || !parts) return null;

  const subgroups = (Array.isArray(raw?.eventSubgroups) ? raw.eventSubgroups : [])
    .map(compactSubgroup)
    .filter(Boolean)
    .slice(0, MAX_SUBGROUPS);
  // An event with no readable subgroup has no start time anyone can be told, so it is dropped
  // rather than offered with the parent's time standing in for it.
  if (!subgroups.length) return null;

  const duration = Number(raw?.durationInSeconds);
  const distance = Number(raw?.distanceInMeters);
  return {
    id,
    name: name.slice(0, 120),
    eventType: String(raw?.eventType || "EVENT"),
    url: `https://www.zwift.com/events/view/${id}`,
    eventDate: parts.eventDate,
    durationMinutes: Number.isFinite(duration) && duration > 0 ? Math.round(duration / 60) : null,
    distanceKm: Number.isFinite(distance) && distance > 0 ? Math.round(distance / 100) / 10 : null,
    categoryEnforcement: raw?.categoryEnforcement === true,
    subgroups,
  };
}

/** @returns {Array} calendar-shaped events, soonest first. */
function compactZwiftEvents(feed) {
  return (Array.isArray(feed) ? feed : [])
    .map(compactEvent)
    .filter(Boolean)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.name.localeCompare(b.name))
    .slice(0, MAX_EVENTS);
}

/**
 * The subgroup a Zwift Racing Score falls into, or null.
 *
 * Only ever a highlight in the picker — the member clicks the category themselves. Stats go stale
 * and plenty of members have no linked Zwift id, so this must never be load-bearing.
 */
function suggestedSubgroup(event, racingScore) {
  const score = Number(racingScore);
  if (!Number.isFinite(score) || !event?.categoryEnforcement) return null;
  for (const subgroup of event.subgroups || []) {
    const match = /^(\d+)-(\d+)$/.exec(String(subgroup.scoreRange || ""));
    if (!match) continue;
    const low = Number(match[1]);
    const high = Number(match[2]);
    // Bands are given as 0-180, 180-350, … so the boundary belongs to the lower band, matching
    // the feed's own accessExpression ("subgroup.label == 2 && scoring.max30 < 690").
    if (score > low && score <= high) return subgroup.label;
  }
  return null;
}

/**
 * The event id from a typed number or a Zwift event URL.
 * Empty input is "". Anything else that is not an id is null.
 */
function eventIdFromInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const fromUrl = text.match(/events\/view\/(\d+)/i);
  const id = fromUrl ? fromUrl[1] : text;
  return /^\d+$/.test(id) ? id : null;
}

/** Remove only /eu from pasted Zwift event links, preserving the rest verbatim. */
function normalizeZwiftEventUrl(value) {
  return value.replace(/^((?:https?:)?\/\/(?:www\.)?zwift\.com)\/eu(?=\/events\/(?:[^/?#\s]+\/)*view\/\d+(?:[/?#]|$))/, "$1");
}

module.exports = { compactZwiftEvents, suggestedSubgroup, localParts, eventIdFromInput, normalizeZwiftEventUrl, TZ, DZR_UPCOMING_EVENTS_URL };
