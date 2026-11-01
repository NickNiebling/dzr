const test = require("node:test");
const assert = require("node:assert/strict");

const { setZwiftCatalog } = require("./zwiftCatalog");
const { buildRouteProfileImages } = require("./routeProfileImages");

setZwiftCatalog({
  worlds: [{ slug: "watopia", name: "Watopia" }],
  routes: [{ name: "Road to Sky", world: "watopia", distance: 17.5, elevation: 1044, sports: ["cycling"], segments: [], segmentsOnRoute: [] }],
  segments: [],
});

const profile = {
  routeName: "Road to Sky",
  raceKm: 17.6,
  leadInKm: 0.1,
  distanceKm: [0.1, 5, 17.4],
  altitudeM: [100, 20, 1050],
  segments: [{ name: "Alpe du Zwift", type: "climb", fromKm: 5.1, toKm: 17.37 }],
  climbs: [],
};

const render = {
  renderRouteProfile: () => Buffer.from("profile"),
  renderClimbZoom: () => Buffer.from("zoom"),
};

test("resolves the exact route and world before asking the site", async () => {
  const requests = [];
  const result = await buildRouteProfileImages({ route: "road to sky" }, {
    render,
    getRouteProfile: async (req) => {
      requests.push(req);
      return { success: true, profile };
    },
  });
  assert.equal(result.success, true);
  assert.deepEqual(requests[0], { world: "Watopia", route: "Road to Sky", laps: 1, distanceKm: 0, climbs: [], ranges: [], finish: "" });
  assert.equal(result.files.length, 1);
  assert.match(result.caption, /\*\*Road to Sky\*\* · Watopia · 17\.6 km · 1030 m · incl\. 0\.1 km lead-in/);
});

test("adds close-ups of the route's climbs when asked", async () => {
  const result = await buildRouteProfileImages({ route: "Road to Sky", closeups: true }, {
    render,
    getRouteProfile: async () => ({ success: true, profile }),
  });
  assert.deepEqual(result.files.map((f) => f.name), ["road-to-sky-profile.png", "alpe-du-zwift-closeup.png"]);
});

test("asks the site for a route the catalog does not know", async () => {
  const requests = [];
  const result = await buildRouteProfileImages({ route: "Caldera Coaster", world: "Watopia" }, {
    render,
    getRouteProfile: async (req) => {
      requests.push(req);
      return { success: true, profile: { ...profile, routeName: "Caldera Coaster" } };
    },
  });
  assert.equal(result.success, true);
  assert.equal(requests[0].route, "Caldera Coaster");
  assert.equal(requests[0].world, "Watopia");
});

test("passes a site miss through instead of guessing another route", async () => {
  const result = await buildRouteProfileImages({ route: "No Such Route 2099" }, {
    render,
    getRouteProfile: async () => ({ success: false, message: "No Zwift route matched that name" }),
  });
  assert.deepEqual(result, { success: false, message: "No Zwift route matched that name" });
});

test("an event route id still requests a profile when the catalog has no name", async () => {
  const requests = [];
  const result = await buildRouteProfileImages({ event: "5754003" }, {
    render,
    getZwiftEvent: async () => ({
      success: true,
      event: { id: 5754003, route: null, world: null, route_id: 3266658632, laps: 1, distance_km: null },
    }),
    getRouteProfile: async (req) => {
      requests.push(req);
      return { success: true, profile: { ...profile, routeName: "Caldera Coaster", world: "Watopia" } };
    },
  });
  assert.equal(result.success, true);
  assert.equal(requests[0].routeId, 3266658632);
  assert.match(result.caption, /\*\*Caldera Coaster\*\* · Watopia/);
});

test("passes on the site's error", async () => {
  const result = await buildRouteProfileImages({ route: "Road to Sky" }, {
    render,
    getRouteProfile: async () => ({ success: false, message: "The site has no elevation profile for that route." }),
  });
  assert.deepEqual(result, { success: false, message: "The site has no elevation profile for that route." });
});

