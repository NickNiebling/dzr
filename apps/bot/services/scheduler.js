const { createMemberSnapshotCheck } = require('./memberSnapshotSchedule');
const { saveMemberSnapshot } = require('./contentApi');
const checkMemberSnapshot = createMemberSnapshotCheck(saveMemberSnapshot);
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getDueScheduledMessages, getProbabilitySelectedMessages, markScheduledMessageSent, processMessageContent, refreshClubRoster, refreshZwiftPowerRoster, fixDueFiftyResults, applyDueWeeklySeries } = require("./contentApi");
const { sweepGuildForNewMembers } = require("./newMemberService");
const config = require("../config/config");
const { getBotState, setBotState } = require("./firebase");
const { syncZpRolesForGuild } = require("./zpRoleSync");
const { maybePostScheduledQuiz } = require("./quizService");
const { maybeSendCoachFollowUps } = require("./coachFollowUp");
const { maybeRunLadderJobs } = require("./ladder/ladderJobs");

/**
 * Check for and send scheduled messages (both time-based and probability-based)
 */
async function checkScheduledMessages(client) {
  try {
    console.log("🔍 Checking for scheduled messages...");
    
    // Check time-based scheduled messages
    await checkTimeBasedMessages(client);
    
    // Check probability-based messages (only once per day)
    await checkProbabilityBasedMessages(client);
    
    // Sweep New Member role assignments once per hour
    await checkNewMemberSweeps(client);
    // Update KMS status message periodically
    await updateKmsStatus(client);

    // Refresh Zwift club roster once per day (via backend Content API)
    await checkClubRosterRefresh();

    // Refresh ZwiftPower club roster once per day (via backend Content API)
    await checkZwiftPowerRosterRefresh();

    await checkWeeklySeriesApply(client);
    await checkFiftyResultsFix(client);

    // Assign ZwiftPower pace-group roles once per day (add-only)
    await checkZpRoleSync(client);

    // Occasional Zwift route quiz (daily probability roll)
    await maybePostScheduledQuiz(client);

    await maybeSendCoachFollowUps();

    // Ladder match previews and match-day reminders. Not awaited: rendering the preview can take
    // several seconds and must not delay the other minute checks; it does its own error handling.
    maybeRunLadderJobs(client);
    
  } catch (error) {
    console.error("❌ Error checking scheduled messages:", error);
  }
}

/**
 * Assign ZP pace-group roles once per day at configured time.
 * Add-only: we never remove roles; users can self-remove older pace roles.
 */
async function checkZpRoleSync(client) {
  try {
    const tz = config.zpRoleSync?.tz || "Europe/Paris";
    const targetHour = Number.isFinite(config.zpRoleSync?.hour) ? config.zpRoleSync.hour : 4;
    const targetMinute = Number.isFinite(config.zpRoleSync?.minute) ? config.zpRoleSync.minute : 5;

    const now = new Date();
    const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const hh = local.getHours();
    const mm = local.getMinutes();
    if (hh !== targetHour || mm !== targetMinute) return;

    const pad2 = (n) => String(n).padStart(2, "0");
    const todayKey = `${local.getFullYear()}-${pad2(local.getMonth() + 1)}-${pad2(local.getDate())}`;

    // Run per guild, once per day.
    for (const guild of client.guilds.cache.values()) {
      const stateKey = `zp_role_sync_${guild.id}`;
      const existing = await getBotState(stateKey);
      if (existing?.lastRunDate === todayKey) continue;

      // If no role IDs configured, don't spam logs every day; just store a state marker.
      const hasAnyRoleConfig = !!(config.zpRoles?.A || config.zpRoles?.B || config.zpRoles?.C || config.zpRoles?.D);
      if (!hasAnyRoleConfig) {
        await setBotState(stateKey, {
          lastRunDate: todayKey,
          lastResult: { ok: false, reason: "missing_role_config" },
          updatedAt: new Date().toISOString(),
        });
        continue;
      }

      console.log(`🔄 Syncing ZP pace roles for guild ${guild.name} (${guild.id})...`);
      const result = await syncZpRolesForGuild(guild);

      await setBotState(stateKey, {
        lastRunDate: todayKey,
        lastResult: result || null,
        updatedAt: new Date().toISOString(),
      });

      console.log("✅ ZP pace role sync completed:", result);
    }
  } catch (error) {
    console.error("❌ Error syncing ZP pace roles:", error?.message || error);
  }
}

/**
 * Refresh Zwift club roster once per day at a configured time (default 04:00 Europe/Paris).
 * Uses bot_state to ensure we only run once per day even though scheduler ticks every minute.
 */
