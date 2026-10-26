const Sentry = require("./sentry");
const { Client, GatewayIntentBits, ActivityType, Partials } = require("discord.js");
const config = require("../config/config");

let coachClient = null;
let coachReady = Promise.resolve(null);

function isCoachBotConfigured() {
  return Boolean(config.discord.coachToken);
}

function getCoachClientSync() {
  return coachClient;
}

async function getCoachClient() {
  if (!coachClient) return null;
  try {
    await coachReady;
  } catch (err) {
    console.warn("DZR Coach login failed:", err?.message || err);
    return null;
  }
  return coachClient;
}

function startCoachBot() {
  if (!config.discord.coachToken) {
    console.warn("⚠️ DZR Coach skipped: COACH_BOT_TOKEN is not set");
    return null;
  }

  const { handleCoachChatMessage } = require("../handlers/aiChatHandler");
  const { handleCoachGoalButton } = require("./coachGoalConfirm");
  const { recordCoachFeedback } = require("./coachFeedback");

  coachClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
    // Message and Reaction partials so 👍/👎 on an older reply still registers; Channel so DMs
    // arrive at all.
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  });

  coachClient.on("error", (error) => Sentry.captureException(error));

  coachClient.on("messageCreate", async (message) => {
    try {
      await handleCoachChatMessage(message, coachClient);
    } catch (err) {
      console.error("DZR Coach message handler failed:", err);
    }
  });

  // Partials are required: a reaction on a message from before this process started arrives
  // uncached, and would otherwise be silently dropped.
  coachClient.on("messageReactionAdd", async (reaction, user) => {
    try {
      if (reaction.partial) await reaction.fetch();
      await recordCoachFeedback(reaction, user);
    } catch (err) {
      console.warn("DZR Coach reaction handler failed:", err?.message || err);
    }
  });

  coachClient.on("interactionCreate", async (interaction) => {
    try {
      await handleCoachGoalButton(interaction);
    } catch (err) {
      console.error("DZR Coach goal button failed:", err);
    }
  });

  coachClient.once("ready", () => {
    console.log(`✅ DZR Coach logged in as ${coachClient.user.tag}`);
    coachClient.user.setPresence({
      activities: [{ name: "your training", type: ActivityType.Listening }],
      status: "online",
    });
  });

  coachReady = coachClient.login(config.discord.coachToken).catch((err) => {
    console.error("❌ DZR Coach failed to login:", err);
    throw err;
  });

  return coachClient;
}

module.exports = {
  startCoachBot,
  getCoachClient,
  getCoachClientSync,
  isCoachBotConfigured,
};
