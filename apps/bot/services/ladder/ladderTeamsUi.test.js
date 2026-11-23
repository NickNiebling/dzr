const test = require("node:test");
const assert = require("node:assert/strict");
const { ButtonStyle, ComponentType, MessageFlags, PermissionsBitField } = require("discord.js");
const config = require("../../config/config");
const { handleLadderTeams, handleLadderTeamsButton } = require("../../handlers/ladderHandlers");
const ladderTeams = require("./ladderTeams");

const admin = {
  guildId: config.discord.guildId,
  memberPermissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator),
};

function components(payload) {
  assert.ok(payload.flags & MessageFlags.IsComponentsV2);
  assert.equal(payload.embeds, undefined);
  assert.equal(payload.content, undefined);
  return payload.components.map((component) => component.toJSON());
}

function countComponents(items) {
  return items.reduce((count, item) => count + 1
    + countComponents(item.components ?? [])
    + Number(Boolean(item.accessory)), 0);
}

test("regular members cannot view or remove Ladder teams", async (t) => {
  const list = t.mock.method(ladderTeams, "list", async () => []);
  const unlink = t.mock.method(ladderTeams, "unlink", async () => true);
  const member = { ...admin, memberPermissions: new PermissionsBitField() };
  const replies = [];
  const reply = async (payload) => replies.push(payload);

  await handleLadderTeams({ ...member, editReply: reply });
  for (const action of ["remove", "confirm"]) {
    await handleLadderTeamsButton({ ...member, customId: `ladder_team:${action}:test`, reply });
  }

  assert.equal(replies.length, 3);
  for (const payload of replies) assert.match(components(payload)[0].content, /Kun administratorer/);
  assert.equal(list.mock.callCount(), 0);
  assert.equal(unlink.mock.callCount(), 0);
});

test("the overview shows a linked team and lets an admin cancel or confirm removal", async (t) => {
  let teams = [{ name: "Chonky Chaser", channelId: "123", optaktMin: 90 }];
  t.mock.method(ladderTeams, "list", async () => teams);
  const unlink = t.mock.method(ladderTeams, "unlink", async (name) => {
    teams = teams.filter((team) => team.name !== name);
    return true;
  });
  let reply;
  const editReply = async (payload) => { reply = payload; };
  const click = (customId) => handleLadderTeamsButton({
    ...admin, customId, deferUpdate: async () => {}, editReply,
  });

  await handleLadderTeams({ ...admin, editReply });
  const overview = components(reply);
  assert.equal(overview.length, 1);
  const [header, team] = overview[0].components;
  assert.equal(overview[0].components.length, 2);
  assert.match(header.content, /Tilknyttede Ladder-hold/);
  assert.ok(header.content.includes(`<#${config.ladder.channelId}>`));
  assert.ok(header.content.includes(`${config.ladder.optaktMin} min`));
  assert.ok(header.content.includes(config.ladder.tz));
  assert.equal(team.type, ComponentType.Section);
  const [details] = team.components;
  assert.equal(details.type, ComponentType.TextDisplay);
  assert.match(details.content, /Chonky Chaser.*<#123>.*90 min/s);
  assert.match(details.content, /\[Holdside\].*https:\/\/ladder\.cycleracing\.club\/teamView\/Chonky%20Chaser/);
  assert.match(details.content, /\[Kampe\].*https:\/\/ladder\.cycleracing\.club\/matchlist\/fixtures\/Chonky%20Chaser/);
  assert.equal(team.accessory.style, ButtonStyle.Danger);
  assert.match(team.accessory.custom_id, /^ladder_team:remove:/);

  await click(team.accessory.custom_id);
  const [prompt, row] = components(reply);
  assert.match(prompt.content, /Fjern Chonky Chaser/);
  const [confirm, cancel] = row.components;
  assert.deepEqual(row.components.map((button) => button.label), ["Fjern hold", "Annuller"]);
  assert.equal(confirm.custom_id, team.accessory.custom_id.replace(":remove:", ":confirm:"));
  assert.equal(cancel.custom_id, "ladder_team:cancel");

  await click(cancel.custom_id);
  const [, ...restoredTeams] = components(reply)[0].components;
  assert.equal(restoredTeams.length, 1);
  assert.equal(restoredTeams[0].accessory.custom_id, team.accessory.custom_id);
  assert.equal(unlink.mock.callCount(), 0);

  await click(team.accessory.custom_id);
  await click(confirm.custom_id);
  assert.deepEqual(unlink.mock.calls.map((call) => call.arguments), [["Chonky Chaser"]]);
  const [empty] = components(reply);
  assert.equal(empty.components.length, 1);
  assert.match(empty.components[0].content, /ingen tilknyttede Ladder-hold.*\/ladder_link/);
});

test("ten teams fit within Discord's component limit and retain alphabetical order", async (t) => {
  const names = ["Alfa", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Zulu", "Ægir", "Ørn"]
    .map((name) => `${name} ${"Æøå".repeat(14)}`);
  t.mock.method(ladderTeams, "list", async () => names.toReversed().map((name) => ({ name })));
  const editReply = t.mock.fn();

  await handleLadderTeams({ ...admin, editReply });

  const overview = components(editReply.mock.calls[0].arguments[0]);
  const [header, ...teams] = overview[0].components;
  const listedNames = teams.map((team) => team.components[0].content.split("\n")[0].replace(/^#+\s*/, ""));
  assert.deepEqual(listedNames, names);
  assert.ok(teams[0].components[0].content.includes(`<#${config.ladder.channelId}> (standard)`));
  assert.ok(countComponents(overview) <= 40);
  const text = [header, ...teams.flatMap((team) => team.components)];
  assert.ok(text.reduce((length, item) => length + item.content.length, 0) <= 4000);
});

test("Ladder teams errors are displayed as V2 text", async (t) => {
  t.mock.method(ladderTeams, "list", async () => { throw new Error("Ladder lookup failed"); });
  t.mock.method(console, "error", () => {});
  const editReply = t.mock.fn();

  await handleLadderTeams({ ...admin, editReply });

  assert.match(components(editReply.mock.calls[0].arguments[0])[0].content, /Der skete en fejl/);
});