async function checkClubRosterRefresh() {
  try {
    const tz = process.env.CLUB_ROSTER_REFRESH_TZ || "Europe/Paris";
    const targetHour = Number.parseInt(process.env.CLUB_ROSTER_REFRESH_HOUR || "4", 10);
    const targetMinute = Number.parseInt(process.env.CLUB_ROSTER_REFRESH_MINUTE || "0", 10);

    const now = new Date();
    const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const hh = local.getHours();
    const mm = local.getMinutes();

    // Build YYYY-MM-DD in the target timezone (no UTC conversion)
    const pad2 = (n) => String(n).padStart(2, "0");
    const todayKey = `${local.getFullYear()}-${pad2(local.getMonth() + 1)}-${pad2(local.getDate())}`;

    // Only run during the exact minute
    if (hh !== targetHour || mm !== targetMinute) return;

    const stateKey = `club_roster_refresh_default`;
    const existing = await getBotState(stateKey);
    if (existing?.lastRunDate === todayKey) return;

    console.log(`🔄 Refreshing Zwift club roster (tz=${tz}, date=${todayKey})...`);
    const result = await refreshClubRoster();

    await setBotState(stateKey, {
      lastRunDate: todayKey,
      lastResult: result || null,
      updatedAt: new Date().toISOString(),
    });

    console.log("✅ Club roster refresh completed:", result);
  } catch (error) {
    console.error("❌ Error refreshing club roster:", error?.message || error);
  }
}

/**
 * Refresh ZwiftPower club roster once per day at configured time.
 * Defaults to the same schedule as the companion club roster refresh.
 */
async function checkZwiftPowerRosterRefresh() {
  try {
    const tz = process.env.ZWIFTPOWER_ROSTER_REFRESH_TZ || process.env.CLUB_ROSTER_REFRESH_TZ || "Europe/Paris";
    const targetHour = Number.parseInt(process.env.ZWIFTPOWER_ROSTER_REFRESH_HOUR || process.env.CLUB_ROSTER_REFRESH_HOUR || "4", 10);
    const targetMinute = Number.parseInt(process.env.ZWIFTPOWER_ROSTER_REFRESH_MINUTE || process.env.CLUB_ROSTER_REFRESH_MINUTE || "0", 10);

    const now = new Date();
    const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const hh = local.getHours();
    const mm = local.getMinutes();

    const pad2 = (n) => String(n).padStart(2, "0");
    const todayKey = `${local.getFullYear()}-${pad2(local.getMonth() + 1)}-${pad2(local.getDate())}`;

    if (hh !== targetHour || mm !== targetMinute) return;

    const stateKey = `zwiftpower_roster_refresh_default`;
    const existing = await getBotState(stateKey);
    if (existing?.lastRunDate === todayKey) return;

    console.log(`🔄 Refreshing ZwiftPower club roster (tz=${tz}, date=${todayKey})...`);
    const result = await refreshZwiftPowerRoster();

    await setBotState(stateKey, {
      lastRunDate: todayKey,
      lastResult: result || null,
      updatedAt: new Date().toISOString(),
    });

    console.log("✅ ZwiftPower roster refresh completed:", result);
  } catch (error) {
    console.error("❌ Error refreshing ZwiftPower roster:", error?.message || error);
  }
}

function copenhagenClock() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Copenhagen" }));
}

function onTheHalfHour() {
  return copenhagenClock().getMinutes() % 30 === 0;
}

async function dmEventEditor(client, text) {
  const id = String(process.env.ZWIFT_EVENT_EDITOR_DISCORD_ID || "").trim();
  if (!id) {
    console.error("❌ ZWIFT_EVENT_EDITOR_DISCORD_ID is not set");
    return false;
  }
  const user = await client.users.fetch(id);
  await user.send(text);
  return true;
}

async function dmOnce(client, key, text) {
  const existing = await getBotState(key);
  if (existing?.message === text) return;
  const sent = await dmEventEditor(client, text);
  if (!sent) return;
  await setBotState(key, { message: text, updatedAt: new Date().toISOString() });
}

function jobErrorMessage(error) {
  return error?.response?.data?.error || error?.message || "Request failed";
}

function routeDm(job) {
  if (job?.status === "applied") {
    const text = `${job.name} route updated: ${job.label || job.date}, ${job.route}.`;
    if (job.channelPost === false) return text;
    const post = job.discordError ? `Discord post failed: ${job.discordError}` : "Discord post sent.";
    return `${text} ${post}`;
  }
  if (job?.status === "error") return `${job.name || "Weekly series"} route update failed: ${job.message || "Route update failed"}`;
  return "";
}

