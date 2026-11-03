const test = require("node:test");
const assert = require("node:assert");

const { compactZwiftEvents, suggestedSubgroup, eventIdFromInput, normalizeZwiftEventUrl } = require("./zwiftEvents");

/**
 * Trimmed from the live feed, 2026-09-07. The timestamps are verbatim: the whole point of these
 * tests is that per-category starts one minute apart survive the transform intact.
 */
const FEED = [
  {
    id: 5693445,
    name: "DZR After Party Series",
    eventStart: "2026-09-10T15:15:00.000+0000",
    durationInSeconds: 0,
    distanceInMeters: 39591.0,
    categoryEnforcement: true,
    eventType: "RACE",
    eventSubgroups: [
      { id: 7324053, subgroupLabel: "A", eventSubgroupStart: "2026-09-10T15:15:00.000+0000", rangeAccessLabel: "690-1000", fromPaceValue: 4.0, toPaceValue: 5.0 },
      { id: 7324054, subgroupLabel: "B", eventSubgroupStart: "2026-09-10T15:16:00.000+0000", rangeAccessLabel: "520-690", fromPaceValue: 3.2, toPaceValue: 4.0 },
      { id: 7324055, subgroupLabel: "C", eventSubgroupStart: "2026-09-10T15:17:00.000+0000", rangeAccessLabel: "350-520", fromPaceValue: 2.5, toPaceValue: 3.2 },
      { id: 7324056, subgroupLabel: "D", eventSubgroupStart: "2026-09-10T15:18:00.000+0000", rangeAccessLabel: "180-350", fromPaceValue: 1.0, toPaceValue: 2.5 },
      { id: 7324057, subgroupLabel: "E", eventSubgroupStart: "2026-09-10T15:19:00.000+0000", rangeAccessLabel: "0-180", fromPaceValue: 0.0, toPaceValue: 0.0 },
    ],
  },
  {
    id: 5697109,
    name: "In the Zone 2 with DZR",
    eventStart: "2026-09-12T07:30:00.000+0000",
    durationInSeconds: 7200,
    distanceInMeters: 0.0,
    categoryEnforcement: false,
    eventType: "GROUP_WORKOUT",
    eventSubgroups: [
      { id: 7333789, subgroupLabel: "E", eventSubgroupStart: "2026-09-12T07:30:00.000+0000", rangeAccessLabel: null, fromPaceValue: 1.0, toPaceValue: 5.0 },
    ],
  },
];

test("each category keeps its own start time, not the parent event's", () => {
  const [afterParty] = compactZwiftEvents(FEED);
  const byLabel = Object.fromEntries(afterParty.subgroups.map((s) => [s.label, s.startTime]));
  // Copenhagen is UTC+2 in September, so 15:17Z is 17:17 locally. The load-bearing part is that
  // C is one minute after B and two after A — a rider given the A time would miss their start.
  assert.deepStrictEqual(byLabel, {
    A: "17:15",
    B: "17:16",
    C: "17:17",
    D: "17:18",
    E: "17:19",
  });
  assert.notStrictEqual(byLabel.C, byLabel.A, "C must not inherit the parent event's time");
});

test("dates are the club's, not the server's", () => {
  const [afterParty] = compactZwiftEvents(FEED);
  assert.strictEqual(afterParty.eventDate, "2026-09-10");
  assert.strictEqual(afterParty.subgroups[0].eventDate, "2026-09-10");
});

test("carries what a calendar row needs and drops the prose", () => {
  const [afterParty, zone2] = compactZwiftEvents(FEED);
  assert.strictEqual(afterParty.url, "https://www.zwift.com/events/view/5693445");
  assert.strictEqual(afterParty.distanceKm, 39.6);
  assert.strictEqual(afterParty.durationMinutes, null, "a distance race has no duration");
  assert.strictEqual(afterParty.eventType, "RACE");
  assert.strictEqual(zone2.durationMinutes, 120);
  assert.strictEqual(zone2.distanceKm, null);
  assert.strictEqual(zone2.eventType, "GROUP_WORKOUT");
  assert.ok(!("description" in afterParty), "description prose must not be carried");
});

