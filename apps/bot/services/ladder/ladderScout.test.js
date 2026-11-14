const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLadderScoutMessage } = require("./ladderEmbed");
const { handleLadderScout } = require("../../handlers/ladderHandlers");
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
