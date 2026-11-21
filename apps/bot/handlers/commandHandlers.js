const axios = require("axios");
const { AttachmentBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { generatePowerLineGraph, generatePowerLineGraph2 } = require("../utils/powerGraph");
const { generateSingleRiderStatsImage, generateTeamStatsImage, generateEventResultsImage } = require("../utils/imageGenerator");
const { phenotypeLabel } = require("../utils/phenotype");
const { getUserZwiftId, linkUserZwiftId, searchRidersByName, getTodaysClubStats } = require("../services/firebase");
const { ephemeralReplyWithPublish } = require("../utils/ephemeralStore");
const { refreshClubRoster, refreshZwiftPowerRoster } = require("../services/contentApi");
const config = require("../config/config");
const { syncZpRolesForGuild } = require("../services/zpRoleSync");
const { checkVerificationAfterZwiftLink } = require("./memberHandler");
const { prepareZwiftIdConfirmation, sendConfirmation } = require("./zwiftIdMessageHandler");
const { findRidersByName, buildRiderSearchReply } = require("../services/riderSearch");
const { MessageFlags } = require("discord.js");
const { postSignupBoard, repostSignupBoard } = require("../services/signupService");

async function handleMyZwiftId(interaction) {
  const zwiftID = interaction.options.getString("zwiftid");
  const searchTerm = interaction.options.getString("searchterm");
  const discordID = interaction.user.id;

  if (zwiftID) {
    // Show who the ID belongs to; linking happens on the confirm button.
    try {
      const payload = await prepareZwiftIdConfirmation(discordID, zwiftID);
      await sendConfirmation((p) => interaction.editReply(p), payload);
    } catch (error) {
      console.error("❌ my_zwiftid confirm Error:", error);
      await interaction.editReply({ content: "⚠️ Error looking up your ZwiftID." });
    }
    return;
  }

  if (searchTerm) {
    // DZR club riders first, then all of ZwiftPower; picking a rider opens the confirm card.
    const term = searchTerm.trim();
    const result = await findRidersByName(term, { discordId: discordID });
    await interaction.editReply(buildRiderSearchReply(discordID, term, result));
    return;
  }

  await ephemeralReplyWithPublish(interaction, "❌ Provide either `zwiftid:` or `searchterm:` to link.");
}

async function handleSetZwiftId(interaction) {
  const targetUser = interaction.options.getUser("discorduser");
  const directZwiftId = interaction.options.getString("zwiftid");
  const searchTerm = interaction.options.getString("searchterm");

  if (directZwiftId) {
    try {
      await linkUserZwiftId(targetUser.id, targetUser.username, directZwiftId);
      const content = `✅ Linked ZwiftID **${directZwiftId}** to ${targetUser.username}.`;
      await ephemeralReplyWithPublish(interaction, content);

      // Check verification status after linking ZwiftID
      await checkVerificationAfterZwiftLink(interaction.guild, targetUser.id);
    } catch (error) {
      console.error("❌ set_zwiftid Firebase Error:", error);
      await interaction.editReply({ content: "⚠️ Error saving ZwiftID." });
    }
    return;
  }

  if (searchTerm) {
    if (searchTerm.length < 3) {
      await ephemeralReplyWithPublish(interaction, "❌ Please provide at least 3 letters for search!");
      return;
    }

    const matchingRiders = await searchRidersByName(searchTerm);
    if (matchingRiders.length === 0) {
      await ephemeralReplyWithPublish(interaction, `❌ No riders found starting with "${searchTerm}".`);
      return;
    }

    const options = matchingRiders.slice(0, 25).map(r => ({
      label: r.name.slice(0, 100),
      description: `ZwiftID: ${r.riderId}`,
      value: r.riderId.toString()
    }));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("setzwift_select_" + targetUser.id)
        .setPlaceholder("Select the rider for " + targetUser.username)
        .addOptions(options)
    );

    await interaction.editReply({
      content: `**Found ${matchingRiders.length} riders** matching "${searchTerm}" for ${targetUser.username}. Select one:`,
      components: [row]
    });
    return;
  }

  await ephemeralReplyWithPublish(interaction, "❌ Provide either `zwiftid:` or `searchterm:` to link for the specified user.");
}

