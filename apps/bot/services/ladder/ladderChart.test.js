const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLadderChart } = require("./ladderChart");

// CI installs with --ignore-scripts, so the native canvas binary may be missing; rendering tests are skipped then.
let canvasAvailable = true;
try {
  require("canvas");
} catch {
  canvasAvailable = false;
}
const render = { skip: canvasAvailable ? false : "native canvas binary is not installed" };

function riders(prefix, base) {
  return [0, 1, 2].map((i) => ({
    name: `${prefix} ${i} [DZR]`,
    zwiftId: 1000 + i,
    zrs: 600 + i * 50,
    category: "B",
    form: 90 + i,
    wkg: { 15: base + 8, 60: base + 3, 120: base + 1.5, 300: base + i * 0.1, 1200: base - 0.8 + i * 0.05 },
  }));
}

// The chart is the W/kg comparison only. Route distance is passed in and no profile is fetched.
const fixture = {
  id: "1",
  start: "2026-10-05T17:30:00Z",
  route: "Croissant",
  world: "France",
  laps: 2,
  distance: null,
  routeId: null,
  powerups: [],
  archPowerups: {},
  colors: { home: "#213ed6", away: "#ff0000" },
  home: { name: "Home", riders: riders("Hjem", 4.4) },
  away: { name: "Away", riders: riders("Ude", 4.6) },
};

function readPng(buffer) {
  assert.deepEqual([...buffer.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("renders a PNG with the expected width", render, async () => {
  const { width, height } = readPng(await buildLadderChart(fixture, "Away"));
  assert.equal(width, 960);
  assert.ok(height > 1000);
});

test("grows taller when a team has more riders", render, async () => {
  const small = readPng(await buildLadderChart(fixture, "Away"));
  const bigger = { ...fixture, home: { ...fixture.home, riders: [...fixture.home.riders, ...riders("Ekstra", 4.0)] } };
  assert.ok(readPng(await buildLadderChart(bigger, "Away")).height > small.height);
});

test("renders even when teams have no riders", render, async () => {
  const empty = { ...fixture, home: { name: "Home", riders: [] }, away: { name: "Away", riders: [] } };
  assert.equal(readPng(await buildLadderChart(empty, null)).width, 960);
});

test("scout renders all 9 versus 11 roster rows without a match or route", render, async () => {
  const roster = (prefix, count) => Array.from({ length: count }, (_, index) => ({ name: `${prefix} ${index + 1}`, zwiftId: index + 1, wkg: {} }));
  const comparison = { scout: true, home: { name: "DZR", riders: roster("DZR", 9) }, away: { name: "Opponent", riders: roster("Opponent", 11) } };
  const png = readPng(await buildLadderChart(comparison, "DZR"));
  assert.equal(png.width, 960);
  assert.equal(png.height, 1910);
});
