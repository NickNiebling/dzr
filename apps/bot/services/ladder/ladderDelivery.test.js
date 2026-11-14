const test = require("node:test");
const assert = require("node:assert/strict");

// Keep real scheduler/store behavior, replacing only rendering, profile I/O and Firestore.
const docs = new Map([["ladder_bot/state", { json: JSON.stringify({ postedLadderPreview: ["42"], postedLadderDayReminder: ["42"] }) }]]);
function fakeModule(path, exports) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
fakeModule("../firebase", { db: { collection: (c) => ({ doc: (d) => ({
  get: async () => ({ exists: docs.has(`${c}/${d}`), data: () => docs.get(`${c}/${d}`) }),
  set: async (value) => docs.set(`${c}/${d}`, value),
}) }) } });
fakeModule("./ladderEmbed", {
  accentColor: () => 0xff6600,
  buildLadderPreviewMessage: async (fixture, team) => ({ content: `Preview ${fixture.id} for ${team}` }),
});
fakeModule("./routeInfo", { describeProfile: () => null, loadMatchProfile: async () => null });

const ladderClient = require("./ladderClient");
const ladderTeams = require("./ladderTeams");
const { maybeRunLadderJobs } = require("./ladderJobs");

test("automatic posts reach each team's primary channel once, including an internal match", async (t) => {
  const home = { name: "Chonky Chaser", channelId: "home-channel" };
  const away = { name: "A whole lot of Danes", channelId: "away-channel" };
  const orphan = { name: "Legacy team" };
  const fixture = { id: "42", start: "2026-11-14T18:00:00Z", home: { name: home.name, riders: [] }, away: { name: away.name, riders: [] } };
  const fetched = [], sent = [], listed = [];
  const client = { channels: { fetch: async (id) => {
    fetched.push(id);
    return { send: async (message) => sent.push({ id, message }) };
  } } };
  t.mock.method(ladderTeams, "list", async () => [home, away, orphan]);
  t.mock.method(ladderClient, "getFixtures", async (name) => { listed.push(name); return [{ id: fixture.id }]; });
  t.mock.method(ladderClient, "getFixtureStart", async () => fixture.start);
  t.mock.method(ladderClient, "getFixture", async () => fixture);
  t.mock.method(ladderClient, "refreshFixture", async (value) => value);
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(message));

  await maybeRunLadderJobs(client, new Date("2026-11-14T17:00:00Z"));
  assert.deepEqual(fetched, [home.channelId, away.channelId]);
  assert.deepEqual(listed, [home.name, away.name]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Legacy team.*no primary channel/);
  assert.equal(sent.length, 4);
  for (const team of [home, away]) {
    const messages = sent.filter(({ id }) => id === team.channelId).map(({ message }) => message);
    assert.match(messages[0].embeds[0].toJSON().title, /^Løbsdag:/);
    assert.equal(messages[1].content, `Preview 42 for ${team.name}`);
  }

  await maybeRunLadderJobs(client, new Date("2026-11-14T17:10:00Z"));
  assert.equal(sent.length, 4, "Repeated ticks must not duplicate either team's posts");

  // Simulate a restart: read the persisted state using fresh modules and throttle state.
  delete require.cache[require.resolve("./ladderState")];
  delete require.cache[require.resolve("./ladderJobs")];
  await require("./ladderJobs").maybeRunLadderJobs(client, new Date("2026-11-14T17:20:00Z"));
  assert.equal(sent.length, 4, "Restart must preserve each team's posted state");
});

test("a failed send is retried without marking the preview as posted", async (t) => {
  t.mock.method(ladderTeams, "list", async () => [{ name: "Retry team", channelId: "retry-channel" }]);
  t.mock.method(ladderClient, "getFixtures", async () => [{ id: "99" }]);
  t.mock.method(ladderClient, "getFixtureStart", async () => "2026-11-15T09:00:00Z");
  t.mock.method(ladderClient, "getFixture", async () => ({ id: "99" }));
  t.mock.method(ladderClient, "refreshFixture", async (value) => value);
  t.mock.method(console, "error", () => {});
  let attempts = 0;
  const client = { channels: { fetch: async () => ({ send: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Discord temporarily unavailable");
  } }) } };
  await maybeRunLadderJobs(client, new Date("2026-11-15T08:00:00Z"));
  await maybeRunLadderJobs(client, new Date("2026-11-15T08:10:00Z"));
  await maybeRunLadderJobs(client, new Date("2026-11-15T08:20:00Z"));
  assert.equal(attempts, 2);
});