async function handleGetZwiftId(interaction) {
  try {
    const targetUser = interaction.options.getUser("discorduser");
    const zwiftId = await getUserZwiftId(targetUser.id);

    if (!zwiftId) {
      await ephemeralReplyWithPublish(
        interaction,
        `❌ ${targetUser.username} has not linked a ZwiftID yet.\n\n` +
        `Tell them to DM me their ZwiftID (numbers only) or the first 3+ letters of their Zwift name, and I’ll link it for them.`
      );
      return;
    }

    const content = `✅ ${targetUser.username}'s linked ZwiftID: ${zwiftId}`;
    await ephemeralReplyWithPublish(interaction, content);
  } catch (error) {
    console.error("❌ get_zwiftid Error:", error);
    await interaction.editReply({ content: "⚠️ Error fetching the ZwiftID." });
  }
}

async function handleRiderStats(interaction) {
  try {
    const zwiftIDOption = interaction.options.getString("zwiftid");
    const discordUser = interaction.options.getUser("discorduser");
    let zwiftID = zwiftIDOption;

    if (!zwiftID && discordUser) {
      zwiftID = await getUserZwiftId(discordUser.id);
      if (!zwiftID) {
        const message =
          `❌ **${discordUser.username}** has not linked their ZwiftID yet!\n\n` +
          `Tip: Ask them to DM me their ZwiftID (numbers only) or the first 3+ letters of their Zwift name, and I’ll link it for them.`;
        await ephemeralReplyWithPublish(interaction, message);
        return { success: false, message };
      }
    }

    if (!zwiftID) {
      const message = "❌ Provide a ZwiftID or mention a user who has linked one.";
      await ephemeralReplyWithPublish(interaction, message);
      return { success: false, message };
    }

    const response = await axios.get(`https://www.dzrracingseries.com/api/zr/rider/${zwiftID}`);
    const rider = response.data;

    if (!rider || !rider.name) {
      const message = `❌ No data found for ZwiftID **${zwiftID}**.`;
      await ephemeralReplyWithPublish(interaction, message);
      return { success: false, message };
    }

    const toNumber = (value) => {
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const computeWkg = (watts, weight) => {
      const wattsNum = toNumber(watts);
      const weightNum = toNumber(weight);
      if (wattsNum === null || weightNum === null || weightNum === 0) return null;
      return wattsNum / weightNum;
    };

    const riderSummary = {
      name: rider?.name ?? null,
      zwiftId: rider?.riderId ?? null,
      paceGroup: rider?.zpCategory ?? null,
      phenotype: phenotypeLabel(rider?.phenotype),
      velo: {
        category: rider?.race?.current?.mixed?.category ?? null,
        rating: toNumber(rider?.race?.current?.rating)
      },
      ftp: {
        watts: toNumber(rider?.zpFTP),
        wkg: computeWkg(rider?.zpFTP, rider?.weight)
      },
      power: {
        w30: {
          watts: toNumber(rider?.power?.w30),
          wkg: toNumber(rider?.power?.wkg30)
        },
        w60: {
          watts: toNumber(rider?.power?.w60),
          wkg: toNumber(rider?.power?.wkg60)
        },
        w300: {
          watts: toNumber(rider?.power?.w300),
          wkg: toNumber(rider?.power?.wkg300)
        },
        w1200: {
          watts: toNumber(rider?.power?.w1200),
          wkg: toNumber(rider?.power?.wkg1200)
        }
      },
      race: {
        finishes: toNumber(rider?.race?.finishes),
        wins: toNumber(rider?.race?.wins),
        podiums: toNumber(rider?.race?.podiums),
        dnfs: toNumber(rider?.race?.dnfs)
      }
    };

    const imageBuffer = await generateSingleRiderStatsImage(rider);
    const graphBuffer = await generatePowerLineGraph(rider);
    const graphBuffer2 = await generatePowerLineGraph2(rider);

    const attachment1 = new AttachmentBuilder(imageBuffer, { name: "rider_stats.png" });
    const attachment2 = new AttachmentBuilder(graphBuffer, { name: "power_graph.png" });
    const attachment3 = new AttachmentBuilder(graphBuffer2, { name: "power_graph2.png" });

    const zwiftPowerLink = `[${rider.name}](<https://www.zwiftpower.com/profile.php?z=${rider.riderId}>)`;
    const content = `ZwiftPower Profile: ${zwiftPowerLink}`;

    await ephemeralReplyWithPublish(interaction, content, [attachment1, attachment2, attachment3]);
    return {
      success: true,
      rider: riderSummary,
      metadata: {
        zwiftPowerUrl: `https://www.zwiftpower.com/profile.php?z=${rider.riderId}`
      }
    };
  } catch (error) {
    console.error("❌ rider_stats Error:", error);
    await interaction.editReply({ content: "⚠️ Error fetching or generating rider stats." });
    return {
      success: false,
      message: "Error fetching or generating rider stats.",
      error: error?.message
    };
  }
}

async function handleTeamStats(interaction) {
  try {
    const userMentions = [];
    for (let i = 1; i <= 8; i++) {
      const userOpt = interaction.options.getUser(`rider${i}`);
      if (userOpt) userMentions.push(userOpt);
    }

    if (userMentions.length === 0) {
      await ephemeralReplyWithPublish(interaction, "❌ You must mention at least one Discord user.");
      return;
    }

    const discordToZwiftMap = {};
    for (const userObj of userMentions) {
      const zwiftId = await getUserZwiftId(userObj.id);
      if (!zwiftId) {
        await ephemeralReplyWithPublish(
          interaction,
          `❌ **${userObj.username}** has not linked a ZwiftID yet!\n\n` +
          `Ask them to DM me their ZwiftID (numbers only) or the first 3+ letters of their Zwift name, and I’ll link it for them.`
        );
        return;
      }
      discordToZwiftMap[userObj.id] = zwiftId;
    }

    const allRiders = await getTodaysClubStats();
    if (!allRiders) {
      await ephemeralReplyWithPublish(interaction, "❌ No club_stats found for today!");
      return;
    }

    const ridersFound = [];
    for (const zID of Object.values(discordToZwiftMap)) {
      const found = allRiders.find(r => r.riderId === parseInt(zID));
      if (!found) {
        await ephemeralReplyWithPublish(interaction, `❌ ZwiftID ${zID} not found in today's club_stats data.`);
        return;
      }
      ridersFound.push(found);
    }

    const zPLinks = ridersFound
      .map(r => `[${r.name}](<https://www.zwiftpower.com/profile.php?z=${r.riderId}>)`)
      .join(" | ");

    // Build structured team summary for AI commentary
    const toNumber = (value) => {
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const computeWkg = (watts, weight) => {
      const wattsNum = toNumber(watts);
      const weightNum = toNumber(weight);
      if (wattsNum === null || weightNum === null || weightNum === 0) return null;
      return wattsNum / weightNum;
    };

    const teamSummary = ridersFound.map(r => ({
      name: r?.name ?? null,
      zwiftId: r?.riderId ?? null,
      paceGroup: r?.zpCategory ?? null,
      phenotype: phenotypeLabel(r?.phenotype),
      velo: {
        category: r?.race?.current?.mixed?.category ?? null,
        rating: toNumber(r?.race?.current?.rating)
      },
      ftp: {
        watts: toNumber(r?.zpFTP),
        wkg: computeWkg(r?.zpFTP, r?.weight)
      },
      power: {
        w30: { watts: toNumber(r?.power?.w30), wkg: toNumber(r?.power?.wkg30) },
        w60: { watts: toNumber(r?.power?.w60), wkg: toNumber(r?.power?.wkg60) },
        w300: { watts: toNumber(r?.power?.w300), wkg: toNumber(r?.power?.wkg300) },
        w1200: { watts: toNumber(r?.power?.w1200), wkg: toNumber(r?.power?.wkg1200) }
      },
      race: {
        finishes: toNumber(r?.race?.finishes),
        wins: toNumber(r?.race?.wins),
        podiums: toNumber(r?.race?.podiums),
        dnfs: toNumber(r?.race?.dnfs)
      }
    }));

    const imageBuffer = await generateTeamStatsImage(ridersFound);
    const graphBuffer = await generatePowerLineGraph(ridersFound);
    const graphBuffer2 = await generatePowerLineGraph2(ridersFound);

    const attachment1 = new AttachmentBuilder(imageBuffer, { name: "team_stats.png" });
    const attachment2 = new AttachmentBuilder(graphBuffer, { name: "power_graph.png" });
    const attachment3 = new AttachmentBuilder(graphBuffer2, { name: "power_graph2.png" });

    const content = `ZwiftPower Profiles: ${zPLinks}\n\n`;
    await ephemeralReplyWithPublish(interaction, content, [attachment1, attachment2, attachment3]);
    return {
      success: true,
      team: teamSummary
    };
  } catch (error) {
    console.error("❌ team_stats Error:", error);
    await interaction.editReply({ content: "⚠️ Error generating team stats comparison." });
    return { success: false, message: "Error generating team stats comparison.", error: error?.message };
  }
}

async function handleBrowseRiders(interaction) {
  try {
    const searchTerm = interaction.options.getString("searchterm") || "";
    if (searchTerm.length < 3) {
      await ephemeralReplyWithPublish(interaction, "❌ Please provide at least 3 letters.");
      return;
    }

    const matchingRiders = await searchRidersByName(searchTerm);
    if (matchingRiders.length === 0) {
      await ephemeralReplyWithPublish(interaction, `❌ No riders found starting with "${searchTerm}".`);
      return;
    }

    const options = matchingRiders.slice(0, 25).map(r => ({
      label: r.name.slice(0, 100),
      description: `ZwiftID: ${r.riderId}`,
      value: r.riderId.toString()
    }));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("select_rider")
        .setPlaceholder("Select a rider…")
        .addOptions(options)
    );

    await interaction.editReply({
      content: `**Found ${matchingRiders.length} riders** starting with "${searchTerm}". Select one:`,
      components: [row]
    });
  } catch (error) {
    console.error("❌ browse_riders Error:", error);
    await interaction.editReply({ content: "⚠️ Error fetching rider list." });
  }
}

async function handleEventResults(interaction) {
  try {
    const searchTerm = interaction.options.getString("search");
    if (!searchTerm || searchTerm.length < 3) {
      await ephemeralReplyWithPublish(interaction, "❌ Please provide at least 3 letters for the search string.");
      return;
    }

    const response = await axios.get(
      `${config.contentApi.baseUrl}/filter_events/11939?title=${encodeURIComponent(searchTerm)}`,
      { headers: { Authorization: `Bearer ${config.contentApi.apiKey}` } }
    );
    const data = response.data;

    if (!data.filtered_events || Object.keys(data.filtered_events).length === 0) {
      await ephemeralReplyWithPublish(interaction, `❌ No events found matching "${searchTerm}".`);
      return;
    }

    const imageBuffer = await generateEventResultsImage(data.filtered_events);
    const attachment = new AttachmentBuilder(imageBuffer, { name: "event_results.png" });

    await ephemeralReplyWithPublish(interaction, `Event Results for "${searchTerm}"`, [attachment]);
  } catch (error) {
    console.error("❌ event_results Error:", error);
    await interaction.editReply({ content: "⚠️ Error fetching event results." });
  }
}

async function handleWhoAmI(interaction) {
  try {
    const zwiftId = await getUserZwiftId(interaction.user.id);

    if (!zwiftId) {
      await ephemeralReplyWithPublish(
        interaction,
        "❌ You haven't linked a ZwiftID yet.\n\n" +
        "Just reply here with your ZwiftID (numbers only) or the first 3+ letters of your Zwift name, and I’ll link it for you."
      );
      return;
    }

    const content = `✅ Your linked ZwiftID: ${zwiftId}`;
    await ephemeralReplyWithPublish(interaction, content);
  } catch (error) {
    console.error("❌ whoami Error:", error);
    await interaction.editReply({ content: "⚠️ Error fetching your ZwiftID." });
  }
}

async function handlePostSignupBoard(interaction) {
  try {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.editReply({ content: "❌ This command is for administrators only." });
      return;
    }
    const channel = interaction.options.getChannel("channel") || interaction.channel;
    const configId = interaction.options.getString("config_id");

    if (!channel || channel.type !== 0 && channel.type !== 5 && channel.type !== 15) { // GuildText, Announcement, Forum ignored
      await interaction.editReply({ content: "❌ Please specify a text channel." });
      return;
    }
    const { message } = await postSignupBoard(channel, configId);
    await interaction.editReply({ content: `✅ Signup board posted in <#${channel.id}> (message ${message.id}).` });
  } catch (error) {
    console.error("❌ post_signup_board Error:", error);
    await interaction.editReply({ content: "⚠️ Error posting signup board: " + (error.message || "Unknown error") });
  }
}

