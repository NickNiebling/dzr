const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { resolve } = require("node:path");

function deployment(value) {
  const env = { ...process.env };
  if (value === undefined) delete env.STREAMING_SETUP_ENABLED;
  else env.STREAMING_SETUP_ENABLED = value;
  // Fresh modules for each startup: exercise the same config/command load order
  // as bot.js without loading its Firebase client or registering with Discord.
  return JSON.parse(execFileSync(process.execPath, ["-e", `
    const config = require('./config/config');
    const commands = require('./commands/slashCommands');
    process.stdout.write(JSON.stringify({ enabled: config.streaming.setupEnabled, commands }));
  `], { cwd: resolve(__dirname, "../.."), env, encoding: "utf8" }));
}

test("only explicit true activates the production command and handler configuration", () => {
  const baseline = deployment(undefined);
  assert.equal(baseline.enabled, false);
  assert.equal(baseline.commands.some(c => c.name === "streaming_add_new"), false);
  for (const value of ["false", "", "1", "TRUE", " true ", "yes"]) {
    assert.deepEqual(deployment(value), baseline);
  }
  const enabled = deployment("true");
  assert.equal(enabled.enabled, true);
  const command = enabled.commands.find(c => c.name === "streaming_add_new");
  assert.equal(command.dm_permission, false);
  assert.equal(command.default_member_permissions, undefined);
  assert.deepEqual(enabled.commands.filter(c => c.name !== "streaming_add_new"), baseline.commands);
  assert.deepEqual(deployment("false"), baseline, "a restart with false removes only the experimental command");
});
