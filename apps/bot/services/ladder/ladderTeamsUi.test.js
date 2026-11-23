const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { ButtonStyle, ComponentType, InteractionWebhook, MessageFlags, PermissionsBitField } = require("discord.js");
const config = require("../../config/config");
const { handleLadderTeams, handleLadderTeamsButton } = require("../../handlers/ladderHandlers");
const ladderTeams = require("./ladderTeams");

const admin = {
  guildId: config.discord.guildId,
  memberPermissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator),
};

function serializeV2(payload, flags = MessageFlags.IsComponentsV2) {
  assert.equal(payload.flags, flags);
  assert.equal(payload.content, undefined);
  assert.equal(payload.embeds, undefined);
  return payload.components.map((component) => component.toJSON());
}

function overviewSections(payload) {
  const components = serializeV2(payload);
  assert.equal(components.length, 1);
  assert.equal(components[0].type, ComponentType.Container);
  const [header, ...sections] = components[0].components;
  assert.equal(header.type, ComponentType.TextDisplay);
  assert.match(header.content, /Tilknyttede Ladder-hold/);
  assert.match(header.content, /Standardkonfiguration/);
  assert.ok(header.content.includes(`<#${config.ladder.channelId}>`));
  assert.ok(header.content.includes(`${config.ladder.optaktMin} min før start`));
  assert.ok(header.content.includes(config.ladder.tz));

  for (const section of sections) {
    assert.equal(section.type, ComponentType.Section);
    assert.deepEqual(section.components.map((component) => component.type), [ComponentType.TextDisplay]);
    assert.equal(section.accessory.type, ComponentType.Button);
    assert.equal(section.accessory.style, ButtonStyle.Danger);
    assert.equal(section.accessory.emoji.name, "🗑️");
    assert.equal(section.accessory.label, undefined);
  }
  const textDisplays = [header, ...sections.flatMap((section) => section.components)];
  assert.ok(textDisplays.reduce((length, display) => length + display.content.length, 0) <= 4000);
  return { header, sections };
}

function countComponents(components) {
  return components.reduce((total, component) => total + 1
    + countComponents(component.components ?? [])
    + Number(Boolean(component.accessory)), 0);
}