async function handleRepostSignupBoard(interaction) {
  try {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.editReply({ content: "❌ This command is for administrators only." });
      return;
    }
    const channel = interaction.options.getChannel("channel") || interaction.channel;
    const configId = interaction.options.getString("config_id");
    if (!channel || channel.type !== 0 && channel.type !== 5 && channel.type !== 15) {
      await interaction.editReply({ content: "❌ Please specify a text channel." });
      return;
    }
    const { message } = await repostSignupBoard(channel, configId);
    await interaction.editReply({ content: `✅ Signup board reposted in <#${channel.id}> (message ${message.id}).` });
  } catch (error) {
    console.error("❌ repost_signup_board Error:", error);
    await interaction.editReply({ content: "⚠️ Error reposting signup board: " + (error.message || "Unknown error") });
  }
}

/**
 * /new_members
 * Mention members who joined within N days and currently have a specified role
 */
async function handleNewMembers(interaction) {
  try {
    // Admin-only guard
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.editReply({ content: "❌ This command is for administrators only." });
      return;
    }

    const withinDays = interaction.options.getInteger("within_days") ?? 7;
    const role = interaction.options.getRole("role");

    // Ensure we have member cache
    await interaction.guild.members.fetch();

    const now = Date.now();
    const threshold = now - withinDays * 24 * 60 * 60 * 1000;

    // Filter: joined within window AND has specified role
    const matching = interaction.guild.members.cache.filter(m => {
      const joinedTs = m.joinedTimestamp ?? 0;
      return joinedTs >= threshold && m.roles.cache.has(role.id);
    });

    if (matching.size === 0) {
      await interaction.editReply({ content: `ℹ️ No members joined in the last ${withinDays} day(s) with role ${role}.` });
      return;
    }

    // Build mention message in chunks under 2000 chars
    const header = `👋 New members (last ${withinDays} day(s)) with ${role} (${matching.size}):`;
    const mentions = matching.map(m => `<@${m.id}>`).join(" ");

    const messages = [];
    let current = header;
    for (const mention of mentions.split(" ")) {
      if ((current + " " + mention).length > 1900) {
        messages.push(current);
        current = mention;
      } else {
        current = current.length === 0 ? mention : current + " " + mention;
      }
    }
    if (current.length > 0) messages.push(current);

    // Send first chunk via ephemeral with publish button; follow with additional chunks
    await ephemeralReplyWithPublish(interaction, messages[0]);
    for (let i = 1; i < messages.length; i++) {
      await interaction.followUp({ content: messages[i], flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    console.error("❌ new_members Error:", error);
    await interaction.editReply({ content: "⚠️ Error generating new members list." });
  }
}

async function handleRefreshClubRoster(interaction) {
  try {
    const result = await refreshClubRoster();
    const summary =
      `✅ Refreshed official club roster\n` +
      `- fetched: **${result?.fetched ?? "?"}**\n` +
      `- stored: **${result?.stored ?? "?"}**\n` +
      `- deleted: **${result?.deleted ?? "?"}**\n` +
      `- upserted: **${result?.upserted ?? "?"}**\n` +
      `- syncedAt: **${result?.syncedAt ?? "?"}**`;

    await interaction.editReply({ content: summary });
  } catch (error) {
    console.error("❌ refresh_club_roster Error:", error);
    await interaction.editReply({
      content: `⚠️ Error refreshing club roster: ${error?.message || "unknown error"}`,
    });
  }
}

async function handleRefreshZwiftPowerRoster(interaction) {
  try {
    const result = await refreshZwiftPowerRoster();
    const summary =
      `✅ Refreshed ZwiftPower club roster\n` +
      `- fetched: **${result?.fetched ?? "?"}**\n` +
      `- stored: **${result?.stored ?? "?"}**\n` +
      `- deleted: **${result?.deleted ?? "?"}**\n` +
      `- upserted: **${result?.upserted ?? "?"}**\n` +
      `- syncedAt: **${result?.syncedAt ?? "?"}**`;

    await interaction.editReply({ content: summary });
  } catch (error) {
    console.error("❌ refresh_zwiftpower_roster Error:", error);
    await interaction.editReply({
      content: `⚠️ Error refreshing ZwiftPower roster: ${error?.message || "unknown error"}`,
    });
  }
}

async function handleSyncZpRoles(interaction) {
  try {
    // Admin-only guard (also enforced at command registration time)
    if (!interaction.member.permissions.has("Administrator") && !interaction.member.permissions.has("ADMINISTRATOR")) {
      await interaction.editReply({ content: "❌ This command is for administrators only." });
      return;
    }

    const hasAnyRoleConfig = !!(config.zpRoles?.A || config.zpRoles?.B || config.zpRoles?.C || config.zpRoles?.D);
    if (!hasAnyRoleConfig) {
      await interaction.editReply({
        content:
          "❌ ZP pace roles are not configured.\n\n" +
          "Set these env vars (Discord role IDs): `ZP_ROLE_D`, `ZP_ROLE_C`, `ZP_ROLE_B`, `ZP_ROLE_A` (A/A+).",
      });
      return;
    }

    await interaction.editReply({ content: "⏳ Running ZP pace-group role assignment now (add-only)..." });

    const result = await syncZpRolesForGuild(interaction.guild);

    const reasons = result?.skippedReasons || {};
    const totals = result?.totals || {};
    const summary =
      `✅ ZP pace-group role sync finished\n` +
      `- latest club_stats doc: **${result?.latestDocId ?? "?"}**\n` +
      `- snapshot timestamp: **${result?.latestTimestamp ?? "?"}**\n` +
      `- linked users: **${totals?.linkedUsers ?? "?"}**\n` +
      `- riders w/ category in snapshot: **${totals?.clubStatsRidersWithCategory ?? "?"}**\n` +
      `- added roles: **${result?.added ?? 0}**\n` +
      `- skipped: **${result?.skipped ?? 0}**\n` +
      `- errors: **${result?.errors ?? 0}**\n\n` +
      `**Skipped breakdown**\n` +
      `- already had role: **${reasons?.alreadyHasRole ?? 0}**\n` +
      `- linked zwiftId not in latest club_stats: **${reasons?.notInClubStats ?? 0}**\n` +
      `- role not configured (missing env for that category): **${reasons?.roleNotConfigured ?? 0}**\n` +
      `- role id not found in guild: **${reasons?.roleNotFound ?? 0}**\n` +
      `- member not found in guild: **${reasons?.memberNotFound ?? 0}**\n` +
      `- unknown/missing category: **${reasons?.unknownCategory ?? 0}**\n` +
      `- bot user / invalid ids: **${(reasons?.isBot ?? 0) + (reasons?.missingIds ?? 0)}**`;

    await interaction.editReply({ content: summary });
  } catch (error) {
    console.error("❌ sync_zp_roles Error:", error);
    await interaction.editReply({
      content: `⚠️ Error syncing ZP roles: ${error?.message || "unknown error"}`,
    });
  }
}

module.exports = {
  handleMyZwiftId,
  handleSetZwiftId,
  handleGetZwiftId,
  handleRiderStats,
  handleTeamStats,
  handleBrowseRiders,
  handleEventResults,
  handleWhoAmI,
  handleRefreshClubRoster,
  handleRefreshZwiftPowerRoster,
  handleSyncZpRoles,
  handleNewMembers,
  handlePostSignupBoard,
  handleRepostSignupBoard,
}; 