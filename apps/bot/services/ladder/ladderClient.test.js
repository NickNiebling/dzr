const test = require("node:test");
const assert = require("node:assert/strict");
const { refreshSignups, refreshFixture, describeFailure, getFixtureStart, getRoster, warmCatalog, autocomplete, resolveTeam } = require("./ladderClient");

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

test("scout catalog shares refreshes, caches for 15 minutes and resolves only unambiguous names or valid links", async (t) => {
  const axios = require("axios");
  const config = require("../../config/config");
  const original = config.contentApi;
  config.contentApi = { baseUrl: "http://localhost", apiKey: "test" };
  t.after(() => { config.contentApi = original; });
  let now = 1000, calls = 0, finish;
  t.mock.method(Date, "now", () => now);
  const teams = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Team ${i}` }));
  const html = `const playonTeams = ${JSON.stringify([...teams, teams[0]])};`;
  const roster = require("node:fs").readFileSync(`${__dirname}/fixtures/roster-11.html`, "utf8");
  t.mock.method(axios, "get", async (_url, { params }) => {
    if (params.path !== "/summary") return { data: roster };
    calls += 1;
    return new Promise((resolve) => { finish = () => resolve({ data: html }); });
  });
  warmCatalog();
  assert.deepEqual(autocomplete("Team"), []);
  const pending = resolveTeam("Team 0");
  assert.equal(calls, 1);
  finish();
  assert.equal((await pending).id, "1");
  assert.equal(autocomplete("").length, 25);
  assert.equal(autocomplete("Team 0").length, 1);
  await assert.rejects(resolveTeam("Team"), /Flere Ladder-hold/);
  now += 15 * MIN - 1;
  autocomplete("");
  assert.equal(calls, 1);
  now += 1;
  autocomplete("");
  const refreshed = resolveTeam("Team 0");
  assert.equal(calls, 2);
  finish();
  await refreshed;
  for (const path of ["team/n/501", "teamView/Example%20Home", "matchlist/fixtures/Example%20Home"]) {
    assert.equal((await resolveTeam(`https://ladder.cycleracing.club/${path}`)).id, "501");
  }
  await assert.rejects(resolveTeam("https://example.com/team/n/501"), /ladder.cycleracing.club/);
  await assert.rejects(resolveTeam("/team/n/502"), /forventede/);
});

test("scout fetches complete rosters each time, deduplicates verified identities and retains unknown members", async () => {
  const html = require("node:fs").readFileSync(`${__dirname}/fixtures/roster-11.html`, "utf8");
  let teamReads = 0;
  const fetchPage = async (path) => {
    if (path.startsWith("/team/")) { teamReads += 1; return html; }
    return ["/profile/50100", "/profile/50101"].includes(path) ? '<a href="https://zwiftpower.com/profile.php?z=123">ZP</a>' : "";
  };
  const roster = await getRoster({ id: "501" }, { fetchPage });
  assert.equal(roster.riders.length, 10);
  assert.equal(roster.riders.filter((rider) => rider.zwiftId === 123).length, 1);
  assert.equal(roster.riders.filter((rider) => !rider.zwiftId).length, 9);
  await getRoster({ id: "501" }, { fetchPage });
  assert.equal(teamReads, 2);
  await assert.rejects(getRoster({ id: "501" }, { fetchPage: async (path) => path.startsWith("/team/") ? html : "" }), /Ingen ryttere.*Zwift-id/);
});
