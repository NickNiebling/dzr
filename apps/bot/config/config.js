require("dotenv").config();
const fs = require("fs");
const path = require("path");
const shared = require("../constants.json");

// The website keeps the DCU club-API login in the repo-root .env.local.
// Use it for a local bot when the process does not already have the vars. Never override.
function fillDcuClubLogin() {
  const keys = ["DCU_E_SERIE_USERNAME", "DCU_E_SERIE_SECRET"];
  if (keys.every((key) => String(process.env[key] || "").trim())) return;
  let text = "";
  try {
    text = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(DCU_E_SERIE_USERNAME|DCU_E_SERIE_SECRET)\s*=\s*(.*)\s*$/);
    if (!match || String(process.env[match[1]] || "").trim()) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}
fillDcuClubLogin();

module.exports = {
  discord: {
    token: process.env.DISCORD_BOT_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    // Silent second bot (DZR Coach). DMs only — do not reuse NextAuth DISCORD_CLIENT_ID.
    coachToken: process.env.COACH_BOT_TOKEN || null,
    coachClientId: process.env.COACH_BOT_CLIENT_ID || null,
    guildId: process.env.DISCORD_GUILD_ID || shared.discord.guildId,
    welcomeChannelId: process.env.DISCORD_WELCOME_CHANNEL_ID, // Optional: specific welcome channel
    approvalChannelId: process.env.DISCORD_APPROVAL_CHANNEL_ID, // Optional: channel for role approval requests
  },
  zpRoles: {
    // ZwiftPower Pace Group roles (Discord role IDs)
    // Map ZP categories -> Discord roles. A and A+ typically share one "A/A+" role.
    D: process.env.ZP_ROLE_D || null,
    C: process.env.ZP_ROLE_C || null,
    B: process.env.ZP_ROLE_B || null,
    A: process.env.ZP_ROLE_A || null,
  },
  zpRoleSync: {
    // Daily sync schedule (defaults: 07:00 Europe/Paris)
    tz: process.env.ZP_ROLE_SYNC_TZ || "Europe/Paris",
    hour: Number.parseInt(process.env.ZP_ROLE_SYNC_HOUR || "7", 10),
    minute: Number.parseInt(process.env.ZP_ROLE_SYNC_MINUTE || "0", 10),
  },
  kms: {
    channelId: process.env.KMS_CHANNEL_ID, // Discord channel ID for Klubmesterskab updates
    roleId: process.env.KMS_ROLE_ID || shared.discord.roles.kms, // Klubmesterskab role ID
    eventIso: process.env.KMS_EVENT_ISO, // ISO datetime for event start, e.g., 2025-10-28T18:30:00Z (19:30 CET)
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  },
  server: {
    port: Number.parseInt(process.env.PORT || "3000", 10),
    keepAliveUrl:
      process.env.RENDER_EXTERNAL_URL ||
      process.env.KEEP_ALIVE_URL ||
      "https://bot-tdnm.onrender.com",
    keepAliveInterval: 24 * 60 * 60 * 1000, // 24 hours. Not needed anymore. Remove at some point
  },
  contentApi: {
    baseUrl: process.env.CONTENT_API_BASE_URL, // Your Google Cloud Function URL
    apiKey: process.env.CONTENT_API_KEY,       // API key for authentication
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,        // OpenAI API key for AI chat features
  },
  intervals: {
    connectSecret: process.env.COACH_CONNECT_SECRET,
    siteOrigin: process.env.INTERVALS_CONNECT_BASE_URL || shared.siteOrigin,
  },
  ladder: {
    // Previews and match-day reminders for ladder matches are posted here.
    channelId: process.env.LADDER_CHANNEL_ID || "1382817917984313404",
    previewMinutes: Number.parseInt(process.env.LADDER_PREVIEW_MINUTES || "65", 10),
    tz: process.env.LADDER_TZ || "Europe/Copenhagen",
  },
  errorDigest: {
    // An explicit empty value disables Discord delivery. Counts still reach Firestore.
    channelId: (process.env.ERROR_DIGEST_CHANNEL_ID ?? "1544209256100794378").trim(),
  },
  quiz: {
    channelId: process.env.QUIZ_CHANNEL_ID || "1353477785674453104",
    tz: process.env.QUIZ_TZ || "Europe/Paris",
    hour: Number.parseInt(process.env.QUIZ_HOUR || "18", 10),
    minute: Number.parseInt(process.env.QUIZ_MINUTE || "0", 10),
    probability: Number.parseFloat(process.env.QUIZ_PROBABILITY || "0.4"),
  },
}; 
