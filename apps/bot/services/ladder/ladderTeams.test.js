const test = require("node:test");
const assert = require("node:assert/strict");

// Fake Firestore so the stores work without credentials (services/firebase.js throws without them).
const docs = new Map();
const teamDoc = "ladder_bot/ladderTeams";
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
  docs.set(teamDoc, {
    json: JSON.stringify({
      "a whole lot of danes": { name: "A whole lot of Danes", channelId: "444", previewMinutes: 55 },
    }),
  });
  assert.equal((await ladderTeams.link("A whole lot of Danes", "111", null, true)).team.channelId, "111");
  assert.deepEqual(await ladderTeams.findByChannel("111"), { name: "A whole lot of Danes", channelId: "111", optaktMin: 55 });
  assert.equal(await ladderTeams.findByChannel("222"), null);
});

test("an admin can move a channel's link to another team", async () => {
  await ladderTeams.link("Chonky Chaser", "111", null, true);
  assert.equal((await ladderTeams.findByChannel("111")).name, "Chonky Chaser");
  assert.equal((await ladderTeams.getTeam("A whole lot of Danes")).channelId, undefined);
});

test("linking the same team again keeps one entry, whatever the spelling", async () => {
  await ladderTeams.link("A WHOLE LOT OF DANES", "333", 75, true);
  const names = (await ladderTeams.list()).map((t) => t.name);
  assert.equal(names.filter((n) => n.toLowerCase() === "a whole lot of danes").length, 1);
  assert.deepEqual(await ladderTeams.findByChannel("333"), { name: "A WHOLE LOT OF DANES", channelId: "333", optaktMin: 75 });

  await new Promise(setImmediate);
  const savedTeams = JSON.parse(docs.get(teamDoc).json);
  assert.deepEqual(savedTeams["a whole lot of danes"], { name: "A WHOLE LOT OF DANES", channelId: "333", previewMinutes: 75 });
});

test("removing a team removes its channel default", async () => {
  assert.equal(await ladderTeams.unlink("a whole lot of danes"), true);
  assert.equal(await ladderTeams.findByChannel("333"), null);
});

test("the team limit stops new teams but not existing ones", async () => {
  for (let i = 0; i < ladderTeams.MAX_TEAMS; i += 1) await ladderTeams.link(`Team ${i}`);
  assert.equal((await ladderTeams.link("One too many")).error, "team_limit");
  assert.equal((await ladderTeams.link("Team 0")).team.name, "Team 0");
});
