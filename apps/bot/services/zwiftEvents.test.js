const test = require("node:test");
const assert = require("node:assert/strict");

const { setZwiftCatalog } = require("./zwiftCatalog");
const { getZwiftEvent, parseEventId, compactEvent } = require("./zwiftEvents");

setZwiftCatalog({
  worlds: [{ slug: "new-york", name: "New York" }],
  routes: [{ id: 5103974, name: "Lady Liberty", world: "new-york" }],
  segments: [],
});

test("event ids come from numbers and any Zwift event link", () => {
  assert.equal(parseEventId("5380255"), 5380255);
  assert.equal(parseEventId(5380255), 5380255);
  assert.equal(parseEventId("https://www.zwift.com/eu-de/events/tag/dcu/view/2539801"), 2539801); // zwift-link-check: allow-input
  assert.equal(parseEventId("https://www.zwift.com/events/view/5380255?eventSecret=abc"), 5380255);
  assert.equal(parseEventId("not an event"), null);
});

test("names the route from its id and lists only categories on another course", () => {
  const event = compactEvent({
    id: 1,
    name: "DCU E-Serien  ",
    eventStart: "2026-10-22T17:30:00.000+0000",
    routeId: 5103974,
    laps: 3,
    distanceInMeters: 0,
    eventSubgroups: [
      { subgroupLabel: "A", routeId: 5103974, laps: 3, distanceInMeters: 0 },
      { subgroupLabel: "D", routeId: 5103974, laps: 2, distanceInMeters: 0 },
    ],
  });
  assert.equal(event.name, "DCU E-Serien");
  assert.equal(event.route, "Lady Liberty");
  assert.equal(event.world, "New York");
  assert.equal(event.laps, 3);
  assert.deepEqual(event.categories_with_other_course.map((g) => [g.category, g.laps]), [["D", 2]]);
});

test("a distance race reports km instead of laps", () => {
  const event = compactEvent({ id: 2, name: "x", routeId: 5103974, laps: 0, distanceInMeters: 23400, eventSubgroups: [] });
  assert.equal(event.distance_km, 23.4);
  assert.equal(event.laps, null);
});

test("an unknown route id is reported, not invented", () => {
  const event = compactEvent({ id: 3, name: "x", routeId: 42, laps: 1, eventSubgroups: [] });
  assert.equal(event.route, null);
  assert.equal(event.route_known, false);
});

test("fetches from Zwift's public API and handles a missing event", async () => {
  const urls = [];
  const http = { get: async (url) => { urls.push(url); return url.endsWith("/404404") ? { status: 404 } : { status: 200, data: { id: 777777, name: "E", routeId: 5103974, laps: 1, eventSubgroups: [] } }; } };
  assert.equal((await getZwiftEvent("777777", { http })).event.route, "Lady Liberty");
  assert.match(urls[0], /\/api\/public\/events\/777777$/);
  assert.equal((await getZwiftEvent("404404", { http })).success, false);
});

test("reads the powerup setup from the event tags, falling back to a category's tags", () => {
  const fromEvent = compactEvent({ id: 2, routeId: 5103974, tags: ["powerup_percent=\"0,50,5,50\"", "arch_powerup=\"0,3\""] });
  assert.deepEqual(fromEvent.powerups, ["Feather", "Aero"]);
  assert.deepEqual(fromEvent.powerup_ids, [0, 5]);
  assert.deepEqual(fromEvent.arch_powerups, { 0: 3 });
  const fromCategory = compactEvent({ id: 3, routeId: 5103974, tags: [], eventSubgroups: [{ subgroupLabel: "A", routeId: 5103974, tags: ["powerup_percent=\"1,100\""] }] });
  assert.deepEqual(fromCategory.powerups, ["Draft"]);
  assert.equal(compactEvent({ id: 4, routeId: 5103974 }).powerups, undefined);
});

test("a ZRL race has only fixed banner powerups and a start powerup, on its categories", () => {
  const tags = ["zrl", "starting_powerup=4", "arch_powerup=\"0,0,82,0,81,5,5,3\""];
  const event = compactEvent({ id: 5673134, routeId: 5103974, tags: ["zrl"], eventSubgroups: [{ subgroupLabel: "A", routeId: 5103974, tags }] });
  assert.deepEqual(event.powerups, []);
  assert.deepEqual(event.arch_powerups, { 0: 0, 82: 0, 81: 5, 5: 3 });
  assert.deepEqual(event.banner_powerups, ["Feather", "Large XP", "Aero"]);
  assert.equal(event.start_powerup, "Burrito");
});