test("passes a custom distance, custom KOMs and a finish to the site, and closes up each", async () => {
  const requests = [];
  const site = {
    ...profile,
    climbs: [
      { title: "Alpe du Zwift", fromKm: 4.95, toKm: 17.45, matched: true, climb: true },
      { title: "Final ramp", fromKm: 15, toKm: 17, matched: true, climb: true },
      { title: "Nowhere", fromKm: 0, toKm: 0, matched: false, climb: true },
    ],
    finish: { title: "Alpe du Zwift", fromKm: 16, toKm: 17.4, matched: true },
  };
  const zooms = [];
  const result = await buildRouteProfileImages({
    route: "Road to Sky",
    distance_km: 23.4,
    laps: 3,
    climbs: ["Alpe du Zwift"],
    custom_koms: [{ name: "Final ramp", from_km: 15, to_km: 17 }, { name: "Nowhere", from_km: 50, to_km: 51 }, { name: "Bad", from_km: 5, to_km: 4 }],
    finish: "banner on top of Alpe du Zwift",
  }, {
    render: { ...render, renderClimbZoom: (_p, zoom) => { zooms.push(zoom); return Buffer.from("z"); } },
    getRouteProfile: async (req) => {
      requests.push(req);
      return { success: true, profile: site };
    },
  });

  assert.equal(requests[0].distanceKm, 23.4);
  assert.equal(requests[0].laps, 1);
  assert.deepEqual(requests[0].ranges, [{ name: "Final ramp", fromKm: 15, toKm: 17 }, { name: "Nowhere", fromKm: 50, toKm: 51 }]);
  assert.equal(requests[0].finish, "banner on top of Alpe du Zwift");
  assert.deepEqual(zooms.map((z) => [z.title, z.exact]), [["Alpe du Zwift", false], ["Final ramp", true], ["Finish: Alpe du Zwift", undefined]]);
  assert.deepEqual(result.missing, ["Nowhere"]);
});

test("closes up every climb on a long route, not just the first three", async () => {
  const climbs = ["Zwift KOM", "Titans Grove KOM Rev.", "Mayan Mountainside KOM", "Itza KOM"].map((name, i) => ({
    name, type: "climb", fromKm: 5 + i * 10, toKm: 7 + i * 10,
  }));
  const result = await buildRouteProfileImages({ route: "Road to Sky", closeups: true }, {
    render,
    getRouteProfile: async () => ({ success: true, profile: { ...profile, raceKm: 46, segments: climbs } }),
  });
  assert.equal(result.files.length, 5);
  assert.equal(result.files.at(-1).name, "itza-kom-closeup.png");
});

test("an event fills in the course and its powerups are drawn on the profile", async () => {
  const requests = [];
  const drawn = [];
  const result = await buildRouteProfileImages({ event: "5754003" }, {
    render: { ...render, renderRouteProfile: (_p, options) => { drawn.push(options); return Buffer.from("profile"); } },
    getZwiftEvent: async () => ({
      success: true,
      event: { id: 5754003, route: "Road to Sky", world: "Watopia", laps: 1, distance_km: null, powerups: ["Feather"], powerup_ids: [0] },
    }),
    getRouteProfile: async (req) => { requests.push(req); return { success: true, profile }; },
  });
  assert.equal(result.success, true);
  assert.equal(requests[0].route, "Road to Sky");
  assert.ok(drawn[0].powerups.some((row) => row.powerupIds.includes(0)));
  assert.match(result.caption, /Powerups: Feather/);
});

test("an event without powerup tags says so, and no route or event is an error", async () => {
  const result = await buildRouteProfileImages({ event: "1", route: "Road to Sky" }, {
    render,
    getZwiftEvent: async () => ({ success: true, event: { id: 1, route: "Road to Sky", world: "Watopia" } }),
    getRouteProfile: async () => ({ success: true, profile }),
  });
  assert.match(result.caption, /Powerups: none set for this event/);
  const missing = await buildRouteProfileImages({}, { render });
  assert.equal(missing.success, false);
});