/**
 * Twice an hour, apply a weekly route once 24 hours have passed and Zwift has created the event.
 * A missing event stays quiet.
 */
async function checkWeeklySeriesApply(client) {
  try {
    if (!onTheHalfHour()) return;
    const result = await applyDueWeeklySeries();
    for (const job of result?.jobs || []) {
      const text = routeDm(job);
      if (!text) continue;
      const key = `weekly_route_${job.series || "series"}_${job.date || "none"}`;
      await dmOnce(client, key, text);
    }
  } catch (error) {
    const message = jobErrorMessage(error);
    console.error("❌ Error applying weekly series routes:", message);
    await dmOnce(client, "weekly_route_error", `Weekly series route update failed: ${message}`).catch((dmError) => {
      console.error("❌ Could not DM the event editor:", dmError?.message || dmError);
    });
  }
}

function sprintDm(row) {
  if (!row || row.pending) return "";
  const unmatched = (row.sprints || []).filter((sprint) => !sprint.matched).map((sprint) => sprint.name).filter(Boolean);
  if (unmatched.length) return `The Zwifty Fifty sprint setup failed. ZwiftPower has no segment named ${unmatched.join(", ")}.`;
  if (!row.updated) return "";
  const count = row.updated.length;
  return count
    ? `The Zwifty Fifty sprints were set (${count}).`
    : "The Zwifty Fifty sprints were checked. No sprints to set.";
}

function categoryDm(row) {
  if (!row) return "";
  if (row.expired && row.pending) return "The Zwifty Fifty categories were not moved. ZwiftPower had no results within 4 hours of the start.";
  if (row.pending) return "";
  const moved = Array.isArray(row.updated) ? row.updated.length : (row.changes || []).length;
  return moved
    ? `The Zwifty Fifty categories moved ${moved} rider${moved === 1 ? "" : "s"} off WKG.`
    : "The Zwifty Fifty categories were checked. No WKG riders to move.";
}

/**
 * Twice an hour, move WKG finishers from 1.5 to 4 hours after the Fifty starts,
 * and set sprints about a day after Apply. The API decides whether a race is due.
 */
async function checkFiftyResultsFix(client) {
  try {
    if (!onTheHalfHour()) return;
    const result = await fixDueFiftyResults();
    for (const row of result?.categories?.results || []) {
      const text = categoryDm(row);
      if (!text) continue;
      const key = row.expired ? `weekly_categories_expired_${row.eventId}` : `weekly_categories_${row.eventId}`;
      await dmOnce(client, key, text);
    }
    for (const row of result?.sprints?.results || []) {
      const text = sprintDm(row);
      if (!text) continue;
      const unmatched = (row.sprints || []).some((sprint) => !sprint.matched);
      const key = unmatched ? `weekly_sprints_mismatch_${row.eventId}` : `weekly_sprints_${row.eventId}`;
      await dmOnce(client, key, text);
    }
  } catch (error) {
    const message = jobErrorMessage(error);
    console.error("❌ Error fixing Zwifty Fifty categories:", message);
    await dmOnce(client, "weekly_fix_due_error", `The Zwifty Fifty ZwiftPower update failed: ${message}`).catch((dmError) => {
      console.error("❌ Could not DM the event editor:", dmError?.message || dmError);
    });
  }
}

/**
 * Check for time-based scheduled messages (existing functionality)
 */
async function checkTimeBasedMessages(client) {
  try {
    console.log("🕐 Checking time-based scheduled messages...");
    const dueMessages = await getDueScheduledMessages();
    
    console.log(`📋 Found ${dueMessages.length} due time-based messages`);
    
    if (dueMessages.length === 0) {
      console.log("✅ No time-based scheduled messages due at this time");
      return;
    }
    
    for (const scheduledMessage of dueMessages) {
      console.log(`📤 Processing time-based scheduled message: ${scheduledMessage.title} (ID: ${scheduledMessage.id})`);
      await sendScheduledMessage(client, scheduledMessage);
    }
  } catch (error) {
    console.error("❌ Error checking time-based scheduled messages:", error);
  }
}

let lastNewMemberSweepHour = null;
/** messageId for the KMS status post. Cleared when an edit fails so the next attempt re-reads bot_state. */
let cachedKmsMessage = null;

async function readKmsMessageId(stateKey) {
  const existing = await getBotState(stateKey);
  const messageId = existing?.messageId || null;
  if (messageId) cachedKmsMessage = { stateKey, messageId };
  return messageId;
}

