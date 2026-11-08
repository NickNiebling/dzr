// Isolated streaming acceptance runner. Never start bot.js with test credentials:
// that entrypoint registers global commands and starts unrelated production jobs.
const shared = require("../constants.json");

const PROJECT_ID = "demo-dzr-streaming";
const COMMAND_NAMES = ["streaming_add", "streaming_add_new", "streaming_remove", "streaming_overview"];

class TestConfigurationError extends Error {}

function readTestConfig(env = process.env) {
  const required = (name) => {
    const value = String(env[name] || "").trim();
    if (!value) throw new TestConfigurationError(`Angiv ${name} i testmiljøet.`);
    return value;
  };
  const snowflake = (name) => {
    const value = required(name);
    if (!/^\d{17,20}$/.test(value)) throw new TestConfigurationError(`${name} skal være et Discord-id.`);
    return value;
  };
  const httpsUrl = (name, pathname) => {
    let url;
    try { url = new URL(required(name)); } catch { /* Rejected below; never print supplied URLs. */ }
    if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || url.pathname.replace(/\/$/, "") !== pathname) {
      throw new TestConfigurationError(`${name} skal være en HTTPS-adresse med stien ${pathname || "/"} uden login eller parametre.`);
    }
    return url;
  };

  const emulatorHost = required("FIRESTORE_EMULATOR_HOST");
  const emulator = /^(localhost|127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})$/.exec(emulatorHost);
  if (!emulator || Number(emulator[2]) > 65535) {
    throw new TestConfigurationError("FIRESTORE_EMULATOR_HOST skal pege på en lokal emulator, fx 127.0.0.1:8080.");
  }
  const token = required("STREAMING_TEST_BOT_TOKEN");
  const clientId = snowflake("STREAMING_TEST_CLIENT_ID");
  const guildId = snowflake("STREAMING_TEST_GUILD_ID");
  const clubRoleId = snowflake("STREAMING_TEST_CLUB_ROLE_ID");
  const channelId = snowflake("STREAMING_TEST_CHANNEL_ID");
  const itChannelId = snowflake("STREAMING_TEST_IT_CHANNEL_ID");
  if (guildId === shared.discord.guildId) throw new TestConfigurationError("Brug en separat testserver; DZR-produktionsserveren er blokeret.");
  if ([env.DISCORD_CLIENT_ID, env.COACH_BOT_CLIENT_ID].includes(clientId)
    || [env.DISCORD_BOT_TOKEN, env.COACH_BOT_TOKEN].filter(Boolean).includes(token)) {
    throw new TestConfigurationError("Brug en separat Discord-testapp og testtoken.");
  }
  const productionChannels = [...Object.values(shared.discord.channels), "1196454773558345768", "1544209256100794378"];
  if ([channelId, itChannelId].some((id) => productionChannels.includes(id))
    || Object.values(shared.discord.roles).includes(clubRoleId)) {
    throw new TestConfigurationError("Brug rolle- og kanal-id'er fra testserveren.");
  }
  const publicUrl = httpsUrl("STREAMING_TEST_PUBLIC_URL", "").origin;
  const setup = httpsUrl("STREAMING_SETUP_URL", "/streaming/setup");
  if (publicUrl === "https://bot-tdnm.onrender.com" || setup.origin === new URL(shared.siteOrigin).origin) {
    throw new TestConfigurationError("Testadresser må ikke pege på DZR's produktionsbot eller website.");
  }
  const setupUrl = setup.href;
  const port = Number(env.STREAMING_TEST_PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TestConfigurationError("STREAMING_TEST_PORT skal være et portnummer mellem 1 og 65535.");
  }
  return { projectId: PROJECT_ID, emulatorHost, token, clientId, guildId, clubRoleId, channelId, itChannelId, publicUrl, setupUrl, port };
}

function testCommands(commands) {
  const selected = commands.filter((command) => COMMAND_NAMES.includes(command.name));
  if (selected.length !== COMMAND_NAMES.length || new Set(selected.map((command) => command.name)).size !== COMMAND_NAMES.length) {
    throw new TestConfigurationError("Teststarteren kræver de fire streamingkommandoer.");
  }
  return selected;
}

