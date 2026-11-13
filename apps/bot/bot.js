const { Client, GatewayIntentBits, REST, Routes, Partials } = require("discord.js");
const config = require("./config/config");
const commands = require("./commands/slashCommands");
const { setupKeepAliveServer } = require("./services/server");
const { handleInteractions } = require("./handlers/interactionHandler");
const { handleGuildMemberAdd, handleGuildMemberUpdate } = require("./handlers/memberHandler");
const { startScheduler } = require("./services/scheduler");
const approvalService = require("./services/approvalService");
const { recordClubDmFeedback } = require("./services/assistantDmStats");
const { handleReactionAdd: handleSignupReactionAdd, handleReactionRemove: handleSignupReactionRemove } = require("./services/signupService");
const { 
  handleMessageCreate, 
  handleMessageReactionAdd, 
  handleVoiceStateUpdate, 
  handleInteractionCreate,
  forceSaveStats 
} = require("./handlers/statsHandler");
const { handleZwiftIdMessage, handleZwiftIdConfirmation } = require("./handlers/zwiftIdMessageHandler");
const { handleAIChatMessage, flushAllCoachSessions } = require("./handlers/aiChatHandler");
const { handleAnnouncementUpsert, handleAnnouncementDelete } = require("./services/announcementIndex");
const { isGapDraftInteraction, handleGapDraftInteraction } = require("./services/gapDrafts");
const { isAnnouncerInteraction, handleAnnouncerInteraction } = require("./services/announcer/drafts");
const { isReminderInteraction, handleReminderInteraction } = require("./services/announcer/dmReminders");
const { startCoachBot } = require("./services/coachBot");
const { checkCoachKeyCanary, db } = require("./services/firebase");
const { createStore: createStreamingStore } = require("./services/streaming/store");
const { createProviders: createStreamingProviders } = require("./services/streaming/providers");
const { createPublisher: createStreamingPublisher } = require("./services/streaming/publisher");
const { createStreamingService } = require("./services/streaming/service");
const { createStreamingHandlers, isStreamingInteraction } = require("./handlers/streamingHandlers");
const shared = require("./constants.json");
const { loadZwiftCatalog, startZwiftCatalogRefresh } = require("./services/zwiftCatalog");
const { getClubRoleId } = require("./services/onboardingStatus");

// Create Discord Bot Client
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,           // Welcome messages and role management
    GatewayIntentBits.GuildMessages,          // Guild message activity
    GatewayIntentBits.GuildMessageReactions,  // Reaction stats and approval reactions
    GatewayIntentBits.GuildVoiceStates,       // Voice activity stats
    GatewayIntentBits.MessageContent,         // Read message content
    GatewayIntentBits.DirectMessages,         // Enable DMs to the bot
    GatewayIntentBits.DirectMessageReactions  // 👍/👎 on the club assistant's DM replies
  ],
  // Channel: receive DMs. Message/Reaction: reactions on messages sent before a restart.
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

const streaming = createStreamingService({
  store: createStreamingStore(db, { searchBudget: config.streaming.searchBudget }),
  providers: createStreamingProviders(config.streaming),
  publisher: createStreamingPublisher(client, config.discord.guildId, { itChannelId: config.discord.itChannelId }),
  guildId: config.discord.guildId,
  channelId: config.streaming.channelId,
});
const streamingHandlers = createStreamingHandlers({ service: streaming, guildId: config.discord.guildId,
  adminRoleId: shared.discord.roles.admin, publicUrl: config.streaming.publicUrl, channelId: config.streaming.channelId,
  getClubRoleId: () => getClubRoleId(db) });
setupKeepAliveServer({ streaming });

// Register Slash Commands
const rest = new REST({ version: "10" }).setToken(config.discord.token);

(async () => {
  try {
    console.log("Registering slash commands...");
    await rest.put(
      Routes.applicationCommands(config.discord.clientId),
      { body: commands }
    );
    console.log("✅ Slash commands registered.");
  } catch (error) {
    console.error("❌ Error registering commands:", error);
  }
})();

// Handle approval reactions
client.on("messageReactionAdd", async (reaction, user) => {
  // DMs: only ratings of the club assistant's replies. Everything below is guild-only.
  if (!reaction.message.guildId) {
    recordClubDmFeedback(reaction, user);
    return;
  }

  // Handle stats collection
  handleMessageReactionAdd(reaction, user);

  // Handle approval reactions (skip if it's the bot itself)
  if (user.bot) return;

  try {
    // If reaction is partial, fetch it
    if (reaction.partial) {
      await reaction.fetch();
    }

    // First, check for signup board reactions (A/B/C/D)
    try { await handleSignupReactionAdd(reaction, user); } catch (e) { /* noop */ }

    // Check if it's an approval or rejection reaction
    if (reaction.emoji.name === "✅" || reaction.emoji.name === "❌") {
      const result = await approvalService.handleApprovalReaction(
        reaction.message.id, 
        user.id, 
        reaction.message.guild,
        reaction.emoji.name
      );

      if (result) {
        if (result.approved) {
          console.log(`✅ Role approval: ${result.requestData.roleName} approved for user ${result.requestData.userId} by ${result.approver.tag} (${result.approverType})`);
        } else if (result.rejected) {
          console.log(`❌ Role rejection: ${result.requestData.roleName} rejected for user ${result.requestData.userId} by ${result.approver.tag} (${result.approverType})`);
        } else if (result.error) {
          // Send a DM to the user who tried to approve/reject without permission
          try {
            await user.send(`❌ **Permission Denied**\n\n${result.error}\n\n**Request Details:**\n• Role: ${result.requestData.roleName}`);
          } catch (dmError) {
            console.log(`Could not send DM to ${user.tag}: ${dmError.message}`);
          }
        }
      }
    }
  } catch (error) {
    console.error("Error handling approval reaction:", error);
  }
});

