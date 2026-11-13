const { handleOnboardingPreview, handleOnboardingReset } = require("./onboardingCommands");
const { handleAnnouncerRun, handleAnnouncerPause, handleAnnouncerStats, handleAnnouncerPreviewDm } = require("./announcerCommands");
const { ActionRowBuilder, StringSelectMenuBuilder, InteractionResponseType, MessageFlags, EmbedBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const roleService = require("../services/roleService");
const { linkUserZwiftId, getTodaysClubStats } = require("../services/firebase");
const { handlePublishButton, ephemeralReplyWithPublish } = require("../utils/ephemeralStore");
const { updateKmsStatus } = require("../services/scheduler");
const {
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
} = require("./commandHandlers");
const { handleCoach } = require("../services/coachDm");
const { isRiderSelect, riderSelectOwner } = require("../services/riderSearch");
const { handleLadderLink, handleLadderPreview, handleLadderAnalysis, handleLadderAi, handleLadderScout } = require("./ladderHandlers");
const ladderTeams = require("../services/ladder/ladderTeams");
const ladderCatalog = require("../services/ladder/ladderCatalog");
const {
  handleSetupRoles,
  handleAddSelfRole,
  handleRemoveSelfRole,
  handleRolesPanel,
  handleRolesHelp,
  handleSetupPanel,
  handleAddPanelRole,
  handleRemovePanelRole,
  handleUpdatePanel,
  handleListPanels,
  handleSetRoleApproval,
  handlePendingApprovals,
  handleSetTeamCaptain,
  handleSetPanelApprovalChannel,
  handleSetRoleApprovalChannel,
  handleSetRoleButtonColor,
  handleSetRolePrerequisites,
  handleMyTeam,
  handleRemoveTeamMember,
  handleAddTeamMember,
} = require("./roleHandlers");
const {
  handleSetupVerification,
  handleVerificationStatus,
  handleProcessVerification,
  handleDisableVerification
} = require("./verificationHandlers");
const {
  handleQuizButton,
  startQuizFromInteraction,
} = require("../services/quizService");
const crypto = require("crypto");

const HANDLER_ID = crypto.randomUUID().slice(0, 8);

async function handleAutocomplete(interaction) {
  try {
    const { commandName, options } = interaction;
    const focusedOption = options.getFocused(true);

    if (focusedOption.name === 'panel_id') {
      const panels = await roleService.getPanelAutocompleteOptions(interaction.guild.id);
      const filtered = panels.filter(panel =>
        panel.name.toLowerCase().includes(focusedOption.value.toLowerCase()) ||
        panel.value.toLowerCase().includes(focusedOption.value.toLowerCase())
      ).slice(0, 25); // Discord limits to 25 options

      await interaction.respond(filtered);
    } else if (focusedOption.name === 'config_id') {
      const { getSignupBoardConfigs } = require("../services/firebase");
      const configs = await getSignupBoardConfigs();

      const filtered = configs
        .filter(c => c.title.toLowerCase().includes(focusedOption.value.toLowerCase()) || c.id.includes(focusedOption.value))
        .map(c => ({
          name: c.title.slice(0, 100), // Discord name limit
          value: c.id
        }))
        .slice(0, 25);

      await interaction.respond(filtered);
    } else if (commandName === "ladder_scout" && focusedOption.name === "opponent") {
      await interaction.respond(ladderCatalog.autocomplete(focusedOption.value));
    } else if (focusedOption.name === 'team' && (commandName === "ladder_preview" || commandName === "ladder_analysis" || commandName === "ladder_ai" || commandName === "ladder_scout")) {
      const typed = focusedOption.value.toLowerCase();
      const names = (await ladderTeams.list()).map(team => team.name);
      await interaction.respond(
        names
          .filter(name => name.toLowerCase().includes(typed))
          .slice(0, 25)
          .map(name => ({ name: name.slice(0, 100), value: name.slice(0, 100) }))
      );
    } else {
      // Default empty response for unhandled autocomplete options
      await interaction.respond([]);
    }
  } catch (error) {
    console.error('Error handling autocomplete:', error);
    // Only try to respond if the interaction hasn't expired
    if (error.code !== 10062) { // Not "Unknown interaction"
      try {
        await interaction.respond([]);
      } catch (fallbackError) {
        console.error('Fallback autocomplete response failed:', fallbackError);
      }
    }
  }
} // Unique ID for this handler instance

async function handleSelectMenus(interaction) {
  if (interaction.customId === "select_rider") {
    try {
      const [selectedValue] = interaction.values;
      await interaction.deferUpdate();

      const allRiders = await getTodaysClubStats();
      if (!allRiders) {
        await interaction.editReply("❌ No club_stats found for today.");
        return;
      }

      const chosen = allRiders.find(r => r.riderId === parseInt(selectedValue));
      if (!chosen) {
        await interaction.editReply("❌ Could not find that rider in today's list!");
        return;
      }

      const content = `**${chosen.name}** has ZwiftID: **${chosen.riderId}**`;
      await ephemeralReplyWithPublish(interaction, content);
    } catch (error) {
      console.error("❌ select_rider Error:", error);
      if (!interaction.replied) {
        await interaction.editReply("⚠️ Error selecting rider.");
      }
    }
    return;
  }

  if (isRiderSelect(interaction.customId)) {
    // A search menu belongs to the member who searched: someone else picking from it in a channel
    // would otherwise get a confirm card for that rider on their own account.
    const owner = riderSelectOwner(interaction.customId);
    if (owner && owner !== interaction.user.id) {
      await interaction.reply({ content: "Den liste er til en anden. Søg selv med `/my_zwiftid searchterm:`.", ephemeral: true });
      return;
    }
    try {
      const [selectedValue] = interaction.values;
      await interaction.deferUpdate();

      // Show the picked rider; linking happens on the confirm button. deferUpdate was the response,
      // so the confirm replaces the menu with editReply.
      const { prepareZwiftIdConfirmation, sendConfirmation } = require("./zwiftIdMessageHandler");
      const payload = await prepareZwiftIdConfirmation(interaction.user.id, selectedValue);
      await sendConfirmation((p) => interaction.editReply({ content: "", ...p }), payload);
    } catch (error) {
      console.error("❌ myzwift_select error:", error);
      if (!interaction.replied) {
        await interaction.editReply("⚠️ Error linking ZwiftID.");
      }
    }
    return;
  }

  if (interaction.customId.startsWith("setzwift_select_")) {
    try {
      // Custom select for /set_zwiftid command: customId format: setzwift_select_<targetUserId>
      const parts = interaction.customId.split("_");
      const targetUserId = parts[2];
      const [selectedValue] = interaction.values;
      await interaction.deferUpdate();

      const targetUser = await interaction.client.users.fetch(targetUserId);
      await linkUserZwiftId(targetUserId, targetUser.username, selectedValue);
      const content = `✅ Linked ZwiftID **${selectedValue}** to ${targetUser.username}.`;
      await ephemeralReplyWithPublish(interaction, content);

      // Check verification status after linking ZwiftID
      const { checkVerificationAfterZwiftLink } = require("./memberHandler");
      await checkVerificationAfterZwiftLink(interaction.guild, targetUserId);
    } catch (error) {
      console.error("❌ setzwift_select error:", error);
      if (!interaction.replied) {
        await interaction.editReply("⚠️ Error linking ZwiftID.");
      }
    }
    return;
  }
}

async function handleInteractions(interaction) {
  try {
    console.log(`🔍 [${HANDLER_ID}] Handling interaction: ${interaction.type} - ${interaction.isCommand() ? interaction.commandName : 'N/A'} (ID: ${interaction.id})`);

    // Handle publish buttons
    if (interaction.isButton() && interaction.customId.startsWith("quiz_answer_")) {
      await handleQuizButton(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("publish_")) {
      const uniqueId = interaction.customId.replace("publish_", "");
      await handlePublishButton(interaction, uniqueId);
      return;
    }

    // KMS signup/withdraw toggle button
    if (interaction.isButton() && interaction.customId.startsWith("kms_toggle_role_")) {
      try {
        await interaction.deferReply({ ephemeral: true });

        const roleId = interaction.customId.replace("kms_toggle_role_", "");
        const member = await interaction.guild.members.fetch(interaction.user.id);

        // Require Verified Member role
        const VERIFIED_ROLE_ID = '1385216556166025347';
        if (!member.roles.cache.has(VERIFIED_ROLE_ID)) {
          await interaction.editReply(
            "❌ Du skal være Verified Member for at tilmelde dig.\n\n" +
            "Skriv dit ZwiftID (kun tal) eller de første 3+ bogstaver i dit Zwift-navn til mig, så linker jeg det og du kan få rollen."
          );
          return;
        }

        const hasRole = member.roles.cache.has(roleId);

        if (hasRole) {
          await member.roles.remove(roleId);
          await interaction.editReply("🚪 Du er afmeldt fra Klubmesterskab.");
        } else {
          await member.roles.add(roleId);
          await interaction.editReply("✅ Du er tilmeldt Klubmesterskab.");
        }

        // Refresh KMS status message immediately
        try {
          await updateKmsStatus(interaction.client);
        } catch (updErr) {
          console.log("KMS status update after toggle failed:", updErr?.message);
        }
      } catch (error) {
        console.error("Error handling KMS toggle:", error);
        try {
          await interaction.editReply("❌ Kunne ikke opdatere din tilmelding. Tjek bot-rollerettigheder.");
        } catch { }
      }
      return;
    }

    // Handle signup board buttons
    if (interaction.isButton() && interaction.customId.startsWith("signup_")) {
      const { handleSignupButton } = require("../services/signupService");
      await handleSignupButton(interaction);
      return;
    }

    // Handle role toggle buttons
    if (interaction.isButton() && interaction.customId.startsWith("role_toggle_")) {
      const parts = interaction.customId.split("_");

      if (parts.length === 4) {
        // New format: role_toggle_panelId_roleId
        const panelId = parts[2];
        const roleId = parts[3];

        try {
          await interaction.deferReply({ ephemeral: true });

          // Get panel configuration
          const panelConfig = await roleService.getPanelConfig(interaction.guild.id, panelId);
          if (!panelConfig) {
            await interaction.editReply("❌ Panel configuration not found.");
            return;
          }

          // Check if user has access to this panel
          const accessCheck = await roleService.canUserAccessPanel(
            interaction.guild,
            interaction.user.id,
            panelConfig
          );

          if (!accessCheck.canAccess) {
            const missingRolesList = accessCheck.missingRoles.join(", ");
            await interaction.editReply(
              `❌ You need the following roles to access this panel: **${missingRolesList}**`
            );
            return;
          }

          // Check if user already has this role
          const member = await interaction.guild.members.fetch(interaction.user.id);
          const hasRole = member.roles.cache.has(roleId);
          const role = await interaction.guild.roles.fetch(roleId);

          if (!role) {
            await interaction.editReply("❌ Role not found.");
            return;
          }

          // Always show a personalized response with appropriate buttons
          const embed = new EmbedBuilder()
            .setTitle(`🎭 ${role.name}`)
            .setDescription(hasRole ? `You are currently a member of **${role.name}**` : `Join **${role.name}**?`)
            .setColor(hasRole ? 0x00FF00 : 0x5865F2)
            .addFields([
              { name: "🏆 Team", value: role.toString(), inline: true },
              { name: "👤 Your Status", value: hasRole ? "✅ Member" : "⭕ Not a member", inline: true }
            ])
            .setFooter({ text: `${interaction.guild.name} • Team Management` })
            .setTimestamp();

          if (hasRole) {
            // User has the role - show leave option
            embed.addFields([
              { name: "ℹ️ Leave", value: "You can leave this team anytime. You'll be able to rejoin through the role panel.", inline: false }
            ]);

            const leaveButton = new ButtonBuilder()
              .setCustomId(`confirm_leave_${panelId}_${roleId}`)
              .setLabel("🚪 Leave")
              .setStyle(ButtonStyle.Danger);

            const cancelButton = new ButtonBuilder()
              .setCustomId(`cancel_leave_${panelId}_${roleId}`)
              .setLabel("❌ Stay")
              .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(leaveButton, cancelButton);
            await interaction.editReply({ embeds: [embed], components: [row] });
          } else {
            // User doesn't have the role - show join option
            const roleConfig = panelConfig.roles.find(r => r.roleId === roleId);
            const requiresApproval = roleConfig?.requiresApproval || false;
            const teamCaptainId = roleConfig?.teamCaptainId;

            if (requiresApproval) {
              embed.addFields([
                { name: "🔐 Approval Required", value: teamCaptainId ? `This team requires approval from the team captain <@${teamCaptainId}>` : "This role requires admin approval", inline: false }
              ]);
            } else {
              embed.addFields([
                { name: "✅ Instant Join", value: "You'll be added to this team immediately", inline: false }
              ]);
            }

            const joinButton = new ButtonBuilder()
              .setCustomId(`confirm_join_${panelId}_${roleId}`)
              .setLabel(requiresApproval ? "🔐 Request to Join" : "✅ Join")
              .setStyle(requiresApproval ? ButtonStyle.Secondary : ButtonStyle.Success);

            const cancelButton = new ButtonBuilder()
              .setCustomId(`cancel_join_${panelId}_${roleId}`)
              .setLabel("❌ Cancel")
              .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(joinButton, cancelButton);
            await interaction.editReply({ embeds: [embed], components: [row] });
          }

        } catch (error) {
          console.error("Error handling panel role toggle:", error);
          await interaction.editReply(`❌ Error: ${error.message}`);
        }
        return;
      } else if (parts.length === 3) {
        // Legacy format: role_toggle_roleId (for backward compatibility)
        const roleId = parts[2];
        try {
          await interaction.deferReply({ ephemeral: true });

          const result = await roleService.toggleUserRole(
            interaction.guild,
            interaction.user.id,
            roleId
          );

          const emoji = result.action === "added" ? "✅" : "❌";
          const actionText = result.action === "added" ? "added" : "removed";

          await interaction.editReply(`${emoji} Successfully ${actionText} the **${result.roleName}** role!`);
        } catch (error) {
          console.error("Error handling legacy role toggle:", error);
          await interaction.editReply(`❌ Error: ${error.message}`);
        }
        return;
      }
    }

    // Handle leave confirmation buttons
    if (interaction.isButton() && (interaction.customId.startsWith("confirm_leave_") || interaction.customId.startsWith("cancel_leave_"))) {
      const parts = interaction.customId.split("_");

      if (parts.length === 4) {
        const action = parts[1]; // "leave"
        const panelId = parts[2];
        const roleId = parts[3];

        try {
          await interaction.deferReply({ ephemeral: true });

          if (interaction.customId.startsWith("cancel_leave_")) {
            await interaction.editReply("❌ Leave operation cancelled. You remain on the team.");
            return;
          }

          // Confirm leave - proceed with role removal
          const result = await roleService.toggleUserRole(
            interaction.guild,
            interaction.user.id,
            roleId,
            panelId
          );

          if (result.action === "removed") {
            await interaction.editReply(
              `🚪 **You have left the team!**\n\nYou are no longer a member of **${result.roleName}**. You can rejoin anytime through the role panel.`
            );
          } else {
            await interaction.editReply(`❌ Error: ${result.message || 'Could not leave'}`);
          }

        } catch (error) {
          console.error("Error handling leave confirmation:", error);
          await interaction.editReply(`❌ Error: ${error.message}`);
        }
        return;
      }
    }

    // Handle join confirmation buttons
    if (interaction.isButton() && (interaction.customId.startsWith("confirm_join_") || interaction.customId.startsWith("cancel_join_"))) {
      const parts = interaction.customId.split("_");

      if (parts.length === 4) {
        const action = parts[1]; // "join"
        const panelId = parts[2];
        const roleId = parts[3];

        try {
          await interaction.deferReply({ ephemeral: true });

          if (interaction.customId.startsWith("cancel_join_")) {
            await interaction.editReply("❌ Join operation cancelled.");
            return;
          }

          // Confirm join - proceed with role addition or approval request
          const result = await roleService.toggleUserRole(
            interaction.guild,
            interaction.user.id,
            roleId,
            panelId
          );

          if (result.action === "approval_requested") {
            await interaction.editReply(
              `🔐 **Join request submitted!**\n\n${result.message}\n\nYou'll receive a notification when your request is processed.`
            );
          } else if (result.action === "added") {
            await interaction.editReply(
              `✅ **Welcome to ${result.roleName}!**\n\nYou have successfully joined the team. You can leave anytime by clicking the role button again.`
            );
          } else {
            await interaction.editReply(`❌ Error: ${result.message || 'Could not join'}`);
          }

        } catch (error) {
          console.error("Error handling join confirmation:", error);
          await interaction.editReply(`❌ Error: ${error.message}`);
        }
        return;
      }
    }

    // Handle autocomplete
    if (interaction.isAutocomplete()) {
      // Check if interaction is recent enough to respond to (Discord autocomplete expires in 3 seconds)
      const interactionAge = Date.now() - interaction.createdTimestamp;
      if (interactionAge > 2500) { // 2.5 seconds safety margin
        console.log(`⚠️ [${HANDLER_ID}] Skipping autocomplete response - interaction too old (${interactionAge}ms)`);
        return;
      }
      await handleAutocomplete(interaction);
      return;
    }

    // Handle select menus
    if (interaction.isStringSelectMenu()) {
      await handleSelectMenus(interaction);
      return;
    }

    // Handle slash commands
    if (!interaction.isCommand()) return;

    console.log(`🔄 [${HANDLER_ID}] Interaction state before response: replied=${interaction.replied}, deferred=${interaction.deferred}`);

    // Add a small delay to see if this helps with timing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Try immediate reply instead of defer to avoid timing issues
    if (!interaction.replied && !interaction.deferred) {
      console.log(`⏳ [${HANDLER_ID}] Attempting to reply to interaction ${interaction.id}`);
      try {
        await interaction.reply({
          content: "⏳ Processing command...",
          flags: MessageFlags.Ephemeral
        });
        console.log(`✅ [${HANDLER_ID}] Successfully replied to interaction`);
      } catch (replyError) {
        console.log(`❌ [${HANDLER_ID}] Failed to reply to interaction: ${replyError.message}`);
        if (replyError.code === 40060) { // Already acknowledged
          console.log(`🔄 [${HANDLER_ID}] Interaction was already acknowledged by another handler`);
          return; // Exit gracefully
        }
        throw replyError; // Re-throw other errors
      }
    } else {
      console.log(`⚠️ [${HANDLER_ID}] Interaction already acknowledged, skipping reply`);
      return; // Exit if already handled
    }

    const commandName = interaction.commandName;

    const commandHandlers = {
      "my_zwiftid": handleMyZwiftId,
      "set_zwiftid": handleSetZwiftId,
      "get_zwiftid": handleGetZwiftId,
      "whoami": handleWhoAmI,
      "rider_stats": handleRiderStats,
      "team_stats": handleTeamStats,
      "browse_riders": handleBrowseRiders,
      "event_results": handleEventResults,
      "onboarding_preview": handleOnboardingPreview,
      "onboarding_reset": handleOnboardingReset,
      "announcer_run": handleAnnouncerRun,
      "announcer_pause": handleAnnouncerPause,
      "announcer_stats": handleAnnouncerStats,
      "announcer_preview_dm": handleAnnouncerPreviewDm,
      "refresh_club_roster": handleRefreshClubRoster,
      "refresh_zwiftpower_roster": handleRefreshZwiftPowerRoster,
      "sync_zp_roles": handleSyncZpRoles,
      "new_members": handleNewMembers,
      "post_signup_board": handlePostSignupBoard,
      "repost_signup_board": handleRepostSignupBoard,
      // Legacy role commands
      "setup_roles": handleSetupRoles,
      "add_selfrole": handleAddSelfRole,
      "remove_selfrole": handleRemoveSelfRole,
      "roles_panel": handleRolesPanel,
      "roles_help": handleRolesHelp,
      // New panel commands
      "setup_panel": handleSetupPanel,
      "add_panel_role": handleAddPanelRole,
      "remove_panel_role": handleRemovePanelRole,
      "update_panel": handleUpdatePanel,
      "list_panels": handleListPanels,
      // New approval commands
      "set_role_approval": handleSetRoleApproval,
      "pending_approvals": handlePendingApprovals,
      "set_team_captain": handleSetTeamCaptain,
      "set_panel_approval_channel": handleSetPanelApprovalChannel,
      "set_role_approval_channel": handleSetRoleApprovalChannel,
      "set_role_button_color": handleSetRoleButtonColor,
      "set_role_prerequisites": handleSetRolePrerequisites,
      // NEW: Team Captain Management Commands
      "my_team": handleMyTeam,
      "remove_team_member": handleRemoveTeamMember,
      "add_team_member": handleAddTeamMember,
      // Verification system commands
      "setup_verification": handleSetupVerification,
      "verification_status": handleVerificationStatus,
      "process_verification": handleProcessVerification,
      "disable_verification": handleDisableVerification,
      "quiz": startQuizFromInteraction,
      "coach": handleCoach,
      "ladder_link": handleLadderLink,
      "ladder_preview": handleLadderPreview,
      "ladder_analysis": handleLadderAnalysis,
      "ladder_ai": handleLadderAi,
      "ladder_scout": handleLadderScout,
    };

    const handler = commandHandlers[commandName];
    if (handler) {
      await handler(interaction);
    } else {
      await interaction.editReply({ content: "❌ Unknown command." });
    }

  } catch (error) {
    console.error(`❌ [${HANDLER_ID}] Unexpected Error:`, error);

    // Don't try to respond to autocomplete interactions or expired interactions
    if (interaction.isAutocomplete() || error.code === 10062) {
      console.log(`⚠️ [${HANDLER_ID}] Skipping error response for autocomplete or expired interaction`);
      return;
    }

    try {
      // Check current interaction state before trying to respond
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "⚠️ An unexpected error occurred!",
          flags: MessageFlags.Ephemeral
        });
      } else if (interaction.replied) {
        // Already replied, edit the reply
        await interaction.editReply({ content: "⚠️ An unexpected error occurred!" });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: "⚠️ An unexpected error occurred!" });
      } else {
        // Fallback: try follow-up
        await interaction.followUp({
          content: "⚠️ An unexpected error occurred!",
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (responseError) {
      console.error(`❌ [${HANDLER_ID}] Could not respond to interaction:`, responseError);
    }
  }
}

module.exports = {
  handleInteractions,
};
