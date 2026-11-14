const test = require("node:test");
const assert = require("node:assert/strict");

// Fake Firestore so the stores work without credentials (services/firebase.js throws without them).
const docs = new Map();
const fakeDb = {
  collection: (c) => ({
    doc: (d) => ({
      get: async () => ({ exists: docs.has(`${c}/${d}`), data: () => docs.get(`${c}/${d}`) }),
      set: async (v) => {
        docs.set(`${c}/${d}`, v);
      },
    }),
  }),
};
const firebasePath = require.resolve("../firebase");
require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: { db: fakeDb } };

const ladderTeams = require("./ladderTeams");

test("a team linked from a channel is found by that channel", async () => {
  assert.equal(await ladderTeams.link("A whole lot of Danes", "111"), true);
  assert.equal((await ladderTeams.findByChannel("111")).name, "A whole lot of Danes");
  assert.equal(await ladderTeams.findByChannel("222"), null);
});

test("another team cannot take the channel away from an existing team", async () => {
  await assert.rejects(ladderTeams.link("Chonky Chaser", "111"), (error) => /allerede primær kanal/.test(error.userMessage));
  assert.equal((await ladderTeams.findByChannel("111")).name, "A whole lot of Danes");
  assert.equal(await ladderTeams.getTeam("Chonky Chaser"), null);
  await ladderTeams.link("Chonky Chaser", "222");
});

test("linking the same team again keeps one entry, whatever the spelling", async () => {
  await ladderTeams.setPreviewMinutes("A whole lot of Danes", 90);
  await ladderTeams.link("A WHOLE LOT OF DANES", "333");
  const names = (await ladderTeams.list()).map((t) => t.name);
  assert.equal(names.filter((n) => n.toLowerCase() === "a whole lot of danes").length, 1);
  assert.equal((await ladderTeams.findByChannel("333")).name, "A WHOLE LOT OF DANES");
  assert.equal((await ladderTeams.getTeam("A whole lot of Danes")).previewMinutes, 90);
  assert.equal(await ladderTeams.findByChannel("111"), null);
  const persisted = JSON.parse(docs.get("ladder_bot/ladderTeams").json);
  assert.equal(persisted["a whole lot of danes"].channelId, "333");
});

test("every link requires a name and a primary channel, even for an existing team", async () => {
  for (const channel of [undefined, null, "", "  "]) {
    await assert.rejects(ladderTeams.link("Chonky Chaser", channel), /primary channel/);
  }
  await assert.rejects(ladderTeams.link("  ", "444"), /team name/);
  assert.equal((await ladderTeams.getTeam("Chonky Chaser")).channelId, "222");
});

test("removing a team removes its channel default", async () => {
  assert.equal(await ladderTeams.unlink("a whole lot of danes"), true);
  assert.equal(await ladderTeams.findByChannel("333"), null);
});

test("the team limit stops new teams but not existing ones", async () => {
  for (let i = 0; i < ladderTeams.MAX_TEAMS; i += 1) await ladderTeams.link(`Team ${i}`, `channel-${i}`);
  assert.equal(await ladderTeams.link("One too many", "extra-channel"), false);
  assert.equal(await ladderTeams.link("Team 0", "moved-channel"), true);
  assert.ok((await ladderTeams.list()).every((team) => team.channelId));
});
