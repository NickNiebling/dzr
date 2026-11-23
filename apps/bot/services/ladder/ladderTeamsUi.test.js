const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags, PermissionsBitField } = require("discord.js");
const config = require("../../config/config");
const ladderTeams = require("./ladderTeams");

const firebasePath = require.resolve("../firebase");
require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: {} };
const { handleInteractions } = require("../../handlers/interactionHandler");

const admin = {
  guildId: config.discord.guildId,
  memberPermissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator),
};

test("a regular member cannot open or confirm a Ladder team removal", async (t) => {
  const list = t.mock.method(ladderTeams, "list", async () => []);
  const unlink = t.mock.method(ladderTeams, "unlink", async () => true);
  const replies = [];

  for (const action of ["remove", "confirm"]) {
    const interaction = {
      guildId: config.discord.guildId,
      memberPermissions: new PermissionsBitField(),
      isButton: () => true,
      isCommand: () => false,
      customId: `ladder_team:${action}:test`,
      reply: async (payload) => replies.push(payload),
    };
    await handleInteractions(interaction);
  }

  assert.equal(list.mock.callCount(), 0);
  assert.equal(unlink.mock.callCount(), 0);
  assert.equal(replies.length, 2);
  for (const reply of replies) {
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    assert.match(reply.content, /Kun administratorer/);
  }
});

test("an admin can confirm a Ladder team removal and return to the updated overview", async (t) => {
  let teams = [
    { name: "Chonky Chaser", channelId: "123", optaktMin: 90 },
    { name: "A whole lot of Danes" },
    { name: "Chonky Complainers" },
    { name: "Chonky Leg Breakers" },
    { name: "DZR" },
    { name: "DZR 2" },
  ];
  t.mock.method(ladderTeams, "list", async () => [...teams]);
  const unlink = t.mock.method(ladderTeams, "unlink", async (name) => {
    teams = teams.filter((team) => team.name !== name);
    return true;
  });

  let reply;
  const editReply = async (payload) => { reply = payload; };
  const click = (customId) => handleInteractions({
    ...admin,
    customId,
    isButton: () => true,
    isCommand: () => false,
    deferUpdate: async () => {},
    editReply,
  });
  const initialReplies = [];
  await handleInteractions({
    ...admin,
    commandName: "ladder_teams",
    isButton: () => false,
    isCommand: () => true,
    isAutocomplete: () => false,
    isStringSelectMenu: () => false,
    reply: async (payload) => initialReplies.push(payload),
    editReply,
  });

  assert.equal(initialReplies[0].flags, MessageFlags.Ephemeral);
  const overview = reply.embeds[0].toJSON();
  assert.equal(overview.title, "Tilknyttede Ladder-hold");
  assert.match(overview.fields.find((field) => field.name === "Chonky Chaser").value, /Kanal: <#123>\nOptakt: 90 min før start\n\[Holdside\].* · \[Kampe\]/);
  assert.ok(overview.fields.find((field) => field.name === "A whole lot of Danes").value.startsWith(
    `Kanal: <#${config.ladder.channelId}> (standard)\nOptakt: ${config.ladder.optaktMin} min før start`,
  ));
  assert.deepEqual(reply.components.map((row) => row.toJSON().components.length), [5, 1]);
  const remove = reply.components[0].toJSON().components.find((button) => button.label === "Chonky Chaser");
  assert.equal(remove.emoji.name, "❌");

  await click(remove.custom_id);
  assert.equal(reply.content, "Fjern Chonky Chaser?");
  assert.deepEqual(reply.embeds, []);
  const [confirm, cancel] = reply.components[0].toJSON().components;
  assert.deepEqual([confirm.label, cancel.label], ["Fjern hold", "Annuller"]);
  assert.equal(unlink.mock.callCount(), 0);

  await click(cancel.custom_id);
  assert.equal(unlink.mock.callCount(), 0);
  assert.equal(reply.embeds[0].toJSON().fields.length, 6);

  await click(remove.custom_id);
  await click(confirm.custom_id);
  assert.equal(unlink.mock.callCount(), 1);
  assert.deepEqual(unlink.mock.calls[0].arguments, ["Chonky Chaser"]);
  assert.ok(!reply.embeds[0].toJSON().fields.some((field) => field.name === "Chonky Chaser"));
  assert.deepEqual(reply.components.map((row) => row.toJSON().components.length), [5]);
});
