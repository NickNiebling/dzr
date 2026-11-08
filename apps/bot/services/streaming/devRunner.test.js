const test = require("node:test");
const assert = require("node:assert/strict");
const shared = require("../../constants.json");
const { readTestConfig, testCommands, registerTestCommands } = require("../../scripts/streaming-dev");

const env = {
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  STREAMING_TEST_BOT_TOKEN: "test-only-token",
  STREAMING_TEST_CLIENT_ID: "222222222222222222",
  STREAMING_TEST_GUILD_ID: "333333333333333333",
  STREAMING_TEST_CLUB_ROLE_ID: "444444444444444444",
  STREAMING_TEST_CHANNEL_ID: "555555555555555555",
  STREAMING_TEST_IT_CHANNEL_ID: "666666666666666666",
  STREAMING_TEST_PUBLIC_URL: "https://test-bot.example.test",
  STREAMING_SETUP_URL: "https://test-site.example.test/streaming/setup",
};
const commands = ["streaming_add", "streaming_add_new", "streaming_remove", "streaming_overview", "coach"]
  .map((name) => ({ name }));

test("test config requires explicit isolated destinations and fixes the demo project", () => {
  const config = readTestConfig(env);
  assert.equal(config.projectId, "demo-dzr-streaming");
  assert.equal(config.port, 3001);
  assert.equal(config.publicUrl, env.STREAMING_TEST_PUBLIC_URL);
  assert.equal(config.setupUrl, env.STREAMING_SETUP_URL);
  for (const key of Object.keys(env)) assert.throws(() => readTestConfig({ ...env, [key]: "" }));
});

test("test config rejects production guild, channels, credentials and roles", () => {
  for (const change of [
    { STREAMING_TEST_GUILD_ID: shared.discord.guildId },
    { STREAMING_TEST_CHANNEL_ID: shared.discord.channels.announcements },
    { STREAMING_TEST_IT_CHANNEL_ID: "1544209256100794378" },
    { STREAMING_TEST_CLUB_ROLE_ID: shared.discord.roles.admin },
    { DISCORD_BOT_TOKEN: env.STREAMING_TEST_BOT_TOKEN },
    { COACH_BOT_TOKEN: env.STREAMING_TEST_BOT_TOKEN },
    { DISCORD_CLIENT_ID: env.STREAMING_TEST_CLIENT_ID },
  ]) assert.throws(() => readTestConfig({ ...env, ...change }));
});

test("test config only permits loopback emulator and bounded valid ports", () => {
  for (const host of ["localhost:8080", "127.0.0.1:8080", "[::1]:8080"]) {
    assert.equal(readTestConfig({ ...env, FIRESTORE_EMULATOR_HOST: host }).emulatorHost, host);
  }
  for (const host of ["firestore.googleapis.com:443", "http://localhost:8080", "localhost:0", "localhost:65536", "127.0.0.1.evil.test:8080"]) {
    assert.throws(() => readTestConfig({ ...env, FIRESTORE_EMULATOR_HOST: host }));
  }
  for (const port of ["abc", "-1", "0", "65536", "1.5"]) {
    assert.throws(() => readTestConfig({ ...env, STREAMING_TEST_PORT: port }));
  }
});

test("test URLs cannot contain credentials, query keys, fragments or unexpected paths", () => {
  for (const url of ["http://localhost:3001", "https://user:secret@test.example.test", "https://test.example.test?key=secret", "https://test.example.test/#secret", "https://test.example.test/streaming"]) {
    assert.throws(() => readTestConfig({ ...env, STREAMING_TEST_PUBLIC_URL: url }));
  }
  for (const url of ["https://test.example.test", "https://test.example.test/streaming/setup?key=secret", "https://test.example.test/streaming/setup#secret"]) {
    assert.throws(() => readTestConfig({ ...env, STREAMING_SETUP_URL: url }));
  }
  assert.throws(() => readTestConfig({ ...env, STREAMING_TEST_PUBLIC_URL: "https://bot-tdnm.onrender.com" }));
  assert.throws(() => readTestConfig({ ...env, STREAMING_SETUP_URL: `${shared.siteOrigin}/streaming/setup` }));
});

function restFixture(overrides = {}) {
  const config = readTestConfig(env);
  const calls = [];
  const routes = { guild: (id) => `guild/${id}`, channel: (id) => `channel/${id}`,
    guildRoles: (id) => `roles/${id}`, applicationGuildCommands: (app, guild) => `commands/${app}/${guild}` };
  const rest = {
    async get(route) {
      calls.push(["get", route]);
      if (route.startsWith("roles/")) return [{ id: config.clubRoleId }];
      return { guild_id: config.guildId, type: 0 };
    },
    async put(route, body) { calls.push(["put", route, body]); },
    ...overrides,
  };
  return { config, calls, routes, rest };
}

test("command setup verifies application and destinations before guild-only registration", async () => {
  const { config, calls, routes, rest } = restFixture();
  await registerTestCommands({ application: { id: config.clientId } }, rest, routes, config, commands);
  const registration = calls.at(-1);
  assert.equal(registration[0], "put");
  assert.equal(registration[1], `commands/${config.clientId}/${config.guildId}`);
  assert.deepEqual(registration[2].body.map((item) => item.name), commands.slice(0, 4).map((item) => item.name));
  assert.equal(calls.filter(([method]) => method === "put").length, 1);
});

test("mismatched bot token, foreign channels and missing role cannot register commands", async () => {
  let s = restFixture();
  await assert.rejects(registerTestCommands({ application: { id: "777777777777777777" } }, s.rest, s.routes, s.config, commands));
  assert.deepEqual(s.calls, []);

  for (const result of [{ guild_id: shared.discord.guildId, type: 0 }, { guild_id: env.STREAMING_TEST_GUILD_ID, type: 2 }]) {
    s = restFixture({ async get() { return result; } });
    await assert.rejects(registerTestCommands({ application: { id: s.config.clientId } }, s.rest, s.routes, s.config, commands));
    assert.equal(s.calls.length, 0);
  }
  s = restFixture({ async get(route) { return route.startsWith("roles/") ? [] : { guild_id: env.STREAMING_TEST_GUILD_ID, type: 0 }; } });
  await assert.rejects(registerTestCommands({ application: { id: s.config.clientId } }, s.rest, s.routes, s.config, commands));
  assert.equal(s.calls.length, 0);
});

test("test command allowlist refuses missing commands and excludes unrelated bot features", () => {
  assert.equal(testCommands(commands).length, 4);
  assert.throws(() => testCommands(commands.slice(1)));
  assert.throws(() => testCommands([...commands, commands[0]]));
});
