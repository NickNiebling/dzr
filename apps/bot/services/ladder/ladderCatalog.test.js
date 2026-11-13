const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSummaryTeams, parseTeamInput, createTeamCatalog, CATALOG_TTL_MS } = require("./ladderCatalog");

function summary(teams) {
  return `<script>const defaultLadderData = ${JSON.stringify(teams.map((team) => ({ id: team.id, data: team })))}; const playonTeams = ${JSON.stringify(teams)};</script>`;
}

const teams = [{ id: 82, name: "Chonky Chaser" }, { id: 102, name: "Eagle Fang Rhinos" }, { id: 103, name: "Eagle Two" }];

test("summary reads both verified JSON lists without evaluating scripts and deduplicates by id", () => {
  const ranked = [{ id: 1, data: { id: 1, name: 'A " [team]' } }];
  const html = `<script>const defaultLadderData = ${JSON.stringify(ranked)}; const playonTeams = [{"id":1,"name":"old name"},{"id":2,"name":"B"}]; throw new Error('must not run');</script>`;
  const parsed = parseSummaryTeams(html);
  assert.equal(parsed.length, 2);
  assert.equal(parsed.find((team) => team.id === "1").name, 'A " [team]');
  assert.equal(parsed.find((team) => team.id === "2").url, "https://ladder.cycleracing.club/team/n/2");
  assert.throws(() => parseSummaryTeams("<form id='signin'></form>"), /ukendt format/);
  assert.throws(() => parseSummaryTeams("const playonTeams = [{broken];"), /JSON-format/);
  assert.throws(() => parseSummaryTeams(summary([{ id: 0, name: "No id" }])), /ugyldig/);
});

test("supports Ladder numeric, teamView and fixtures links and rejects other hosts and paths", () => {
  assert.deepEqual(parseTeamInput("https://ladder.cycleracing.club/team/n/9999"), { id: "9999", path: "/team/n/9999" });
  for (const path of ["teamView", "matchlist/fixtures"]) {
    assert.deepEqual(parseTeamInput(`https://ladder.cycleracing.club/${path}/Team%20%C3%86`), { name: "Team Æ", path: "/teamView/Team%20%C3%86" });
  }
  for (const input of ["https://example.com/team/n/82", "https://ladder.cycleracing.club.evil.test/team/n/82", "https://user:pass@ladder.cycleracing.club/team/n/82", "https://ladder.cycleracing.club/fixture/82", "https://ladder.cycleracing.club/team/n/0", "https://ladder.cycleracing.club/teamView/a%2fb", "https://ladder.cycleracing.club/teamView/%ZZ"]) {
    assert.throws(() => parseTeamInput(input));
  }
});

test("autocomplete only reads memory, shares startup refresh, caps 25 choices and expires at 15 minutes", async () => {
  let now = 100;
  let release;
  let calls = 0;
  const html = summary(Array.from({ length: 40 }, (_, index) => ({ id: index + 1, name: `Team ${index}` })));
  const catalog = createTeamCatalog({ now: () => now, fetchPage: async (path) => { assert.equal(path, "/summary"); calls += 1; return new Promise((resolve) => { release = () => resolve(html); }); } });
  assert.equal(catalog.warmCatalog(), undefined);
  assert.deepEqual(catalog.autocomplete("Team"), []);
  catalog.autocomplete("Team");
  await Promise.resolve();
  assert.equal(calls, 1);
  const refresh = catalog.refresh();
  release();
  await refresh;
  assert.equal(catalog.autocomplete("").length, 25);
  assert.equal(catalog.autocomplete("Team").length, 25);
  assert.equal(calls, 1);
  now += CATALOG_TTL_MS - 1;
  catalog.autocomplete("Team");
  assert.equal(calls, 1);
  now += 1;
  catalog.autocomplete("Team");
  catalog.autocomplete("Team");
  await Promise.resolve();
  assert.equal(calls, 2);
  const pending = catalog.refresh();
  release();
  await pending;
});

test("name lookup requires concrete selection for ambiguity and accepts exact or unique names", async () => {
  const catalog = createTeamCatalog({ fetchPage: async () => summary(teams) });
  assert.equal((await catalog.resolveTeam("chonky chaser")).id, "82");
  assert.equal((await catalog.resolveTeam("Fang")).id, "102");
  await assert.rejects(catalog.resolveTeam("Eagle"), /Flere.*konkret/);
  await assert.rejects(catalog.resolveTeam("missing"), /Intet Ladder-hold/);
  const duplicate = createTeamCatalog({ fetchPage: async () => summary([{ id: 1, name: "Same" }, { id: 2, name: "Same" }]) });
  await assert.rejects(duplicate.resolveTeam("Same"), /Flere/);
  assert.equal(duplicate.autocomplete("Same").length, 2);
});

test("numeric links validate the team page directly without a catalog match or summary dependency", async () => {
  const calls = [];
  const catalog = createTeamCatalog({ fetchPage: async (path) => { calls.push(path); return "team html"; }, readTeamPage: () => ({ id: "9999", name: "Unlisted team" }) });
  const team = await catalog.resolveTeam("https://ladder.cycleracing.club/team/n/9999");
  assert.equal(team.id, "9999");
  assert.deepEqual(calls, ["/team/n/9999"]);
  await assert.rejects(catalog.resolveTeam("/team/n/82"), /forventede/);
});

test("named team links validate on the actual page independently of summary", async () => {
  const calls = [];
  const catalog = createTeamCatalog({ fetchPage: async (path) => { calls.push(path); return "team html"; }, readTeamPage: () => ({ id: "50", name: "Team Æ" }) });
  for (const path of ["teamView", "matchlist/fixtures"]) {
    assert.equal((await catalog.resolveTeam(`https://ladder.cycleracing.club/${path}/Team%20%C3%86`)).id, "50");
  }
  assert.deepEqual(calls, ["/teamView/Team%20%C3%86", "/teamView/Team%20%C3%86"]);
});

test("failed background refresh retains stale entries and prevents autocomplete retry storms", async () => {
  let now = 100;
  let calls = 0;
  const catalog = createTeamCatalog({ now: () => now, warn: () => {}, fetchPage: async () => { calls += 1; if (calls > 1) throw new Error("down"); return summary(teams); } });
  await catalog.refresh();
  now += CATALOG_TTL_MS;
  assert.equal(catalog.autocomplete("Chonky").length, 1);
  await assert.rejects(catalog.refresh(), /down/);
  catalog.autocomplete("Chonky");
  await Promise.resolve();
  assert.equal(calls, 2);
});