test("category bands and pace ranges survive", () => {
  const [afterParty, zone2] = compactZwiftEvents(FEED);
  assert.strictEqual(afterParty.subgroups[2].scoreRange, "350-520");
  assert.strictEqual(afterParty.subgroups[2].paceRange, "2.5–3.2 W/kg");
  assert.strictEqual(zone2.subgroups[0].scoreRange, null, "unenforced events have no band");
  assert.strictEqual(zone2.subgroups[0].paceRange, "1.0–5.0 W/kg");
});

test("events are sorted soonest first", () => {
  const names = compactZwiftEvents([...FEED].reverse()).map((e) => e.name);
  assert.deepStrictEqual(names, ["DZR After Party Series", "In the Zone 2 with DZR"]);
});

test("unusable entries are dropped rather than half-rendered", () => {
  assert.deepStrictEqual(compactZwiftEvents(null), []);
  assert.deepStrictEqual(compactZwiftEvents([{ id: 1, name: "no subgroups", eventStart: "2026-09-10T15:15:00Z", eventSubgroups: [] }]), []);
  assert.deepStrictEqual(compactZwiftEvents([{ id: 1, name: "bad date", eventStart: "soon", eventSubgroups: [{ subgroupLabel: "A", eventSubgroupStart: "soon" }] }]), []);
  assert.deepStrictEqual(compactZwiftEvents([{ name: "no id", eventStart: "2026-09-10T15:15:00Z" }]), []);
});

test("suggestedSubgroup picks the band a racing score falls in", () => {
  const [afterParty] = compactZwiftEvents(FEED);
  assert.strictEqual(suggestedSubgroup(afterParty, 400), "C");
  assert.strictEqual(suggestedSubgroup(afterParty, 100), "E");
  assert.strictEqual(suggestedSubgroup(afterParty, 900), "A");
  // Bands read as 180-350, 350-520 …, so a score on a boundary belongs to the lower band —
  // matching the feed's own accessExpression, which uses `< 520` for the band above.
  assert.strictEqual(suggestedSubgroup(afterParty, 350), "D");
  assert.strictEqual(suggestedSubgroup(afterParty, 520), "C");
});

test("an event id can be typed or pasted from the Zwift event page", () => {
  assert.strictEqual(eventIdFromInput("5589078"), "5589078");
  assert.strictEqual(eventIdFromInput("https://www.zwift.com/eu/events/view/5589078"), "5589078"); // zwift-link-check: allow-input
  assert.strictEqual(eventIdFromInput(""), "");
  assert.strictEqual(eventIdFromInput("not an event"), null);
});

test("suggestedSubgroup declines rather than guessing", () => {
  const [afterParty, zone2] = compactZwiftEvents(FEED);
  assert.strictEqual(suggestedSubgroup(afterParty, null), null, "no score");
  assert.strictEqual(suggestedSubgroup(afterParty, NaN), null);
  assert.strictEqual(suggestedSubgroup(afterParty, 2000), null, "outside every band");
  assert.strictEqual(suggestedSubgroup(zone2, 400), null, "event does not enforce categories");
});

test("pasted event links open Companion and preserve event secrets and fragments", () => {
  const canonical = "https://www.zwift.com/events/view/5763806?eventSecret=abc%2B123#details";
  for (const input of [
    "https://www.zwift.com/eu/events/view/5763806?eventSecret=abc%2B123#details", // zwift-link-check: allow-input
    "https://www.zwift.com/uk/events/tag/dzr/view/5763806?eventSecret=abc%2B123#details", // zwift-link-check: allow-input
    "http://zwift.com/eu-de/events/tag/dzr/view/5763806/?eventSecret=abc%2B123#details", // zwift-link-check: allow-input
    "https://www.zwift.com/events/tag/dzr/view/5763806?eventSecret=abc%2B123#details", // zwift-link-check: allow-input
    canonical,
  ]) {
    assert.strictEqual(normalizeZwiftEventUrl(input), canonical);
  }
});

test("normalization leaves unrelated and malformed URLs alone", () => {
  for (const input of [
    "https://zwiftinsider.com/route/the-mega-pretzel/",
    "https://www.zwift.com/eu/",
    "https://example.com/eu/events/view/5763806",
    "https://www.zwift.com.example.com/eu/events/view/5763806",
    "not a URL",
  ]) {
    assert.strictEqual(normalizeZwiftEventUrl(input), input);
  }
});
