const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags, PermissionsBitField } = require("discord.js");
const { createStreamingHandlers, isStreamingInteraction } = require("../../handlers/streamingHandlers");
const { StreamingError } = require("./model");

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
const registration = { channels: { youtube: { url: "https://www.youtube.com/@DZR" } }, tokenHash: "never-show-this-hash", registrationId: "keep-registration-id" };
const reply = (i) => JSON.parse(JSON.stringify(i.calls.find(([method]) => method === "edit")[1]));

test("new command acknowledges privately before role and registration lookups", async () => {
  const i = interaction({ commandName: "streaming_add_new" });
  const h = createStreamingHandlers({ service: { async getRegistration(id) {
    assert.equal(id, userId);
    assert.equal(i.deferred, true);
    return null;
  } }, guildId, publicUrl: "https://bot.example.test", getClubRoleId: async () => {
    assert.equal(i.deferred, true);
    return "club-role";
  } });
  assert.equal(isStreamingInteraction(i), true);
  await h.handle(i);
  assert.equal(i.calls[0][1].flags, MessageFlags.Ephemeral);
  assert.equal(reply(i).components[0].components[0].custom_id, `streaming:channels_new:${userId}`);
});

test("new flow reuses the two-platform modal and keeps the original modal unchanged", async () => {
  for (const [action, saveAction] of [["channels", "save"], ["channels_new", "save_new"]]) {
    const i = interaction({ customId: `streaming:${action}:${userId}`, isButton: () => true });
    await handler({ async getRegistration() { return null; } }).handle(i);
    assert.equal(i.calls.length, 1);
    assert.equal(i.calls[0][0], "modal");
    assert.equal(i.calls[0][1].custom_id, `streaming:${saveAction}:${userId}`);
    assert.deepEqual(i.calls[0][1].components.map((component) => component.components[0].custom_id), ["youtube", "twitch"]);
  }
});

test("new enrollment returns a key privately and a generic configured guide link", async () => {
  const i = interaction({ customId: `streaming:save_new:${userId}`, isModalSubmit: () => true,
    fields: { getTextInputValue: (platform) => platform === "youtube" ? "@DZR" : "" } });
  const setupUrl = "https://preview.example.test/streaming/setup";
  const h = createStreamingHandlers({ service: {
    async getRegistration() { return null; },
    async enroll(id, name, channels, options) {
      assert.equal(id, userId);
      assert.equal(name, "Rider");
      assert.deepEqual(channels, { youtube: "@DZR", twitch: "" });
      assert.deepEqual(options, { createOnly: true });
      return { registration, token: "one-time-personal-key" };
    },
  }, guildId, publicUrl: "https://bot.example.test", setupUrl, getClubRoleId: async () => "club-role" });
  await h.handle(i);
  assert.equal(i.calls[0][1].flags, MessageFlags.Ephemeral);
  const result = reply(i);
  assert.match(result.content, /one-time-personal-key/);
  assert.match(result.content, /valgfri/);
  assert.equal(result.components[0].components[0].url, setupUrl);
  assert.equal(result.components[0].components[0].custom_id, undefined);
  assert.equal(result.components[0].components[1].custom_id, `streaming:status:${userId}`);
  assert.ok(!JSON.stringify(result.components).includes("one-time-personal-key"));
  assert.ok(!JSON.stringify(result).includes(registration.tokenHash));
  assert.deepEqual(result.allowedMentions, { parse: [] });
});

test("existing registration and stale new components only show the guide without enrollment", async () => {
  const before = structuredClone(registration);
  for (const entry of [{ commandName: "streaming_add_new" },
    { customId: `streaming:channels_new:${userId}`, isButton: () => true },
    { customId: `streaming:save_new:${userId}`, isModalSubmit: () => true }]) {
    const i = interaction(entry);
    await handler({ async getRegistration() { return registration; }, enroll() { assert.fail("must not rotate an existing key"); } }).handle(i);
    const result = reply(i);
    assert.equal(i.calls[0][1].flags, MessageFlags.Ephemeral);
    assert.match(result.content, /allerede tilmeldt/);
    assert.match(result.content, /nøgle og dine kanaler er uændrede/);
    assert.match(result.content, /gamle nøgle ugyldig/);
    assert.ok(!JSON.stringify(result).includes(registration.tokenHash));
    const url = new URL(result.components[0].components[0].url);
    assert.equal(url.pathname, "/streaming/setup");
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    assert.ok(!url.href.includes(userId));
  }
  assert.deepEqual(registration, before);
});

