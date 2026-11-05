const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags, PermissionsBitField } = require("discord.js");
const { createStreamingHandlers } = require("../../handlers/streamingHandlers");

const guildId = "1195850595014299669", userId = "111111111111111111";
function interaction(overrides = {}) {
  const calls = [];
  const item = { guildId, user: { id: userId, username: "Rider", bot: false }, memberPermissions: new PermissionsBitField(0n),
    member: { roles: ["club-role"] },
    isButton: () => false, isModalSubmit: () => false, options: { getInteger: () => null },
    async deferReply(value) { calls.push(["defer", value]); item.deferred = true; },
    async reply(value) { calls.push(["reply", value]); }, async editReply(value) { calls.push(["edit", value]); },
    async showModal(value) { calls.push(["modal", value.toJSON()]); }, calls, ...overrides };
  return item;
}
function handler(service = {}) { return createStreamingHandlers({ service, guildId, adminRoleId: "admin-role", publicUrl: "https://bot.example.test", channelId: "1196454773558345768", getClubRoleId: async () => "club-role" }); }

test("Club Members can start private onboarding without admin permissions", async () => {
  const i = interaction({ commandName: "streaming_add" });
  await handler({ async getRegistration() { return null; } }).handle(i);
  assert.equal(i.calls[0][1].flags, MessageFlags.Ephemeral);
  assert.match(i.calls[1][1].content, /Angiv|angiver/);
  assert.equal(i.calls[1][1].components[0].toJSON().components[0].custom_id, `streaming:channels:${userId}`);
});

test("channel button opens a two-platform modal before acknowledging the interaction", async () => {
  const i = interaction({ customId: `streaming:channels:${userId}`, isButton: () => true });
  await handler({ async getRegistration() { return null; } }).handle(i);
  assert.equal(i.calls[0][0], "modal");
  assert.equal(i.calls[0][1].components.length, 2);
});

test("modal returns download, endpoint and personal key only in an ephemeral response", async () => {
  const i = interaction({ customId: `streaming:save:${userId}`, isModalSubmit: () => true, fields: { getTextInputValue: () => "@DZR" } });
  await handler({ async enroll(id) {
    assert.equal(id, userId);
    return { token: "personal-key", registration: { channels: { youtube: { url: "https://youtube.com/@DZR" } } } };
  } }).handle(i);
  assert.equal(i.calls[0][1].flags, MessageFlags.Ephemeral);
  const reply = i.calls[1][1].content;
  assert.match(reply, /personal-key/);
  assert.match(reply, /https:\/\/bot\.example\.test\/streaming\/dzr-stream.lua/);
  assert.match(reply, /https:\/\/bot\.example\.test\/streaming\/obs/);
});

test("forged modal owner and DM commands cannot enroll or remove other members", async () => {
  let called = false;
  const h = handler({ enroll() { called = true; }, remove() { called = true; } });
  const forged = interaction({ customId: "streaming:remove:222222222222222222", isButton: () => true });
  await h.handle(forged);
  await h.handle(interaction({ commandName: "streaming_add", guildId: null }));
  assert.equal(called, false);
  assert.match(forged.calls[0][1].content, /dit eget flow/);
});

test("overview checks admin access at execution and never includes keys", async () => {
  let listed = false;
  const h = handler({ async overview() {
    listed = true;
    return [{ discordId: userId, discordName: "Rider", channels: { twitch: { url: "https://twitch.tv/dzr" } }, tokenHash: "secret-hash", lastLiveAt: Date.now() }];
  }, async issues() { return []; } });
  await h.handle(interaction({ commandName: "streaming_overview" }));
  assert.equal(listed, false);
  const admin = interaction({ commandName: "streaming_overview", memberPermissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator) });
  await h.handle(admin);
  assert.equal(listed, true);
  const serialized = JSON.stringify(admin.calls);
  assert.ok(!serialized.includes("secret-hash"));
  assert.ok(serialized.includes(userId));
  assert.ok(serialized.includes("https://twitch.tv/dzr"));
});

test("Club Member self-removal is confirmed and passes only the invoking user's ID", async () => {
  let removed;
  const h = handler({ async remove(id) { removed = id; return true; } });
  await h.handle(interaction({ commandName: "streaming_remove" }));
  assert.equal(removed, undefined);
  await h.handle(interaction({ customId: `streaming:remove:${userId}`, isButton: () => true }));
  assert.equal(removed, userId);
});

test("Club Member role is required on command, button and modal for ordinary users and administrators", async () => {
  const h = handler({ getRegistration() { assert.fail("must reject before accessing registration"); }, enroll() { assert.fail(); }, remove() { assert.fail(); } });
  for (const permissions of [0n, PermissionsBitField.Flags.Administrator]) {
    for (const entry of [{ commandName: "streaming_add" }, { commandName: "streaming_remove" },
      { customId: `streaming:remove:${userId}`, isButton: () => true }, { customId: `streaming:channels:${userId}`, isButton: () => true },
      { customId: `streaming:save:${userId}`, isModalSubmit: () => true }]) {
      const i = interaction({ ...entry, member: { roles: ["verified-role", "admin-role"] },
        memberPermissions: new PermissionsBitField(permissions) });
      await h.handle(i);
      assert.equal(i.calls[0][1].flags, MessageFlags.Ephemeral);
      assert.match(i.calls[0][1].content, /kun.*Club Members/);
    }
  }
});

test("missing Club Member role configuration fails closed", async () => {
  const i = interaction({ commandName: "streaming_add" });
  const h = createStreamingHandlers({ service: {}, guildId, publicUrl: "https://bot.example.test" });
  await h.handle(i);
  assert.match(i.calls[0][1].content, /Club Members/);
});

test("streaming member commands are visible by default; overview remains admin-only", () => {
  const commands = require("../../commands/slashCommands");
  for (const name of ["streaming_add", "streaming_remove"]) {
    const command = commands.find((entry) => entry.name === name);
    assert.equal(command.default_member_permissions, undefined);
    assert.equal(command.dm_permission, false);
  }
  assert.equal(commands.find((entry) => entry.name === "streaming_overview").default_member_permissions,
    String(PermissionsBitField.Flags.Administrator));
});
