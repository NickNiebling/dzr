const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");
const { buildLadderScoutMessage } = require("./ladderEmbed");
const { handleLadderScout } = require("../../handlers/ladderHandlers");
const { handlePublishButton } = require("../../utils/ephemeralStore");
const ladderTeams = require("./ladderTeams");
const ladderClient = require("./ladderClient");

function team(id, name, count) {
  return {
    id: String(id), name, url: `https://ladder.cycleracing.club/team/n/${id}`,
    riders: Array.from({ length: count }, (_, i) => ({ name: `${name} Rytter ${i + 1}`, zwiftId: String(id * 100 + i), wkg: {} })),
  };
}

test("scout sends all 9 versus 11 riders through enrichment and chart, including missing identity and power", async () => {
  const home = team(82, "DZR", 9);
  const away = team(102, "Opponent", 11);
  home.riders[8].zwiftId = null;
  const message = await buildLadderScoutMessage(home, away, {
    enrich: async (riders) => {
      assert.equal(riders.length, 20);
      for (const rider of riders) if (rider.zwiftId && rider !== away.riders[10]) rider.wkg[300] = 4.25;
    },
    render: async (comparison) => {
      assert.equal(comparison.home.riders.length, 9);
      assert.equal(comparison.away.riders.length, 11);
      assert.equal(comparison.scout, true);
      return Buffer.from("png");
    },
  });
  const embed = message.embeds[0].toJSON();
  assert.match(embed.description, /9 ryttere i truppen/);
  assert.match(embed.description, /11 ryttere i truppen/);
  assert.match(embed.description, /team\/n\/82/);
  assert.match(embed.fields.find((field) => field.name === "Mangler Zwift-id").value, /DZR: 1/);
  assert.match(embed.fields.find((field) => field.name === "Mangler power").value, /Opponent: 1/);
  assert.doesNotMatch(JSON.stringify(embed), /fixture\/|Rute|Starter|Taktik/);
});

test("handler rejects teams outside ladder_link and the same resolved team before roster reads", async (t) => {
  t.mock.method(ladderTeams, "getTeam", async (name) => name === "DZR" ? { name: "DZR" } : null);
  t.mock.method(ladderClient, "resolveTeam", async () => ({ id: "82" }));
  const load = t.mock.method(ladderClient, "getRoster", async () => assert.fail("Rejected teams must not load rosters"));
  let chosen = "Other";
  let reply;
  const interaction = {
    options: { getString: (name) => name === "team" ? chosen : "https://ladder.cycleracing.club/team/n/82" },
    editReply: async (message) => { reply = message; },
  };
  await handleLadderScout(interaction);
  assert.match(reply.content, /ladder_link/);
  chosen = "DZR";
  await handleLadderScout(interaction);
  assert.match(reply.content, /samme hold/);
  assert.equal(load.mock.callCount(), 0);
});

test("the private scout preview can post its full report and attachment once", async (t) => {
  const home = team(82, "DZR", 0);
  const away = team(102, "Opponent", 0);
  t.mock.method(ladderTeams, "getTeam", async () => home);
  t.mock.method(ladderClient, "resolveTeam", async (name) => name === home.name ? home : away);
  const rosters = t.mock.method(ladderClient, "getRoster", async (team) => team);
  const command = {
    options: { getString: (name) => name === "team" ? home.name : away.name },
    editReply: t.mock.fn(async () => {}),
  };
  await handleLadderScout(command);
  const [{ components, ...report }] = command.editReply.mock.calls[0].arguments;
  const button = components[0].toJSON().components[0];
  assert.equal(button.label, "Post i kanalen");
  assert.equal(report.embeds[0].toJSON().title, "Ladder scout: DZR mod Opponent");
  assert.match(report.files[0].name, /^scout\.(png|txt)$/);
  const uniqueId = button.custom_id.replace(/^publish_/, "");

  const click = {
    message: report,
    deferUpdate: t.mock.fn(async () => {}),
    followUp: t.mock.fn(async () => {}),
    editReply: t.mock.fn(async () => {}),
    reply: t.mock.fn(async () => {}),
  };
  assert.equal(await handlePublishButton(click, uniqueId), true);
  assert.equal(await handlePublishButton(click, uniqueId), false);
  assert.equal(click.deferUpdate.mock.callCount(), 1);
  assert.equal(click.followUp.mock.callCount(), 1);
  assert.deepEqual(click.followUp.mock.calls[0].arguments, [report]);
  assert.deepEqual(click.editReply.mock.calls[0].arguments, [{ components: [] }]);
  assert.equal(click.reply.mock.calls[0].arguments[0].flags, MessageFlags.Ephemeral);
  assert.equal(rosters.mock.callCount(), 2);
});

test("rendering failure keeps every roster member and power value in the text attachment", async () => {
  const home = team(82, "DZR", 35);
  const away = team(102, "Opponent", 40);
  home.riders[0].wkg[300] = 4.5;
  const message = await buildLadderScoutMessage(home, away, { enrich: async () => {}, render: async () => { throw new Error("canvas failed"); } });
  assert.equal(message.files[0].name, "scout.txt");
  const text = message.files[0].attachment.toString("utf8");
  for (const rider of [...home.riders, ...away.riders]) assert.ok(text.includes(`${rider.name}:`));
  assert.match(text, /4\.50/);
});