test("a concurrent enrollment conflict recovers into guide access without returning a key", async () => {
  let reads = 0;
  const i = interaction({ customId: `streaming:save_new:${userId}`, isModalSubmit: () => true,
    fields: { getTextInputValue: () => "@DZR" } });
  await handler({ async getRegistration() { return ++reads === 1 ? null : registration; },
    async enroll() { throw new StreamingError("registration_exists", "Already enrolled", 409); },
  }).handle(i);
  assert.equal(reads, 2);
  assert.match(reply(i).content, /allerede tilmeldt/);
  assert.ok(!JSON.stringify(i.calls).includes(registration.tokenHash));
});

test("new channel errors offer a retry without exposing raw errors", async () => {
  const i = interaction({ customId: `streaming:save_new:${userId}`, isModalSubmit: () => true,
    fields: { getTextInputValue: () => "" } });
  await handler({ async getRegistration() { return null; }, async enroll() {
    throw new StreamingError("missing_channels", "Angiv mindst én kanal.");
  } }).handle(i);
  const result = reply(i);
  assert.equal(result.content, "Angiv mindst én kanal.");
  assert.equal(result.components[0].components[0].custom_id, `streaming:channels_new:${userId}`);
});

test("a guide URL with credentials or query parameters is rejected before enrollment", async () => {
  for (const setupUrl of ["https://preview.example.test/streaming/setup?key=secret", "https://user:secret@preview.example.test/streaming/setup", "http://preview.example.test/streaming/setup"]) {
    const i = interaction({ commandName: "streaming_add_new" });
    const h = createStreamingHandlers({ service: { getRegistration() { assert.fail(); }, enroll() { assert.fail(); } },
      guildId, publicUrl: "https://bot.example.test", setupUrl, getClubRoleId: async () => "club-role" });
    await h.handle(i);
    assert.match(reply(i).content, /midlertidigt utilgængelig/);
    assert.ok(!JSON.stringify(i.calls).includes("secret"));
  }
});

test("new commands and components reject DMs, other guilds, bots and forged owners", async () => {
  const h = handler({ getRegistration() { assert.fail(); }, enroll() { assert.fail(); } });
  for (const overrides of [{ commandName: "streaming_add_new", guildId: null },
    { commandName: "streaming_add_new", guildId: "other-guild" },
    { commandName: "streaming_add_new", user: { id: userId, bot: true } },
    { customId: "streaming:save_new:222222222222222222", isModalSubmit: () => true },
    { customId: "streaming:channels_new:222222222222222222", isButton: () => true }]) {
    const i = interaction(overrides);
    await h.handle(i);
    assert.equal(i.calls[0][0], "reply");
    assert.equal(i.calls[0][1].flags, MessageFlags.Ephemeral);
  }
});

test("Club Members can start private onboarding without admin permissions", async () => {
  const i = interaction({ commandName: "streaming_add" });
  await handler({ async getRegistration() { return null; } }).handle(i);
  assert.equal(i.calls[0][1].flags, MessageFlags.Ephemeral);
  assert.equal(i.calls[1][1].components[0].toJSON().components[0].custom_id, `streaming:channels:${userId}`);
});

test("channel button opens a two-platform modal before acknowledging the interaction", async () => {
  const i = interaction({ customId: `streaming:channels:${userId}`, isButton: () => true });
  await handler({ async getRegistration() { return null; } }).handle(i);
  assert.equal(i.calls[0][0], "modal");
  assert.equal(i.calls[0][1].components.length, 2);
});

