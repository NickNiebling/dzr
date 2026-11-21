const { getWelcomeMessage, processMessageContent } = require("../services/contentApi");
const config = require("../config/config");
const verificationService = require("../services/verificationService");
const { ensureNewMemberRole } = require("../services/newMemberService");
const { runOnboarding, DM_HINTS } = require("../services/onboardingDm");
const { getClubRoleId } = require("../services/onboardingStatus");
const shared = require("../constants.json");

/**
 * Handle new member joining the server
 */
async function handleGuildMemberAdd(member) {
  try {
    console.log(`🔔 NEW MEMBER EVENT TRIGGERED: ${member.user.username} (${member.user.id}) joined ${member.guild.name}`);
    
    // The DM goes first so the public hello can say whether there is one to look for.
    const joinDm = await runOnboarding({ client: member.client, member, trigger: "join" });
    // Rejoining members can get their roles back at once; then the guide is due now.
    if (member.roles.cache.has(shared.discord.roles.communityMember)) {
      await runOnboarding({ client: member.client, member, trigger: "community" });
    }

    // Get welcome message from API
    const welcomeMessage = await getWelcomeMessage();
    if (!welcomeMessage) {
      console.log("❌ No welcome message configured");
    } else {
      console.log(`✅ Welcome message found: ${welcomeMessage.title}`);

      // Process message content with member variables
      const variables = {
        username: member.user.username,
        displayName: member.displayName,
        server_name: member.guild.name,
        member_count: member.guild.memberCount,
        mention: `<@${member.user.id}>`,
        dm_hint: joinDm.outcome === "sent" ? DM_HINTS.join : ""
      };

      // Content only: the public hello is one line. Any old embed on the document is ignored here;
      // the onboarding guide is sent by DM.
      const messageOptions = { content: processMessageContent(welcomeMessage.content, variables).trim() };

      // Send to channel specified in welcome message or fallback to config/system channel
      const channelId = welcomeMessage.channel_id || config.discord.welcomeChannelId || member.guild.systemChannelId;
      if (!channelId) {
        console.log("❌ No welcome channel configured - no channel_id in message, welcomeChannelId, or systemChannelId");
      } else {
        console.log(`📍 Attempting to send welcome message to channel: ${channelId}`);

        const channel = member.guild.channels.cache.get(channelId);
        if (channel) {
          await channel.send(messageOptions);
          console.log(`✅ Successfully sent welcome message to ${member.user.username} in #${channel.name}`);
        } else {
          console.log(`❌ Could not find channel with ID: ${channelId}`);
        }
      }
    }

    // Check verification status for new member
    await handleVerificationCheck(member);

    // Ensure New Member role assignment on join
    await ensureNewMemberRole(member);

  } catch (error) {
    console.error("❌ Error handling new member:", error);
  }
}

/**
 * Onboarding DMs for added roles. The role only decides that a DM may be due; onboardingDm
 * picks the content from the member's current next step.
 */
async function handleOnboardingRoles(member, addedRoleIds) {
  const roles = shared.discord.roles;
  let trigger = null;
  if (addedRoleIds.includes(roles.communityMember)) {
    trigger = "community";
  } else if (addedRoleIds.includes(roles.verifiedMember)) {
    trigger = "role";
  } else {
    const clubRoleId = await getClubRoleId();
    if (clubRoleId && addedRoleIds.includes(clubRoleId)) trigger = "role";
  }
  if (!trigger) return null;
  return runOnboarding({ client: member.client, member, trigger });
}

/**
 * Handle member role updates (when roles are added or removed)
 */
async function handleGuildMemberUpdate(oldMember, newMember) {
  try {
    // Check if roles have changed
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    
    // Find added roles
    const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
    
    if (addedRoles.size > 0) {
      console.log(`🔔 ROLE UPDATE EVENT: ${newMember.user.username} received ${addedRoles.size} new role(s)`);

      // The DM goes first so the public role line can say whether there is one to look for.
      const onboarding = await handleOnboardingRoles(newMember, [...addedRoles.keys()]);
      const dmHint = onboarding?.outcome === "sent" ? DM_HINTS.role : "";

      // Process each added role
      for (const role of addedRoles.values()) {
        await handleRoleAssignment(newMember, role, dmHint);
      }
    }
    
    // Always check verification status when roles change
    // This will handle both adding and removing roles that might affect verification
    await handleVerificationCheck(newMember);

    // Ensure New Member role is correct after any role changes
    await ensureNewMemberRole(newMember);

    
  } catch (error) {
    console.error("❌ Error handling member role update:", error);
  }
}