test("Ladder team management requires administrator permissions on the DZR server", async (t) => {
  const list = t.mock.method(ladderTeams, "list", async () => []);
  const unlink = t.mock.method(ladderTeams, "unlink", async () => true);
  const commandReplies = [];
  const buttonReplies = [];

  for (const interaction of [
    { ...admin, memberPermissions: new PermissionsBitField() },
    { ...admin, guildId: "another-guild" },
  ]) {
    await handleLadderTeams({
      ...interaction,
      deferReply: async (payload) => assert.equal(payload.flags, MessageFlags.Ephemeral),
      editReply: async (payload) => commandReplies.push(payload),
    });
    for (const action of ["remove", "confirm", "cancel"]) {
      await handleLadderTeamsButton({
        ...interaction,
        customId: `ladder_team:${action}:test`,
        reply: async (payload) => buttonReplies.push(payload),
      });
    }
  }

  assert.equal(list.mock.callCount(), 0);
  assert.equal(unlink.mock.callCount(), 0);
  assert.equal(commandReplies.length, 2);
  assert.equal(buttonReplies.length, 6);
  for (const reply of commandReplies) {
    const [message] = serializeV2(reply);
    assert.equal(message.type, ComponentType.TextDisplay);
    assert.match(message.content, /Kun administratorer/);
  }
  for (const reply of buttonReplies) {
    const [message] = serializeV2(reply, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
    assert.equal(message.type, ComponentType.TextDisplay);
    assert.match(message.content, /Kun administratorer/);
  }
});

test("an admin can cancel or confirm removal and return to the Ladder teams overview", async (t) => {
  let teams = [
    { name: "Chonky Chaser", channelId: "123", optaktMin: 90 },
    { name: "A whole lot of Danes" },
  ];
  t.mock.method(ladderTeams, "list", async () => [...teams]);
  const unlink = t.mock.method(ladderTeams, "unlink", async (name) => {
    teams = teams.filter((team) => team.name !== name);
    return true;
  });

  let reply;
  const editReply = async (payload) => { reply = payload; };
  const click = (customId) => handleLadderTeamsButton({
    ...admin,
    customId,
    message: { content: "", embeds: [] },
    deferUpdate: async () => {},
    editReply,
  });
  const deferReply = t.mock.fn();
  await handleLadderTeams({ ...admin, deferReply, editReply });
  assert.deepEqual(deferReply.mock.calls[0].arguments, [{ flags: MessageFlags.Ephemeral }]);

  const { sections } = overviewSections(reply);
  assert.equal(sections.length, 2);
  const [defaultTeam, customTeam] = sections;
  assert.match(defaultTeam.components[0].content, /^### A whole lot of Danes\n/);
  assert.ok(defaultTeam.components[0].content.includes(
    `<#${config.ladder.channelId}> (standard) · ${config.ladder.optaktMin} min før start`,
  ));
  assert.match(customTeam.components[0].content, /^### Chonky Chaser\n<#123> · 90 min før start\n/);
  assert.ok(customTeam.components[0].content.includes([
    "[Holdside](<https://ladder.cycleracing.club/teamView/Chonky%20Chaser>)",
    "[Kampe](<https://ladder.cycleracing.club/matchlist/fixtures/Chonky%20Chaser>)",
  ].join(" · ")));

  const teamKey = createHash("sha256").update("chonky chaser").digest("base64url");
  const remove = customTeam.accessory;
  assert.equal(remove.custom_id, `ladder_team:remove:${teamKey}`);
  const overview = serializeV2(reply);
  await click(remove.custom_id);
  const [prompt, row] = serializeV2(reply);
  assert.equal(prompt.type, ComponentType.TextDisplay);
  assert.equal(prompt.content, "Fjern Chonky Chaser?");
  assert.equal(row.type, ComponentType.ActionRow);
  const [confirm, cancel] = row.components;
  assert.deepEqual(row.components.map((button) => button.label), ["Fjern hold", "Annuller"]);
  assert.equal(confirm.custom_id, `ladder_team:confirm:${teamKey}`);
  assert.equal(cancel.custom_id, "ladder_team:cancel");
  assert.equal(unlink.mock.callCount(), 0);

  await click(cancel.custom_id);
  assert.equal(unlink.mock.callCount(), 0);
  assert.deepEqual(serializeV2(reply), overview);

  await click(remove.custom_id);
  await click(confirm.custom_id);
  assert.equal(unlink.mock.callCount(), 1);
  assert.deepEqual(unlink.mock.calls[0].arguments, ["Chonky Chaser"]);
  assert.deepEqual(overviewSections(reply).sections, [defaultTeam]);
});

test("the empty Ladder teams overview shows how to link a team", async (t) => {
  t.mock.method(ladderTeams, "list", async () => []);
  const editReply = t.mock.fn();

  await handleLadderTeams({ ...admin, deferReply: async () => {}, editReply });

  const { header, sections } = overviewSections(editReply.mock.calls[0].arguments[0]);
  assert.match(header.content, /Der er ingen tilknyttede Ladder-hold/);
  assert.match(header.content, /`\/ladder_link`/);
  assert.deepEqual(sections, []);
});

test("existing Ladder team buttons can replace legacy message fields with V2 components", async (t) => {
  t.mock.method(ladderTeams, "list", async () => []);
  const patch = t.mock.fn(async () => ({}));
  const webhook = new InteractionWebhook({ options: {}, rest: { patch } }, "123", "test-token");
  const editReply = (payload) => webhook.editMessage("@original", payload);

  const legacyMessages = [
    { customId: "ladder_team:cancel", message: { content: "Fjern Chonky Chaser?", embeds: [] } },
    { customId: "ladder_team:remove:stale", message: { content: "", embeds: [{}] } },
  ];
  for (const interaction of legacyMessages) {
    await handleLadderTeamsButton({ ...admin, ...interaction, webhook, deferUpdate: async () => {}, editReply });
  }

  const [promptEdit, overviewEdit] = patch.mock.calls.map((call) => call.arguments[1].body);
  assert.equal(promptEdit.content, null);
  assert.deepEqual(overviewEdit.embeds, []);
  for (const edit of [promptEdit, overviewEdit]) {
    assert.equal(edit.flags, MessageFlags.IsComponentsV2);
    const [overview] = edit.components;
    assert.equal(overview.type, ComponentType.Container);
    const [header] = overview.components;
    assert.equal(header.type, ComponentType.TextDisplay);
    assert.match(header.content, /Der er ingen tilknyttede Ladder-hold/);
  }
});

test("ten Ladder teams are shown alphabetically within Discord's 40-component limit", async (t) => {
  const names = ["Alfa", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Zulu", "Ægir", "Ørn"];
  t.mock.method(ladderTeams, "list", async () => names.toReversed().map((name) => ({ name })));
  const editReply = t.mock.fn();

  await handleLadderTeams({ ...admin, deferReply: async () => {}, editReply });

  const [payload] = editReply.mock.calls[0].arguments;
  const { sections } = overviewSections(payload);
  assert.deepEqual(sections.map((section) => section.components[0].content.split("\n")[0]),
    names.map((name) => `### ${name}`));
  assert.ok(countComponents(serializeV2(payload)) <= 40);
});

test("ten long Ladder team names fit within the combined Text Display character limit", async (t) => {
  const teams = Array.from({ length: ladderTeams.MAX_TEAMS }, (_, index) => ({
    name: `Hold ${index} ${"Æøå".repeat(200)}`,
  }));
  t.mock.method(ladderTeams, "list", async () => teams);
  const editReply = t.mock.fn();

  await handleLadderTeams({ ...admin, deferReply: async () => {}, editReply });

  const { sections } = overviewSections(editReply.mock.calls[0].arguments[0]);
  assert.equal(sections.length, teams.length);
  for (const [index, section] of sections.entries()) {
    assert.ok(section.components[0].content.startsWith(`### Hold ${index} `));
  }
});

test("Ladder command and button errors are displayed as Components V2 text", async (t) => {
  const error = new Error("Ladder lookup failed");
  t.mock.method(ladderTeams, "list", async () => { throw error; });
  t.mock.method(console, "error", () => {});
  const replies = [];
  const editReply = async (payload) => replies.push(payload);

  await handleLadderTeams({ ...admin, deferReply: async () => {}, editReply });
  await handleLadderTeamsButton({
    ...admin,
    customId: "ladder_team:cancel",
    deferUpdate: async () => {},
    editReply,
  });

  assert.equal(replies.length, 2);
  for (const reply of replies) {
    const [message] = serializeV2(reply);
    assert.equal(message.type, ComponentType.TextDisplay);
    assert.match(message.content, /Der skete en fejl/);
  }
});
