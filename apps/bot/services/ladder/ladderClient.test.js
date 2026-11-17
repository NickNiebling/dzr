const test = require("node:test");
const assert = require("node:assert/strict");
const { refreshSignups, refreshFixture, describeFailure, getFixtureStart, getRoster, autocomplete, resolveTeam } = require("./ladderClient");

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

test("scout suggestions and known names work immediately without a content API call", async (t) => {
  const axios = require("axios");
  const request = t.mock.method(axios, "get", async () => { throw new Error("Content API unavailable"); });
  const suggestions = autocomplete("");
  assert.equal(suggestions.length, 25);
  assert.deepEqual(suggestions.map((team) => team.name), [...suggestions.map((team) => team.name)].sort((a, b) => a.localeCompare(b, "da")));
  assert.deepEqual(autocomplete("  Ｂｒｅｄｄｅｎ  "), [{
    name: "Bredden (#655)", value: "https://ladder.cycleracing.club/team/n/655",
  }]);
  assert.equal((await resolveTeam("bredden")).id, "655");
  assert.equal((await resolveTeam("Complainers")).id, "91");
  assert.equal((await resolveTeam("  Chonky Complainers  ")).id, "91");
  for (const path of ["teamView/Chonky%20Complainers", "matchlist/fixtures/Chonky%20Complainers", "team/n/91"]) {
    assert.equal((await resolveTeam(`https://ladder.cycleracing.club/${path}`)).id, "91");
  }
  assert.deepEqual(autocomplete("https://ladder.cycleracing.club/team/n/655"), autocomplete("Bredden"));
  await assert.rejects(resolveTeam("Chonky"), /Flere Ladder-hold/);
  await assert.rejects(resolveTeam("No such Ladder team"), /Intet Ladder-hold/);
  await assert.rejects(resolveTeam("https://example.com/team/n/91"), /ladder.cycleracing.club/);
  assert.deepEqual(autocomplete("https://example.com/team/n/91"), []);
  assert.equal(request.mock.callCount(), 0);
});

test("the checked-in catalog includes ranked and fixture-only teams with verified identities", () => {
  const snapshot = require("./knownTeams.json");
  assert.equal(snapshot.source, "https://ladder.cycleracing.club/summary");
  assert.ok(Number.isFinite(Date.parse(snapshot.updatedAt)));
  assert.ok(snapshot.teams.length > 200);
  assert.equal(new Set(snapshot.teams.map((team) => team.id)).size, snapshot.teams.length);
  for (const team of snapshot.teams) {
    assert.match(team.id, /^[1-9]\d*$/);
    assert.ok(Number.isSafeInteger(Number(team.id)));
    assert.ok(team.name && team.name === team.name.trim());
  }
  for (const [name, id] of [["Bredden", "655"], ["Chonky Complainers", "91"], ["PTA2", "746"], ["SISU Kilpikonna", "695"], ["5W4T-Rocket", "602"], ["Pacific Draft", "745"]]) {
    assert.ok(snapshot.teams.some((team) => team.name === name && team.id === id));
  }
});

test("unlisted numeric links still validate the live roster identity", async (t) => {
  const axios = require("axios");
  const config = require("../../config/config");
  const original = config.contentApi;
  config.contentApi = { baseUrl: "http://localhost", apiKey: "test" };
  t.after(() => { config.contentApi = original; });
  const unlisted = require("node:fs").readFileSync(`${__dirname}/fixtures/roster-10.html`, "utf8")
    .replace("const TEAMID = 502;", "const TEAMID = 999998;")
    .replaceAll('"LadderTeam":502', '"LadderTeam":999998');
  const teamReads = [];
  t.mock.method(axios, "get", async (_url, { params }) => {
    teamReads.push(params.path);
    return { data: unlisted };
  });
  assert.equal((await resolveTeam("https://ladder.cycleracing.club/team/n/999998")).id, "999998");
  assert.deepEqual(teamReads, ["/team/n/999998"]);
  await assert.rejects(resolveTeam("/team/n/999"), /forventede/);
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