/**
 * Handle a specific role assignment
 */
async function handleRoleAssignment(member, role, dmHint = "") {
  try {
    console.log(`🎭 Processing role assignment: ${member.user.username} received role "${role.name}" (${role.id})`);
    
    // Get role messages from API
    const response = await fetch(`${config.contentApi.baseUrl}/api/messages/role-messages`, {
      headers: {
        'Authorization': `Bearer ${config.contentApi.apiKey}`
      }
    });
    
    if (!response.ok) {
      console.log("❌ Failed to fetch role messages from API");
      return;
    }
    
    const roleMessages = await response.json();
    
    // Find messages for this specific role
    const matchingMessages = roleMessages.filter(msg => 
      msg.active && msg.role_id === role.id
    );
    
    if (matchingMessages.length === 0) {
      console.log(`📭 No role messages configured for role "${role.name}"`);
      return;
    }
    
    console.log(`✅ Found ${matchingMessages.length} role message(s) for role "${role.name}"`);
    
    // Process each matching message
    for (const roleMessage of matchingMessages) {
      await sendRoleMessage(member, role, roleMessage, dmHint);
    }
    
  } catch (error) {
    console.error("❌ Error handling role assignment:", error);
  }
}

/**
 * Send a role assignment message
 */
async function sendRoleMessage(member, role, roleMessage, dmHint = "") {
  try {
    console.log(`📤 Sending role message: "${roleMessage.title}" for role "${role.name}"`);
    
    // Process message content with variables
    const variables = {
      username: member.user.username,
      displayName: member.displayName,
      server_name: member.guild.name,
      member_count: member.guild.memberCount,
      mention: `<@${member.user.id}>`,
      role_name: role.name,
      role_mention: `<@&${role.id}>`,
      role_color: role.hexColor || '#000000',
      dm_hint: dmHint
    };
    
    const { processMessageContent } = require("../services/contentApi");
    const content = processMessageContent(roleMessage.content, variables).trim();
    
    // Build message object
    const messageOptions = { content };
    
    // Send to specified channel
    const channelId = roleMessage.channel_id;
    if (!channelId) {
      console.log("❌ No channel specified for role message");
      return;
    }
    
    console.log(`📍 Attempting to send role message to channel: ${channelId}`);
    
    const channel = member.guild.channels.cache.get(channelId);
    if (channel) {
      await channel.send(messageOptions);
      console.log(`✅ Successfully sent role message for ${member.user.username} receiving "${role.name}" in #${channel.name}`);
    } else {
      console.log(`❌ Could not find channel with ID: ${channelId}`);
    }
    
  } catch (error) {
    console.error("❌ Error sending role message:", error);
  }
}

/**
 * Handle verification check for a member
 */
async function handleVerificationCheck(member) {
  try {
    const result = await verificationService.processVerification(member);
    if (result.processed) {
      if (result.action === "role_assigned") {
        console.log(`✅ Auto-verification: Assigned "${result.role}" to ${member.user.username}`);
      } else if (result.action === "role_removed") {
        console.log(`❌ Auto-verification: Removed "${result.role}" from ${member.user.username}. Missing: ${result.missingCriteria?.join(', ')}`);
      }
    }
  } catch (error) {
    console.error("❌ Error in verification check:", error);
  }
}

/**
 * Check verification status after ZwiftID is linked
 * This function can be called from command handlers after ZwiftID linking
 */
async function checkVerificationAfterZwiftLink(guild, userId) {
  try {
    // In some contexts (DMs or synthetic interactions) guild can be null/undefined.
    if (!guild || !guild.members) {
      console.log("ℹ️ Skipping verification check after ZwiftID link – no guild context available.");
      return;
    }

    const member = await guild.members.fetch(userId);
    if (!member) {
      console.log(`ℹ️ Could not fetch member ${userId} for verification check after ZwiftID link.`);
      return;
    }
    await handleVerificationCheck(member);
  } catch (error) {
    console.error("❌ Error checking verification after ZwiftID link:", error);
  }
}

module.exports = {
  handleGuildMemberAdd,
  handleGuildMemberUpdate,
  checkVerificationAfterZwiftLink,
}; 