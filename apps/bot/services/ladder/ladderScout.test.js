const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { MessageFlags } = require("discord.js");
const { buildLadderScoutMessage, scoutTeams } = require("./ladderScout");

function team(id, name, count) {
  return {
    id: String(id), name,
    url: `https://ladder.cycleracing.club/team/n/${id}`,
    riders: Array.from({ length: count }, (_, i) => ({ name: `${name} Rytter ${i + 1}`, zwiftId: String(Number(id) * 100 + i + 1), wkg: {} })),
  };
}

function options(home, away, extra = {}) {
  return {
    listTeams: async () => [{ name: home.name }],
    resolveTeam: async (input) => input === home.name ? home : away,
    loadRoster: async (resolved) => resolved.id === home.id ? home : away,
    ...extra,
  };
}

// Run the real Discord routing and Ladder handler with unrelated services isolated from the test.
function isolatedModule(filename, stubs) {
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const require = (name) => Object.hasOwn(stubs, name) ? stubs[name] : (name === "discord.js" || name === "crypto") ? localRequire(name) : {};
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports, require, Buffer,
    console: { log() {}, error() {} },
    setTimeout(callback) { callback(); },
  }, { filename });
  return module.exports;
}

function interaction(overrides = {}) {
  return {
    id: "scout-test", type: 2, commandName: "ladder_scout", createdTimestamp: Date.now(), replied: false, deferred: false,
    isCommand: () => true, isButton: () => false, isAutocomplete: () => false, isStringSelectMenu: () => false,
    options: { getString: (name) => name === "team" ? "DZR" : "Opponent" },
    channel: { send() { assert.fail("A scout must never post to the channel"); } },
    async reply(message) { this.ack = message; this.replied = true; },
    async editReply(message) { this.result = message; },
    ...overrides,
  };
}

test("scout routes 9 versus 11 complete riders through enrichment and chart in a private reply", async () => {
  const home = team(82, "DZR", 9);
  const away = team(102, "Opponent", 11);
  home.riders[8].zwiftId = null;
  let enriched;
  let rendered;
  const scout = (ourTeam, opponent) => scoutTeams(ourTeam, opponent, options(home, away, {
    buildMessage: (ours, theirs) => buildLadderScoutMessage(ours, theirs, {
      enrich: async (riders) => {
        enriched = riders;
        for (const rider of riders) if (rider.zwiftId && rider !== away.riders[10]) rider.wkg[300] = 4.25;
      },
      render: async (comparison) => { rendered = comparison; return Buffer.from("png"); },
    }),
  }));
  const handlers = isolatedModule(path.resolve(__dirname, "../../handlers/ladderHandlers.js"), { "../services/ladder/ladderScout": { scoutTeams: scout } });
  const { handleInteractions } = isolatedModule(path.resolve(__dirname, "../../handlers/interactionHandler.js"), { "./ladderHandlers": handlers });
  const command = interaction();
  await handleInteractions(command);
  assert.equal(command.ack.flags, MessageFlags.Ephemeral);
  assert.equal(enriched.length, 20);
  assert.equal(rendered.home.riders.length, 9);
  assert.equal(rendered.away.riders.length, 11);
  assert.equal(new Set([...rendered.home.riders, ...rendered.away.riders].map((rider) => rider.name)).size, 20);
  assert.equal(rendered.scout, true);
  const embed = command.result.embeds[0].toJSON();
  assert.match(embed.description, /9 ryttere i truppen/);
  assert.match(embed.description, /11 ryttere i truppen/);
  assert.match(embed.description, /team\/n\/82/);
  assert.match(embed.description, /team\/n\/102/);
  assert.match(embed.fields.find((field) => field.name === "Mangler Zwift-id").value, /DZR: 1/);
  assert.match(embed.fields.find((field) => field.name === "Mangler power").value, /Opponent: 1/);
  assert.doesNotMatch(JSON.stringify(embed), /fixture\/|Rute|Starter|Taktik/);
});

test("both command fields are required and autocomplete is enabled", () => {
  const command = require("../../commands/slashCommands").find((entry) => entry.name === "ladder_scout");
  assert.deepEqual(command.options.map(({ name, required, autocomplete }) => ({ name, required, autocomplete })), [
    { name: "team", required: true, autocomplete: true },
    { name: "opponent", required: true, autocomplete: true },
  ]);
});

test("the team must come from ladder_link and the same resolved team is rejected before roster reads", async () => {
  const home = team(82, "DZR", 9);
  let loads = 0;
  const deps = options(home, home, { loadRoster: async () => { loads += 1; return home; } });
  await assert.rejects(scoutTeams("Other DZR", "Opponent", deps), (error) => /ladder_link/.test(error.userMessage));
  await assert.rejects(scoutTeams("DZR", "https://ladder.cycleracing.club/team/n/82", deps), (error) => /samme hold/.test(error.userMessage));
  await assert.rejects(scoutTeams("DZR", "", deps), (error) => /skal udfyldes/.test(error.userMessage));
  assert.equal(loads, 0);
});

test("each scout fetches both complete rosters again", async () => {
  const home = team(82, "DZR", 9);
  const away = team(102, "Opponent", 11);
  const loaded = [];
  const deps = options(home, away, {
    loadRoster: async (resolved) => { loaded.push(resolved.id); return resolved; },
    buildMessage: async () => ({}),
  });
  await scoutTeams("DZR", "Opponent", deps);
  await scoutTeams("DZR", "Opponent", deps);
  assert.deepEqual(loaded.sort(), ["102", "102", "82", "82"]);
});

test("rendering failure keeps all members and power in a complete text fallback", async () => {
  const home = team(82, "DZR", 35);
  const away = team(102, "Opponent", 40);
  home.riders[0].wkg[300] = 4.5;
  const message = await buildLadderScoutMessage(home, away, { enrich: async () => {}, render: async () => { throw new Error("canvas failed"); } });
  assert.equal(message.files[0].name, "scout.txt");
  const text = message.files[0].attachment.toString("utf8");
  for (const rider of [...home.riders, ...away.riders]) assert.ok(text.includes(`${rider.name} | ${rider.zwiftId} |`));
  assert.match(text, /4\.50/);
  assert.match(message.content, /som tekst/);
  assert.ok(message.embeds[0].toJSON().fields.some((field) => field.name === "Gennemsnit (W/kg)"));
});

test("scout autocomplete uses linked teams and the shared cached opponent choices", async () => {
  const choices = [{ name: "Opponent", value: "102" }];
  const catalog = { autocomplete: (query) => { assert.equal(query, "Opp"); return choices; } };
  const { handleInteractions } = isolatedModule(path.resolve(__dirname, "../../handlers/interactionHandler.js"), {
    "../services/ladder/ladderCatalog": catalog,
    "../services/ladder/ladderTeams": { list: async () => [{ name: "DZR" }, { name: "Another" }] },
  });
  const opponent = interaction({ isAutocomplete: () => true, options: { getFocused: () => ({ name: "opponent", value: "Opp" }) }, respond: async (result) => { opponent.result = result; } });
  await handleInteractions(opponent);
  assert.equal(opponent.result, choices);
  const ours = interaction({ isAutocomplete: () => true, options: { getFocused: () => ({ name: "team", value: "dz" }) }, respond: async (result) => { ours.result = result; } });
  await handleInteractions(ours);
  assert.equal(ours.result.length, 1);
  assert.equal(ours.result[0].value, "DZR");
});