test("modal returns download and personal key privately without endpoint configuration", async () => {
  const i = interaction({ customId: `streaming:save:${userId}`, isModalSubmit: () => true, fields: { getTextInputValue: () => "@DZR" } });
  await handler({ async enroll(id) {
    assert.equal(id, userId);
    return { token: "personal-key", registration: { channels: { youtube: { url: "https://youtube.com/@DZR" } } } };
  } }).handle(i);
  assert.equal(i.calls[0][1].flags, MessageFlags.Ephemeral);
  const reply = JSON.stringify(i.calls[1][1]);
  assert.ok(reply.includes("personal-key"));
  assert.ok(reply.includes("https://bot.example.test/streaming/dzr-stream.lua"));
  assert.ok(!reply.includes("DZR endpoint"));
  assert.ok(!reply.includes("https://bot.example.test/streaming/obs"));
  assert.equal(i.calls[1][1].embeds.length, 3);
  assert.ok(reply.includes("Downloads / Overførsler"));
  assert.ok(reply.includes("Test forbindelse"));
  assert.ok(reply.includes("DZR finder automatisk"));
  assert.ok(reply.includes("en eller flere platforme på samme tid"));
  assert.ok(reply.includes("inden for fem minutter"));
  assert.ok(!reply.includes("Vælg **YouTube** eller **Twitch**"));
  assert.equal(i.calls[1][1].components[0].toJSON().components[0].custom_id, `streaming:status:${userId}`);
  assert.deepEqual(i.calls[1][1].allowedMentions, { parse: [] });
});

test("onboarding with both channels and a long public URL fits Discord message limits", async () => {
  const discordId = "11111111111111111111";
  const token = `dzrs_${discordId}.${"a".repeat(43)}`;
  const publicUrl = `https://${["a".repeat(63), "b".repeat(63), "c".repeat(63), "example", "test"].join(".")}`;
  const channels = {
    youtube: { url: `https://www.youtube.com/channel/UC${"a".repeat(22)}` },
    twitch: { url: `https://www.twitch.tv/${"b".repeat(25)}` },
  };
  const i = interaction({ user: { id: discordId, username: "Rider", bot: false },
    customId: `streaming:save:${discordId}`, isModalSubmit: () => true,
    fields: { getTextInputValue: (platform) => channels[platform].url } });
  const h = createStreamingHandlers({ service: { async enroll() { return { token, registration: { channels } }; } },
    guildId, publicUrl, channelId: "1196454773558345768", getClubRoleId: async () => "club-role" });
  await h.handle(i);
  assert.equal(i.calls[0][1].flags, MessageFlags.Ephemeral);
  // Serializing builders also runs discord.js's embed validation.
  const reply = JSON.parse(JSON.stringify(i.calls[1][1]));
  const serialized = JSON.stringify(reply);
  for (const value of [token, `${publicUrl}/streaming/dzr-stream.lua`,
    channels.youtube.url, channels.twitch.url]) assert.ok(serialized.includes(value));
  assert.ok(reply.content.length <= 2000);
  assert.ok(reply.embeds.length > 0 && reply.embeds.length <= 10);
  let total = 0;
  for (const embed of reply.embeds) {
    assert.ok((embed.title || "").length <= 256);
    assert.ok((embed.description || "").length <= 4096);
    assert.ok((embed.fields || []).length <= 25);
    assert.ok((embed.footer?.text || "").length <= 2048);
    assert.ok((embed.author?.name || "").length <= 256);
    total += (embed.title || "").length + (embed.description || "").length
      + (embed.footer?.text || "").length + (embed.author?.name || "").length;
    for (const field of embed.fields || []) {
      assert.ok(field.name.length <= 256);
      assert.ok(field.value.length <= 1024);
      total += field.name.length + field.value.length;
    }
  }
  assert.ok(total <= 6000);
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
    for (const entry of [{ commandName: "streaming_add" }, { commandName: "streaming_add_new" }, { commandName: "streaming_remove" },
      { customId: `streaming:remove:${userId}`, isButton: () => true }, { customId: `streaming:channels:${userId}`, isButton: () => true },
      { customId: `streaming:save:${userId}`, isModalSubmit: () => true },
      { customId: `streaming:channels_new:${userId}`, isButton: () => true },
      { customId: `streaming:save_new:${userId}`, isModalSubmit: () => true }]) {
      const i = interaction({ ...entry, member: { roles: permissions ? ["verified-role", "admin-role"] : ["verified-role"] },
        memberPermissions: new PermissionsBitField(permissions) });
      await h.handle(i);
      assert.equal(i.calls[0][1].flags, MessageFlags.Ephemeral);
      assert.match((i.calls.find(([method]) => method === "edit") || i.calls[0])[1].content, /Club Members/);
    }
  }
});