function rememberKmsMessageId(stateKey, messageId) {
  if (messageId) cachedKmsMessage = { stateKey, messageId };
}

async function currentKmsMessageId(stateKey) {
  if (cachedKmsMessage?.stateKey === stateKey && cachedKmsMessage.messageId) {
    return cachedKmsMessage.messageId;
  }
  return readKmsMessageId(stateKey);
}

async function checkNewMemberSweeps(client) {
  try {
    const now = new Date();
    const currentHour = now.getUTCHours();
    if (currentHour === lastNewMemberSweepHour) return; // once per hour
    lastNewMemberSweepHour = currentHour;

    for (const guild of client.guilds.cache.values()) {
      await sweepGuildForNewMembers(guild);
    }
  } catch (error) {
    console.error("❌ Error running New Member sweep:", error);
  }
}

// KMS status updater (countdown + signup count)
async function updateKmsStatus(client) {
  try {
    const channelId = config.kms?.channelId || process.env.KMS_CHANNEL_ID || "1413820948536365190";
    const roleId = config.kms?.roleId || process.env.KMS_ROLE_ID || "1413793742808416377";
    const eventIso = config.kms?.eventIso || process.env.KMS_EVENT_ISO; // e.g., 2025-10-28T18:30:00Z

    if (!channelId || !roleId) return; // Not configured

    const now = new Date();

    const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.guild) return;

    // Ensure member cache is populated for accurate role counts
    await channel.guild.members.fetch();

    // Count members with the KMS role from the latest member cache
    const signupCount = channel.guild.members.cache.filter(m => m.roles.cache.has(roleId)).size;

    // Build countdown
    let countdownLine = "";
    if (eventIso) {
      const eventDate = new Date(eventIso);
      const diffMs = eventDate.getTime() - now.getTime();
      const absMs = Math.abs(diffMs);
      const days = Math.floor(absMs / (24 * 3600 * 1000));
      const hours = Math.floor((absMs % (24 * 3600 * 1000)) / (3600 * 1000));
      const minutes = Math.floor((absMs % (3600 * 1000)) / (60 * 1000));
      const prefix = diffMs >= 0 ? "⏳ Countdown" : "✅ Event started";
      const human = `${days}d ${hours}t ${minutes}m`;
      countdownLine = `${prefix}: ${human}`;
    }

    const contentLines = [
      "🏆 DZR Klubmesterskab - tirsdag 28. oktober 19:30🏆",
      countdownLine,
      `📝 Signups: ${signupCount}`,
      "Se tilmeldte: [link](<https://www.dzrracingseries.com/members-zone/klubmesterskab>)",
      "Tilmeld/afmeld dig her:",
    ].filter(Boolean);
    const content = contentLines.join("\n");

    // Build signup toggle button (single button)
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`kms_toggle_role_${roleId}`)
        .setLabel("Tilmeld/afmeld")
        .setStyle(ButtonStyle.Primary)
    );

    // No extra embeds needed; show masked link in content

    // Retrieve existing status message ID. The countdown still edits every minute;
    // Firestore is only needed to find that message.
    const stateKey = `kms_status_${channel.guild.id}_${channel.id}`;
    let messageId = await currentKmsMessageId(stateKey);

    try {
      if (messageId) {
        const msg = await channel.messages.fetch(messageId);
        await msg.edit({ content, components: [row1] });
      } else {
        const sent = await channel.send({ content, components: [row1] });
        messageId = sent.id;
        await setBotState(stateKey, { messageId });
        rememberKmsMessageId(stateKey, messageId);
      }
    } catch (e) {
      // The cached id may be stale. Re-read before posting a replacement, and keep merge
      // writes so unrelated fields such as linkMessageId stay on the doc.
      cachedKmsMessage = null;
      const refreshed = await readKmsMessageId(stateKey);
      if (refreshed && refreshed !== messageId) {
        try {
          const msg = await channel.messages.fetch(refreshed);
          await msg.edit({ content, components: [row1] });
          return;
        } catch {
          cachedKmsMessage = null;
        }
      }
      try {
        const sent = await channel.send({ content, components: [row1] });
        messageId = sent.id;
        await setBotState(stateKey, { messageId });
        rememberKmsMessageId(stateKey, messageId);
      } catch (sendErr) {
        cachedKmsMessage = null;
        console.error("❌ Failed to send KMS status message:", sendErr.message);
      }
    }
  } catch (error) {
    console.error("❌ Error updating KMS status:", error);
  }
}

