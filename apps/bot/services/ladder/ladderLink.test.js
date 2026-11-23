const test = require("node:test");
const assert = require("node:assert/strict");
const { PermissionsBitField } = require("discord.js");
const config = require("../../config/config");
const { handleLadderLink } = require("../../handlers/ladderHandlers");
const ladderTeams = require("./ladderTeams");

const firebasePath = require.resolve("../firebase");
const fakeDb = {
  collection: () => ({ doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }) }),
};
require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: { db: fakeDb } };

async function runLink(teamName, channelId, {
  guildId = config.discord.guildId, parentId, minutes = null, remove = false, admin = false,
} = {}) {
  let reply;
  await handleLadderLink({
    guildId,
    memberPermissions: new PermissionsBitField(admin ? PermissionsBitField.Flags.Administrator : 0n),
    channelId,
    channel: { id: channelId, parentId, isThread: () => Boolean(parentId) },
    options: {
      getString: () => teamName,
      getBoolean: () => remove,
      getInteger: () => minutes,
    },
    editReply: async (payload) => { reply = payload; },
  });
  return reply.content;
}

test("a member can link a new team with an optakt time from a thread", async () => {
  const teamName = "Chonky Chaser";
  const threadId = "100000000000000000";
  const parentId = "200000000000000000";

  const reply = await runLink(teamName, threadId, { parentId, minutes: 45 });

  assert.deepEqual(await ladderTeams.findByChannel(parentId), { name: teamName, channelId: parentId, optaktMin: 45 });
  assert.equal(await ladderTeams.findByChannel(threadId), null);
  assert.match(reply, /Chonky Chaser er tilknyttet <#200000000000000000>\./);
  assert.match(reply, /Optakt: 45 min før start\./);
});

test("a member can confirm an existing link but cannot change or remove it", async () => {
  const teamName = "Chonky Complainers";
  const channelId = "300000000000000000";
  const otherChannelId = "400000000000000000";
  await ladderTeams.link(teamName, channelId, 45);

  for (const minutes of [null, 45]) {
    assert.match(await runLink(teamName, channelId, { minutes }), /Optakt: 45 min før start\./);
  }
  assert.match(await runLink(teamName, otherChannelId), /administrator/i);
  assert.match(await runLink(teamName, channelId, { minutes: 30 }), /administrator/i);
  assert.match(await runLink(teamName, channelId, { remove: true }), /administrator/i);

  assert.deepEqual(await ladderTeams.getTeam(teamName), { name: teamName, channelId, optaktMin: 45 });
  assert.equal(await ladderTeams.findByChannel(otherChannelId), null);
});

test("a member cannot take another team's channel, even with simultaneous new links", async () => {
  const channelId = "500000000000000000";
  const names = ["Chonky Leg Breakers", "A whole lot of Danes"];
  const replies = await Promise.all(names.map((name) => runLink(name, channelId)));
  const linked = await ladderTeams.findByChannel(channelId);
  assert.ok(names.includes(linked?.name));

  const linkedIndex = names.indexOf(linked.name);
  const rejectedIndex = 1 - linkedIndex;
  assert.match(replies[linkedIndex], /✅/);
  assert.match(replies[rejectedIndex], /allerede tilknyttet/i);
  assert.equal(await ladderTeams.getTeam(names[rejectedIndex]), null);

  assert.match(await runLink("DZR", channelId), /allerede tilknyttet/i);
  assert.equal(await ladderTeams.getTeam("DZR"), null);
  assert.deepEqual(await ladderTeams.findByChannel(channelId), linked);
});

test("an admin can change a link and its optakt time, then remove the team", async () => {
  const teamName = "DZR Racing";
  const previousChannel = "600000000000000000";
  const channelId = "700000000000000000";
  await ladderTeams.link(teamName, previousChannel, 45);
  await ladderTeams.link("DZR Racing 2", channelId);

  const update = await runLink(teamName, channelId, { admin: true, minutes: 90 });
  assert.match(update, /Optakt: 90 min før start\./);
  assert.deepEqual(await ladderTeams.findByChannel(channelId), { name: teamName, channelId, optaktMin: 90 });
  assert.equal(await ladderTeams.findByChannel(previousChannel), null);
  assert.equal((await ladderTeams.getTeam("DZR Racing 2")).channelId, undefined);

  assert.match(await runLink(teamName, channelId, { admin: true, remove: true }), /er fjernet/);
  assert.equal(await ladderTeams.getTeam(teamName), null);
  assert.equal(await ladderTeams.findByChannel(channelId), null);
});

test("ladder_link is unavailable outside the configured guild", async () => {
  const channelId = "800000000000000000";
  const teamName = "Outside team";

  assert.match(await runLink(teamName, channelId, { guildId: "900000000000000000", admin: true }), /DZR-serveren/i);
  assert.match(await runLink(teamName, channelId, { guildId: null }), /DZR-serveren/i);
  assert.equal(await ladderTeams.getTeam(teamName), null);
});