test("missing Club Member role configuration fails closed", async () => {
  for (const commandName of ["streaming_add", "streaming_add_new"]) {
    const i = interaction({ commandName });
    const h = createStreamingHandlers({ service: {}, guildId, publicUrl: "https://bot.example.test" });
    await h.handle(i);
    assert.match((i.calls.find(([method]) => method === "edit") || i.calls[0])[1].content, /Club Members/);
  }
});

test("both member onboarding commands are available by default; overview still requires admin", () => {
  const commands = require("../../commands/slashCommands");
  for (const name of ["streaming_add", "streaming_add_new", "streaming_remove"]) {
    const command = commands.find((entry) => entry.name === name);
    assert.equal(command.default_member_permissions, undefined);
    assert.equal(command.dm_permission, false);
  }
  assert.equal(commands.find((entry) => entry.name === "streaming_overview").default_member_permissions,
    String(PermissionsBitField.Flags.Administrator));
});

test("browser registration authenticates through the HTTP callback and reopens without key rotation", async (t) => {
  const { memoryDb } = require("./test-support");
  const { createStore } = require("./store");
  const { createStreamingService } = require("./service");
  const { createHttpApp } = require("../server");
  const { tokenMatches } = require("./model");
  const db = memoryDb();
  let published = 0, verified = 0;
  const service = createStreamingService({
    store: createStore(db), guildId, channelId: "1196454773558345768",
    providers: {
      async resolveChannel() { return { id: "UCaaaaaaaaaaaaaaaaaaaaaa", ...registration.channels.youtube }; },
      async verify() { verified++; return { streams: [], state: {} }; },
    },
    publisher: { async send() { published++; return "message-id"; }, async reportError() {} },
  });
  const h = handler(service);
  const command = interaction({ commandName: "streaming_add_new" });
  await h.handle(command);
  const channels = interaction({ customId: reply(command).components[0].components[0].custom_id, isButton: () => true });
  await h.handle(channels);
  const save = interaction({ customId: channels.calls[0][1].custom_id, isModalSubmit: () => true,
    fields: { getTextInputValue: p => p === "youtube" ? "@DZR" : "" } });
  await h.handle(save);
  const token = reply(save).content.match(/dzrs_\d+\.[A-Za-z0-9_-]{43}/)?.[0];
  assert.ok(token);
  const stored = await service.getRegistration(userId);
  assert.ok(tokenMatches(token, stored.tokenHash));
  assert.ok(!JSON.stringify([...db.documents]).includes(token));
  assert.ok(!JSON.stringify(reply(save).components).includes(token));

  const before = structuredClone([...db.documents]);
  const stale = interaction({ customId: save.customId, isModalSubmit: () => true });
  await h.handle(stale);
  assert.match(reply(stale).content, /allerede tilmeldt/);
  assert.ok(!JSON.stringify(stale.calls).includes(token));
  assert.deepEqual([...db.documents], before);

  const listener = createHttpApp({ streaming: service }).listen(0, "127.0.0.1");
  await new Promise(resolve => listener.once("listening", resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const url = `http://127.0.0.1:${listener.address().port}/streaming/obs`;
  const now = Date.now();
  const event = { event: "test", platform: "youtube", sessionId: "browser_setup_test_123", sequence: 1, startedAt: now, sentAt: now };
  const post = key => fetch(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(event) });
  assert.equal((await post("wrong-key")).status, 401);
  assert.equal((await post(token)).status, 202);
  await service.tick();
  assert.equal(published, 0, "a connection test must not announce publicly");
  assert.equal(verified, 0, "a connection test must not call platform discovery");
  const status = interaction({ customId: `streaming:status:${userId}`, isButton: () => true });
  await h.handle(status);
  assert.match(reply(status).content, /DZR har modtaget et signal fra OBS/);
  assert.ok(!JSON.stringify(status.calls).includes(token));

  const reopened = interaction({ commandName: "streaming_add_new" });
  await handler(service).handle(reopened);
  assert.match(reply(reopened).content, /allerede tilmeldt/);
  const after = await service.getRegistration(userId);
  assert.equal(after.tokenHash, stored.tokenHash);
  assert.equal(after.registrationId, stored.registrationId);
  assert.deepEqual(after.channels, stored.channels);
  assert.ok(after.lastCallbackAt >= now);
});