/**
 * Check for probability-based messages (once per day)
 */
async function checkProbabilityBasedMessages(client) {
  try {
    // Get current time in Central European Time
    const now = new Date();
    const cetTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/Paris"}));
    const currentHour = cetTime.getHours();
    const currentMinute = cetTime.getMinutes();
    
    // Check probability messages at 2:00 PM CET
    const PROBABILITY_CHECK_HOUR = 16;
    const PROBABILITY_CHECK_MINUTE = 30;
    
    // Only run during the specific minute to avoid multiple checks
    if (currentHour === PROBABILITY_CHECK_HOUR && currentMinute === PROBABILITY_CHECK_MINUTE) {
      console.log("🎲 Checking probability-based scheduled messages... (CET)");
      const selectedMessages = await getProbabilitySelectedMessages();
      
      console.log(`📋 Found ${selectedMessages.length} probability-selected messages`);
      
      if (selectedMessages.length === 0) {
        console.log("✅ No probability-based messages selected for today");
        return;
      }
      
      for (const scheduledMessage of selectedMessages) {
        console.log(`📤 Processing probability-selected message: ${scheduledMessage.title} (ID: ${scheduledMessage.id})`);
        await sendScheduledMessage(client, scheduledMessage);
      }
    } else {
      // Log only once per hour to avoid spam
      if (currentMinute === 0) {
        console.log(`🎲 Probability check scheduled for ${PROBABILITY_CHECK_HOUR}:${PROBABILITY_CHECK_MINUTE.toString().padStart(2, '0')} CET (current CET: ${currentHour}:${currentMinute.toString().padStart(2, '0')})`);
      }
    }
  } catch (error) {
    console.error("❌ Error checking probability-based scheduled messages:", error);
  }
}

/**
 * Send a scheduled message
 */
async function sendScheduledMessage(client, scheduledMessage) {
  try {
    console.log(`🎯 Attempting to send message "${scheduledMessage.title}" to channel ${scheduledMessage.channel_id}`);
    
    const channel = client.channels.cache.get(scheduledMessage.channel_id);
    if (!channel) {
      console.error(`❌ Channel ${scheduledMessage.channel_id} not found for scheduled message ${scheduledMessage.id}`);
      return;
    }

    console.log(`✅ Found channel: #${channel.name} in ${channel.guild.name}`);

    // Process message content
    const variables = {
      server_name: channel.guild.name,
      channel_name: channel.name,
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString()
    };

    const content = processMessageContent(scheduledMessage.content, variables);
    console.log(`📝 Processed message content: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);

    // Build message object
    const messageOptions = { content };

    // Add embed if configured
    if (scheduledMessage.embed) {
      const embed = new EmbedBuilder()
        .setTitle(processMessageContent(scheduledMessage.embed.title || "", variables))
        .setDescription(processMessageContent(scheduledMessage.embed.description || "", variables))
        .setColor(scheduledMessage.embed.color || 0x0099FF);

      if (scheduledMessage.embed.footer) {
        embed.setFooter({ 
          text: processMessageContent(scheduledMessage.embed.footer, variables) 
        });
      }

      messageOptions.embeds = [embed];
      console.log(`🎨 Added embed to message`);
    }

    // Send the message
    console.log(`🚀 Sending message to Discord...`);
    await channel.send(messageOptions);
    console.log(`✅ Message sent successfully to #${channel.name}`);
    
    // Mark as sent
    console.log(`📋 Marking message ${scheduledMessage.id} as sent...`);
    await markScheduledMessageSent(scheduledMessage.id);
    console.log(`✅ Message ${scheduledMessage.id} marked as sent`);
    
    console.log(`🎉 Completed scheduled message: ${scheduledMessage.title}`);

  } catch (error) {
    console.error(`❌ Error sending scheduled message "${scheduledMessage.title}":`, error);
    console.error(`   Message ID: ${scheduledMessage.id}`);
    console.error(`   Channel ID: ${scheduledMessage.channel_id}`);
  }
}

/**
 * Start the scheduler (runs every minute)
 */
function startScheduler(client) {
  console.log("🚀 Starting message scheduler...");
  
  // Check immediately
  checkScheduledMessages(client);
  void checkMemberSnapshot();
  
  // Then check every minute
  setInterval(() => {
    checkScheduledMessages(client);
    void checkMemberSnapshot();
  }, 60000); // 1 minute
  
  console.log("✅ Message scheduler started - checking every minute");
}

module.exports = {
  startScheduler,
  checkScheduledMessages,
  updateKmsStatus,
}; 