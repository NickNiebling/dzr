const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { updateKnownTeams } = require("../../scripts/update-ladder-teams");

test("explicit catalog update writes verified public identities and provenance", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ladder-teams-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, "knownTeams.json");
  const html = await fs.readFile(path.join(__dirname, "fixtures/summary-teams.html"), "utf8");
  const snapshot = await updateKnownTeams({ load: async () => html, outputPath, now: new Date("2026-11-17T12:00:00Z") });
  assert.deepEqual(JSON.parse(await fs.readFile(outputPath, "utf8")), snapshot);
  assert.equal(snapshot.source, "https://ladder.cycleracing.club/summary");
  assert.equal(snapshot.updatedAt, "2026-11-17T12:00:00.000Z");
  assert.deepEqual(snapshot.teams, [
    { id: "655", name: "Bredden" }, { id: "91", name: "Chonky Complainers" }, { id: "746", name: "PTA2" },
  ]);
  assert.deepEqual(await fs.readdir(directory), ["knownTeams.json"]);
});

test("failed or unrecognized catalog updates preserve the previous snapshot", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ladder-teams-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, "knownTeams.json");
  const previous = '{"teams":[{"id":"655","name":"Bredden"}]}\n';
  await fs.writeFile(outputPath, previous, "utf8");
  const html = await fs.readFile(path.join(__dirname, "fixtures/summary-teams.html"), "utf8");
  const cases = [
    async () => { throw new Error("HTTP 502"); },
    async () => '<form id="signin"></form>',
    async () => html.replace('data-team-id="746">PTA2', 'data-team-id="91">Wrong name'),
  ];
  for (const load of cases) {
    await assert.rejects(updateKnownTeams({ load, outputPath }));
    assert.equal(await fs.readFile(outputPath, "utf8"), previous);
    assert.deepEqual(await fs.readdir(directory), ["knownTeams.json"]);
  }
});