async function registerTestCommands(client, rest, routes, config, commands) {
  if (client.application?.id !== config.clientId) {
    throw new TestConfigurationError("Testtoken og STREAMING_TEST_CLIENT_ID tilhører ikke samme Discord-app.");
  }
  // Validate all destinations before registering commands or starting effectful handlers.
  await rest.get(routes.guild(config.guildId));
  for (const id of [config.channelId, config.itChannelId]) {
    const channel = await rest.get(routes.channel(id));
    if (channel.guild_id !== config.guildId || ![0, 5, 10, 11, 12].includes(channel.type)) {
      throw new TestConfigurationError("Begge testkanaler skal være tekstkanaler på testserveren.");
    }
  }
  const roles = await rest.get(routes.guildRoles(config.guildId));
  if (!roles.some((role) => role.id === config.clubRoleId)) {
    throw new TestConfigurationError("Club Member-testrollen findes ikke på testserveren.");
  }
  await rest.put(routes.applicationGuildCommands(config.clientId, config.guildId), { body: testCommands(commands) });
}

async function main() {
  // Validate before loading SDKs or any module that reads ordinary bot configuration.
  const config = readTestConfig();
  const { once } = require("node:events");
  const { initializeApp, deleteApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const { Client, Events, GatewayIntentBits, REST, Routes } = require("discord.js");
  const { createStore } = require("../services/streaming/store");
  const { createProviders } = require("../services/streaming/providers");
  const { createPublisher } = require("../services/streaming/publisher");
  const { createStreamingService } = require("../services/streaming/service");
  const { createStreamingHandlers } = require("../handlers/streamingHandlers");
  const { createHttpApp } = require("../services/server");

  const firebase = initializeApp({ projectId: config.projectId }, "streaming-dev");
  const db = getFirestore(firebase);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const rest = new REST({ version: "10", timeout: 8000, retries: 0 }).setToken(config.token);
  let streaming;
  let listener;
  let closing;
  const close = () => {
    if (!closing) closing = (async () => {
      streaming?.stop();
      client.destroy();
      if (listener) await new Promise((resolve) => listener.close(resolve));
      await db.terminate();
      await deleteApp(firebase);
    })();
    return closing;
  };

  try {
    // This write can only reach the validated loopback emulator and fixed demo project.
    const membership = db.collection(shared.firestore.systemSettings).doc("global");
    await membership.set({ membership: { clubMemberRoleId: config.clubRoleId } }, { merge: true });
    client.on(Events.Error, () => console.warn("Discord-testforbindelsen har en fejl; ingen detaljer logges."));
    const ready = once(client, Events.ClientReady);
    await client.login(config.token);
    await ready;
    await registerTestCommands(client, rest, Routes, config, require("../commands/slashCommands"));

    streaming = createStreamingService({
      store: createStore(db, { searchBudget: 10 }),
      providers: createProviders({ youtubeApiKey: process.env.YOUTUBE_API_KEY,
        twitchClientId: process.env.TWITCH_CLIENT_ID, twitchClientSecret: process.env.TWITCH_CLIENT_SECRET }),
      publisher: createPublisher(client, config.guildId, { itChannelId: config.itChannelId }),
      guildId: config.guildId, channelId: config.channelId,
    });
    const handlers = createStreamingHandlers({
      service: streaming, guildId: config.guildId, publicUrl: config.publicUrl,
      setupUrl: config.setupUrl, channelId: config.channelId,
      getClubRoleId: async () => (await membership.get()).data()?.membership?.clubMemberRoleId || null,
    });
    client.on(Events.InteractionCreate, (interaction) => {
      // The test application may have been invited elsewhere. Ignore all other guilds.
      if (interaction.guildId === config.guildId) {
        handlers.handle(interaction).catch(() => console.warn("Testinteraktionen kunne ikke behandles."));
      }
    });
    const app = createHttpApp({ streaming });
    listener = app.listen(config.port, "127.0.0.1");
    await once(listener, "listening");
    streaming.start();
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
      close().catch(() => { process.exitCode = 1; });
    });
    console.log(`DZR Streaming-test kører på 127.0.0.1:${config.port} med projektet ${PROJECT_ID}.`);
    console.log("Kun testserverens streamingkommandoer er registreret. Brug testadressen i OBS før Test forbindelse.");
    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof TestConfigurationError ? error.message
      : "Streaming-test kunne ikke startes. Kontrollér lokal emulator, testbot, testrolle og testkanaler.");
    process.exitCode = 1;
  });
}

module.exports = { readTestConfig, testCommands, registerTestCommands, TestConfigurationError };