// Handle reaction removal for signup board
client.on("messageReactionRemove", async (reaction, user) => {
  if (user?.bot || !reaction.message.guildId) return;
  try {
    if (reaction.partial) {
      await reaction.fetch();
    }
    await handleSignupReactionRemove(reaction, user);
  } catch (error) {
    console.error("Error handling signup reaction remove:", error);
  }
});

// Handle all interactions
client.on("interactionCreate", async (interaction) => {
  if (isStreamingInteraction(interaction)) {
    await streamingHandlers.handle(interaction);
    handleInteractionCreate(interaction);
    return;
  }
  // Handle Zwift ID confirmation buttons
  if (interaction.isButton() && (interaction.customId.startsWith("confirm_zwiftid_") || interaction.customId.startsWith("cancel_zwiftid_"))) {
    handleZwiftIdConfirmation(interaction);
    return;
  }
  // Knowledge gap drafts in the moderators channel
  if (isGapDraftInteraction(interaction)) {
    handleGapDraftInteraction(interaction).catch((error) => console.error("Gap draft interaction failed:", error));
    return;
  }
  // Announcement drafts in the moderators channel
  if (isAnnouncerInteraction(interaction)) {
    handleAnnouncerInteraction(interaction).catch((error) => console.error("Announcer interaction failed:", error));
    return;
  }
  // 👍 / 🔕 on DM reminders
  if (isReminderInteraction(interaction)) {
    handleReminderInteraction(interaction).catch((error) => console.error("DM reminder interaction failed:", error));
    return;
  }

  handleInteractions(interaction);
  handleInteractionCreate(interaction); // Also track for stats
});

// Handle new members
client.on("guildMemberAdd", handleGuildMemberAdd);

// Handle member updates (role changes)
client.on("guildMemberUpdate", handleGuildMemberUpdate);
client.on("guildMemberRemove", (member) => {
  if (member.guild.id === config.discord.guildId) {
    streaming.remove(member.id).catch(() => console.warn("Could not revoke streaming enrollment for departed member."));
  }
});

// Handle activity for stats collection
client.on("messageCreate", async (message) => {
  handleMessageCreate(message);
  handleZwiftIdMessage(message); // Also check for Zwift ID linking
  handleAnnouncementUpsert(message); // Keep the announcement search index current
  await handleAIChatMessage(message, client); // Also check for AI chat requests
});
client.on("messageUpdate", (_oldMessage, message) => handleAnnouncementUpsert(message));
client.on("messageDelete", (message) => handleAnnouncementDelete(message));
client.on("voiceStateUpdate", handleVoiceStateUpdate);

// Bot ready event
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  
  // Set bot status/presence
  client.user.setPresence({
    activities: [{
      name: 'Zwift | Avoiding headwinds since 2014 💨',
      type: 0 // PLAYING
    }],
    status: 'online'
  });
  
  // Start the message scheduler
  startScheduler(client);
  streaming.start();
});

// Graceful shutdown handling.
// Render allows 30 seconds between SIGTERM and SIGKILL by default. Open coach conversations are
// summarised with an OpenAI call each, which takes far longer than the old 2-second exit.
const SHUTDOWN_STATS_MS = 2000;
const SHUTDOWN_MAX_MS = 20000;
let shuttingDown = false;

async function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  streaming.stop();
  console.log('🔄 Graceful shutdown initiated...');
  forceSaveStats();
  const statsGrace = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_STATS_MS));
  const flush = flushAllCoachSessions()
    .then((count) => { if (count) console.log(`🚴 Flushed ${count} coach conversation(s)`); })
    .catch((err) => console.error('Coach session flush failed:', err?.message || err));
  const cap = new Promise((resolve) => setTimeout(() => {
    console.warn('⏱️ Shutdown cap reached before coach sessions finished flushing');
    resolve();
  }, SHUTDOWN_MAX_MS));
  await Promise.race([Promise.all([statsGrace, flush]), cap]);
  console.log('👋 Bot shutting down');
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Start the club bot. DZR Coach is a second client (DMs only; no slash commands).
/**
 * Verify the coach encryption key before the coach bot can write anything.
 *
 * Failing closed on a *missing* key only proves a key exists. The failure that actually corrupts
 * data is Vercel and Render both holding a key and holding different ones, so each writes coach
 * memory the other cannot read. Decrypting a stored canary catches that.
 *
 * A wrong key is fatal: starting would write new memory under it and deepen the split. Firestore
 * simply being unreachable is not - crashing on that would produce a restart loop over a blip.
 */
async function verifyCoachKeyOrExit() {
  const result = await checkCoachKeyCanary();
  if (result.status === "mismatch") {
    console.error(
      "FATAL: COACH_MEMORY_KEY does not match the key existing coach memory was encrypted with.\n" +
      "Starting would write new memory under a second key and make current memory unreadable.\n" +
      "Check that Vercel and Render hold the same COACH_MEMORY_KEY, then restart."
    );
    process.exit(1);
  }
  if (result.status === "created") {
    console.log("Coach key canary created.");
  } else if (result.status === "unavailable") {
    console.warn("Coach key canary could not be checked (Firestore unavailable):", result.message);
  }
}

loadZwiftCatalog()
  .catch((err) => console.warn("Zwift catalog:", err?.message || err))
  .finally(() => startZwiftCatalogRefresh());

client.login(config.discord.token);

verifyCoachKeyOrExit()
  .then(startCoachBot)
  .catch((err) => {
    console.error("Coach key check failed unexpectedly:", err);
    process.exit(1);
  }); 
