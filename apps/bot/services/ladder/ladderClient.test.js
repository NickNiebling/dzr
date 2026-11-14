const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveTeamName, refreshSignups, refreshFixture, describeFailure, getFixtureStart } = require("./ladderClient");

const MIN = 60 * 1000;

test("plain team names remain accepted without a lookup", async () => {
  assert.equal(await resolveTeamName("  Chonky Chaser ", { fetchPage: () => assert.fail("No URL to look up") }), "Chonky Chaser");
});

test("team and fixtures URLs fetch the team's canonical name before it is used", async () => {
  for (const url of [
    "https://ladder.cycleracing.club/teamView/chonky%20chaser",
    "https://ladder.cycleracing.club/matchlist/fixtures/chonky%20chaser?x=1#top",
    "https://ladder.cycleracing.club/teamView/chonky%20chaser/",
  ]) {
    const calls = [];
    const name = await resolveTeamName(url, { fetchPage: async (path) => {
      calls.push(path);
      return '<script>const TEAMID = 82;</script><a href="/matchlist/fixtures/Chonky Chaser">Fixtures</a>';
    } });
    assert.equal(name, "Chonky Chaser");
    assert.deepEqual(calls, ["/teamView/chonky%20chaser"]);
  }
});

test("invalid or foreign URLs are rejected before a page is fetched", async () => {
  for (const url of [
    "https://example.com/teamView/Chonky",
    "https://ladder.cycleracing.club.evil.test/teamView/Chonky",
    "https://ladder.cycleracing.club/fixture/123",
    "https://ladder.cycleracing.club/teamView/",
    "https://ladder.cycleracing.club/teamView/bad%ZZ",
    "https://ladder.cycleracing.club/teamView/a%2Fb",
    "https://user:password@ladder.cycleracing.club/teamView/Chonky",
    "ftp://ladder.cycleracing.club/teamView/Chonky",
    "https://[bad-url",
  ]) {
    await assert.rejects(resolveTeamName(url, { fetchPage: () => assert.fail("Invalid URL must not be fetched") }),
      (error) => /Brug et hold-link/.test(error.userMessage));
  }
});

test("HTTP 200 error/login pages do not turn the URL text into a saved name", async () => {
  for (const html of ['<title>404</title>', '<title>Sign-in</title><form id="signin"></form>', '<script>const TEAMID = 82;</script>']) {
    await assert.rejects(resolveTeamName("https://ladder.cycleracing.club/teamView/Unknown", { fetchPage: async () => html }),
      (error) => /Holdet er ikke linket/.test(error.userMessage));
  }
});

test("a failed lookup propagates the API error instead of falling back to URL text", async () => {
  const failure = Object.assign(new Error("502"), { userMessage: "Ladder-siden kunne ikke hentes lige nu." });
  await assert.rejects(resolveTeamName("https://ladder.cycleracing.club/teamView/Chonky", { fetchPage: async () => { throw failure; } }),
    (error) => error === failure);
});

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
