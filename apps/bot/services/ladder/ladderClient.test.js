const test = require("node:test");
const assert = require("node:assert/strict");
const { refreshSignups, refreshFixture, describeFailure, getFixtureStart, createRosterReader } = require("./ladderClient");

const MIN = 60 * 1000;

test("refreshSignups calls the ladder once per 30 minutes per event", async () => {
  const calls = [];
  const fetchPage = async (path) => calls.push(path);
  const t0 = 1_800_000_000_000;

  assert.equal(await refreshSignups("5748317", { fetchPage, now: t0 }), true);
  assert.equal(await refreshSignups("5748317", { fetchPage, now: t0 + 29 * MIN }), false);
  assert.equal(await refreshSignups("5748317", { fetchPage, now: t0 + 31 * MIN }), true);
  assert.equal(await refreshSignups("5748999", { fetchPage, now: t0 + 31 * MIN }), true);
  assert.deepEqual(calls, ["/rSignups/5748317", "/rSignups/5748317", "/rSignups/5748999"]);
});

test("refreshSignups does nothing without an event id", async () => {
  let called = false;
  assert.equal(await refreshSignups(null, { fetchPage: async () => (called = true) }), false);
  assert.equal(called, false);
});

test("refreshSignups reports a failure instead of throwing and does not retry within the cooldown", async () => {
  let calls = 0;
  const fetchPage = async () => {
    calls += 1;
    throw new Error("429");
  };
  const t0 = 1_800_000_000_000;
  assert.equal(await refreshSignups("7000001", { fetchPage, now: t0 }), false);
  assert.equal(await refreshSignups("7000001", { fetchPage, now: t0 + MIN }), false);
  assert.equal(calls, 1);
});

test("refreshFixture returns the fixture unchanged when there is no event id", async () => {
  const fixture = { id: "1", zwiftEventId: null, start: "2999-01-01T00:00:00Z" };
  assert.equal(await refreshFixture(fixture), fixture);
});

test("refreshFixture leaves a match that has already started alone", async () => {
  const fixture = { id: "2", zwiftEventId: "7100001", start: "2026-10-05T17:30:00Z" };
  assert.equal(await refreshFixture(fixture, Date.parse("2026-10-21T12:00:00Z")), fixture);
});

test("getFixtureStart remembers a start time and retries when the page had none", async () => {
  const cache = new Map();
  let start = null;
  const load = async (id) => ({ id, start });

  assert.equal(await getFixtureStart("17507", { load, cache }), null);
  assert.equal(cache.has("17507"), false);

  start = "2026-10-28T18:40:00.000Z";
  assert.equal(await getFixtureStart("17507", { load, cache }), start);
  start = "1999-01-01T00:00:00.000Z";
  assert.equal(await getFixtureStart("17507", { load, cache }), "2026-10-28T18:40:00.000Z");
});

test("describeFailure names the API status, a timeout or a missing connection", () => {
  assert.equal(describeFailure({ response: { status: 502 } }), "API svarede 502");
  assert.equal(describeFailure({ response: { status: 401 } }), "API svarede 401");
  assert.equal(describeFailure({ code: "ECONNABORTED" }), "API svarede ikke i tide");
  assert.equal(describeFailure({ code: "ENOTFOUND" }), "ingen forbindelse til API");
});

test("scout reads fresh complete rosters, verifies identities from profiles, deduplicates known ids and keeps unknown members", async () => {
  const calls = [];
  const read = createRosterReader({
    fetchPage: async (path) => { calls.push(path); return path; },
    parseTeamPage: () => ({ id: "82", name: "Our team", riders: [
      { name: "First", profileId: 10, zwiftId: null, wkg: { 15: 8 } },
      { name: "Duplicate", profileId: 11, zwiftId: null, wkg: { 300: 4 } },
      { name: "No profile one", profileId: null, zwiftId: null, wkg: {} },
      { name: "No profile two", profileId: null, zwiftId: null, wkg: {} },
      { name: "No external link", profileId: 12, zwiftId: null, wkg: {} },
      { name: "No power", profileId: 13, zwiftId: null, wkg: {} },
    ] }),
    parseIdentity: (path) => ({ "/profile/10": 1001, "/profile/11": 1001, "/profile/12": null, "/profile/13": 1002 })[path],
  });
  const first = await read({ id: "82" });
  assert.equal(first.riders.length, 5);
  assert.equal(first.riders[0].zwiftId, 1001);
  assert.deepEqual(first.riders[0].wkg, { 15: 8, 300: 4 });
  assert.equal(first.riders.filter((rider) => rider.zwiftId === null).length, 3);
  assert.deepEqual(first.riders.find((rider) => rider.zwiftId === 1002).wkg, {});
  assert.equal(first.url, "https://ladder.cycleracing.club/team/n/82");
  await read({ id: "82" });
  assert.equal(calls.filter((path) => path === "/team/n/82").length, 2);
  assert.equal(calls.filter((path) => path === "/profile/10").length, 2);
});

test("scout does not treat internal Ladder profile ids as verified Zwift ids", async () => {
  const read = createRosterReader({
    fetchPage: async () => "no external identity",
    parseTeamPage: () => ({ id: "82", name: "Team", riders: [{ name: "Unknown", profileId: 9999, wkg: {} }] }),
    parseIdentity: () => null,
  });
  await assert.rejects(read({ id: "82" }), /Ingen ryttere.*verificerbart Zwift-id/);
});

test("scout keeps members whose profile fetch failed and limits concurrent profile reads", async () => {
  let active = 0;
  let peak = 0;
  const read = createRosterReader({
    fetchPage: async (path) => {
      if (path.startsWith("/team/")) return "team";
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      if (path === "/profile/2") throw new Error("profile unavailable");
      return path;
    },
    parseTeamPage: () => ({ id: "82", name: "Team", riders: Array.from({ length: 11 }, (_, index) => ({ name: `Rider ${index}`, profileId: index + 1, wkg: {} })) }),
    parseIdentity: (path) => Number(path.split("/").pop()) + 1000,
  });
  const roster = await read({ id: "82" });
  assert.equal(roster.riders.length, 11);
  assert.equal(roster.riders.filter((rider) => !rider.zwiftId).length, 1);
  assert.equal(peak, 4);
});

test("scout rejects unknown roster format and a team identity mismatch", async () => {
  const badFormat = createRosterReader({ fetchPage: async () => "bad", parseTeamPage: () => { throw new Error("Ukendt rosterformat"); } });
  await assert.rejects(badFormat({ id: "82" }), /Ukendt rosterformat/);
  const wrongTeam = createRosterReader({ fetchPage: async () => "wrong team", parseTeamPage: () => ({ id: "102", name: "Wrong", riders: [] }) });
  await assert.rejects(wrongTeam({ id: "82" }), /andet hold/);
});
