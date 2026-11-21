const { ChannelType, EmbedBuilder } = require("discord.js");
const roleService = require("../services/roleService");
const approvalService = require("../services/approvalService");

// Legacy handlers (for backward compatibility)
async function handleSetupRoles(interaction) {
  try {
    const channel = interaction.options.getChannel("channel");
    
    // Validate channel type
    if (channel.type !== ChannelType.GuildText) {
      await interaction.editReply("❌ Please select a text channel.");
      return;
    }

    // Check if bot has permissions in the channel
    const botPermissions = channel.permissionsFor(interaction.guild.members.me);
    if (!botPermissions.has(["SendMessages", "ViewChannel", "EmbedLinks"])) {
      await interaction.editReply("❌ I don't have permission to send messages in that channel. Please ensure I have Send Messages, View Channel, and Embed Links permissions.");
      return;
    }

    const success = await roleService.setupRoleSystem(interaction.guild.id, channel.id);
    
    if (success) {
      await interaction.editReply(`✅ Default role system has been setup for ${channel}!\n\nNext steps:\n1. Use \`/add_selfrole\` to add roles to the selection list\n2. Use \`/roles_panel\` to create the role selection panel\n\n💡 **New**: Try the advanced panel system with \`/setup_panel\` for channel-specific roles!`);
    } else {
      await interaction.editReply("❌ Failed to setup the role system. Please try again.");
    }
  } catch (error) {
    console.error("Error in handleSetupRoles:", error);
    await interaction.editReply("❌ An error occurred while setting up the role system.");
  }
}

async function handleAddSelfRole(interaction) {
  try {
    const role = interaction.options.getRole("role");
    const description = interaction.options.getString("description");
    const emoji = interaction.options.getString("emoji");

    // Check if bot can manage this role
    const botMember = interaction.guild.members.me;
    if (role.position >= botMember.roles.highest.position) {
      await interaction.editReply("❌ I cannot manage this role because it's higher than or equal to my highest role. Please move my role above this role in the server settings.");
      return;
    }

    // Check if role is @everyone
    if (role.id === interaction.guild.id) {
      await interaction.editReply("❌ You cannot add the @everyone role to self-selection.");
      return;
    }

    // Check if role is managed (bot roles, integration roles, etc.)
    if (role.managed) {
      await interaction.editReply("❌ This role is managed by an integration and cannot be assigned manually.");
      return;
    }

    await roleService.addSelfRole(
      interaction.guild.id,
      role.id,
      role.name,
      description,
      emoji
    );

    let response = `✅ Added **${role.name}** to the default role panel!`;
    if (description) response += `\nDescription: ${description}`;
    if (emoji) response += `\nEmoji: ${emoji}`;
    response += `\n\nUse \`/roles_panel\` to update the role selection panel.`;
    response += `\n\n💡 **Tip**: Use \`/add_panel_role\` for more advanced panel management!`;

    await interaction.editReply(response);
  } catch (error) {
    console.error("Error in handleAddSelfRole:", error);
    if (error.message.includes("Panel") && error.message.includes("not found")) {
      await interaction.editReply("❌ Default role system not setup for this server. Use `/setup_roles` first.");
    } else if (error.message.includes("already in")) {
      await interaction.editReply("❌ This role is already in the default role panel.");
    } else {
      await interaction.editReply("❌ An error occurred while adding the role.");
    }
  }
}

async function handleRemoveSelfRole(interaction) {
  try {
    const role = interaction.options.getRole("role");

    await roleService.removeSelfRole(interaction.guild.id, role.id);

    await interaction.editReply(`✅ Removed **${role.name}** from the default role panel!\n\nUse \`/roles_panel\` to update the role selection panel.`);
  } catch (error) {
    console.error("Error in handleRemoveSelfRole:", error);
    if (error.message.includes("Panel") && error.message.includes("not found")) {
      await interaction.editReply("❌ Default role system not setup for this server. Use `/setup_roles` first.");
    } else if (error.message.includes("not found")) {
      await interaction.editReply("❌ This role was not found in the default role panel.");
    } else {
      await interaction.editReply("❌ An error occurred while removing the role.");
    }
  }
}

async function handleRolesPanel(interaction) {
  try {
    const config = await roleService.getRoleConfig(interaction.guild.id);
    
    if (!config) {
      await interaction.editReply("❌ Default role system not setup for this server. Use `/setup_roles` first.");
      return;
    }

    const channel = interaction.guild.channels.cache.get(config.channelId);
    if (!channel) {
      await interaction.editReply("❌ The configured role channel no longer exists. Please run `/setup_roles` again.");
      return;
    }

    // Check if bot has permissions in the channel
    const botPermissions = channel.permissionsFor(interaction.guild.members.me);
    if (!botPermissions.has(["SendMessages", "ViewChannel", "EmbedLinks"])) {
      await interaction.editReply("❌ I don't have permission to send messages in the configured channel. Please ensure I have Send Messages, View Channel, and Embed Links permissions.");
      return;
    }

    // Add guild to config for member fetching
    config.guild = interaction.guild;
    const panelData = await roleService.createRolePanelForPanel(config.roles, interaction.guild.name, config, true);

    // Delete old panel message if it exists
    if (config.panelMessageId) {
      try {
        const oldMessage = await channel.messages.fetch(config.panelMessageId);
        await oldMessage.delete();
      } catch (error) {
        console.log("Could not delete old panel message:", error.message);
      }
    }

    // Send new panel
    const panelMessage = await channel.send(panelData);
    
    // Update the stored message ID
    await roleService.updatePanelMessageId(interaction.guild.id, panelMessage.id);

    await interaction.editReply(`✅ Default role selection panel has been ${config.panelMessageId ? 'updated' : 'created'} in ${channel}!\n\n💡 **Tip**: Try \`/list_panels\` to see all your role panels!`);
  } catch (error) {
    console.error("Error in handleRolesPanel:", error);
    await interaction.editReply("❌ An error occurred while creating the role panel.");
  }
}

// NEW: Multi-panel handlers
async function handleSetupPanel(interaction) {
  try {
    const panelId = interaction.options.getString("panel_id");
    const channel = interaction.options.getChannel("channel");
    const name = interaction.options.getString("name");
    const description = interaction.options.getString("description");
    const requiredRole = interaction.options.getRole("required_role");
    const approvalChannel = interaction.options.getChannel("approval_channel");
    
    // Validate panel ID format
    if (!/^[a-zA-Z0-9_-]+$/.test(panelId)) {
      await interaction.editReply("❌ Panel ID can only contain letters, numbers, underscores, and hyphens.");
      return;
    }

    // Validate channel type
    if (channel.type !== ChannelType.GuildText) {
      await interaction.editReply("❌ Please select a text channel for the panel.");
      return;
    }

    // Check if bot has permissions in the panel channel
    const botPermissions = channel.permissionsFor(interaction.guild.members.me);
    if (!botPermissions.has(["SendMessages", "ViewChannel", "EmbedLinks"])) {
      await interaction.editReply("❌ I don't have permission to send messages in that channel. Please ensure I have Send Messages, View Channel, and Embed Links permissions.");
      return;
    }

    // Validate approval channel if provided
    if (approvalChannel) {
      if (approvalChannel.type !== ChannelType.GuildText) {
        await interaction.editReply("❌ Please select a text channel for the approval channel.");
        return;
      }

      const approvalPermissions = approvalChannel.permissionsFor(interaction.guild.members.me);
      if (!approvalPermissions.has(["SendMessages", "ViewChannel", "EmbedLinks", "AddReactions"])) {
        await interaction.editReply("❌ I don't have permission to send messages, view channel, embed links, or add reactions in the approval channel. Please ensure I have the necessary permissions.");
        return;
      }
    }

    const requiredRoles = requiredRole ? [requiredRole.id] : [];
    const success = await roleService.setupRolePanel(
      interaction.guild.id, 
      panelId, 
      channel.id, 
      name, 
      description, 
      requiredRoles,
      approvalChannel ? approvalChannel.id : null
    );
    
    if (success) {
      let response = `✅ Role panel **${name}** (ID: \`${panelId}\`) has been setup for ${channel}!`;
      if (requiredRole) {
        response += `\n🔒 Required role: ${requiredRole}`;
      }
      if (approvalChannel) {
        response += `\n🔐 Approval channel: ${approvalChannel}`;
      }
      response += `\n\nNext steps:\n1. Use \`/add_panel_role panel_id:${panelId}\` to add roles\n2. Use \`/update_panel panel_id:${panelId}\` to create the panel`;
      
      await interaction.editReply(response);
    } else {
      await interaction.editReply("❌ Failed to setup the role panel. Please try again.");
    }
  } catch (error) {
    console.error("Error in handleSetupPanel:", error);
    await interaction.editReply("❌ An error occurred while setting up the role panel.");
  }
}

async function handleAddPanelRole(interaction) {
  try {
    const panelId = interaction.options.getString("panel_id");
    const role = interaction.options.getRole("role");
    const description = interaction.options.getString("description");
    const emoji = interaction.options.getString("emoji");
    const requiresApproval = interaction.options.getBoolean("requires_approval") || false;
    const teamCaptain = interaction.options.getUser("team_captain");
    const approvalChannel = interaction.options.getChannel("approval_channel");
    const buttonColor = interaction.options.getString("button_color") || "Secondary";
    const requiredRole1 = interaction.options.getRole("required_role_1");
    const requiredRole2 = interaction.options.getRole("required_role_2");
    const requiredRole3 = interaction.options.getRole("required_role_3");

    // Check if bot can manage this role
    const botMember = interaction.guild.members.me;
    if (role.position >= botMember.roles.highest.position) {
      await interaction.editReply("❌ I cannot manage this role because it's higher than or equal to my highest role. Please move my role above this role in the server settings.");
      return;
    }

    // Check if role is @everyone
    if (role.id === interaction.guild.id) {
      await interaction.editReply("❌ You cannot add the @everyone role to self-selection.");
      return;
    }

    // Check if role is managed (bot roles, integration roles, etc.)
    if (role.managed) {
      await interaction.editReply("❌ This role is managed by an integration and cannot be assigned manually.");
      return;
    }

    // If approval is required but no team captain is set, that's okay (admin-only approval)
    if (requiresApproval && teamCaptain) {
      // Verify the team captain is a member of the guild
      try {
        await interaction.guild.members.fetch(teamCaptain.id);
      } catch (error) {
        await interaction.editReply("❌ The specified team captain is not a member of this server.");
        return;
      }
    }

    // Validate approval channel if provided
    if (approvalChannel) {
      if (approvalChannel.type !== ChannelType.GuildText) {
        await interaction.editReply("❌ Please select a text channel for the approval channel.");
        return;
      }

      const approvalPermissions = approvalChannel.permissionsFor(interaction.guild.members.me);
      if (!approvalPermissions.has(["SendMessages", "ViewChannel", "EmbedLinks", "AddReactions"])) {
        await interaction.editReply("❌ I don't have permission to send messages, view channel, embed links, or add reactions in the approval channel. Please ensure I have the necessary permissions.");
        return;
      }
    }

    // Build required roles array
    const requiredRoles = [];
    if (requiredRole1) requiredRoles.push(requiredRole1.id);
    if (requiredRole2) requiredRoles.push(requiredRole2.id);
    if (requiredRole3) requiredRoles.push(requiredRole3.id);

    await roleService.addSelfRoleToPanel(
      interaction.guild.id,
      panelId,
      role.id,
      role.name,
      description,
      emoji,
      requiresApproval,
      teamCaptain ? teamCaptain.id : null,
      approvalChannel ? approvalChannel.id : null,
      buttonColor,
      requiredRoles
    );

    let response = `✅ Added **${role.name}** to panel **${panelId}**!`;
    if (description) response += `\nDescription: ${description}`;
    if (emoji) response += `\nEmoji: ${emoji}`;
    if (buttonColor !== "Secondary") response += `\nButton Color: ${buttonColor}`;
    if (requiredRoles.length > 0) {
      const requiredRoleNames = [];
      if (requiredRole1) requiredRoleNames.push(requiredRole1.name);
      if (requiredRole2) requiredRoleNames.push(requiredRole2.name);
      if (requiredRole3) requiredRoleNames.push(requiredRole3.name);
      response += `\n🔑 **Required Roles**: ${requiredRoleNames.join(", ")}`;
    }
    if (requiresApproval) {
      response += `\n🔐 **Requires Approval**: Yes`;
      if (teamCaptain) {
        response += `\n👨‍✈️ **Team Captain**: ${teamCaptain.displayName} (${teamCaptain.tag})`;
      } else {
        response += `\n👮 **Approver**: Admins only`;
      }
      if (approvalChannel) {
        response += `\n📢 **Approval Channel**: ${approvalChannel}`;
      }
    }
    response += `\n\nUse \`/update_panel panel_id:${panelId}\` to refresh the panel.`;

    await interaction.editReply(response);
  } catch (error) {
    console.error("Error in handleAddPanelRole:", error);
    if (error.message.includes("not found")) {
      await interaction.editReply(`❌ Panel "${interaction.options.getString("panel_id")}" not found. Use \`/setup_panel\` first.`);
    } else if (error.message.includes("already in")) {
      await interaction.editReply("❌ This role is already in this panel.");
    } else {
      await interaction.editReply("❌ An error occurred while adding the role.");
    }
  }
}

async function handleRemovePanelRole(interaction) {
  try {
    const panelId = interaction.options.getString("panel_id");
    const role = interaction.options.getRole("role");

    await roleService.removeSelfRoleFromPanel(interaction.guild.id, panelId, role.id);

    await interaction.editReply(`✅ Removed **${role.name}** from panel **${panelId}**!\n\nUse \`/update_panel panel_id:${panelId}\` to refresh the panel.`);
  } catch (error) {
    console.error("Error in handleRemovePanelRole:", error);
    if (error.message.includes("not found") && error.message.includes("Panel")) {
      await interaction.editReply(`❌ Panel "${interaction.options.getString("panel_id")}" not found.`);
    } else if (error.message.includes("not found")) {
      await interaction.editReply("❌ This role was not found in this panel.");
    } else {
      await interaction.editReply("❌ An error occurred while removing the role.");
    }
  }
}

async function handleUpdatePanel(interaction) {
  try {
    const panelId = interaction.options.getString("panel_id");
    const panelConfig = await roleService.getPanelConfig(interaction.guild.id, panelId);
    
    if (!panelConfig) {
      await interaction.editReply(`❌ Panel "${panelId}" not found.`);
      return;
    }

    const channel = interaction.guild.channels.cache.get(panelConfig.channelId);
    if (!channel) {
      await interaction.editReply("❌ The configured panel channel no longer exists. Please run `/setup_panel` again.");
      return;
    }

    // Check if bot has permissions in the channel
    const botPermissions = channel.permissionsFor(interaction.guild.members.me);
    if (!botPermissions.has(["SendMessages", "ViewChannel", "EmbedLinks"])) {
      await interaction.editReply("❌ I don't have permission to send messages in the configured channel. Please ensure I have Send Messages, View Channel, and Embed Links permissions.");
      return;
    }

    // Add guild to panel config for member fetching
    panelConfig.guild = interaction.guild;
    const panelData = await roleService.createRolePanelForPanel(panelConfig.roles, interaction.guild.name, panelConfig, true);

    let panelMessage;
    
    // Try to edit existing message first (no notifications)
    if (panelConfig.panelMessageId) {
      try {
        const oldMessage = await channel.messages.fetch(panelConfig.panelMessageId);
        panelMessage = await oldMessage.edit(panelData);
        console.log(`✅ Silently updated existing panel message ${panelConfig.panelMessageId}`);
      } catch (error) {
        console.log("Could not edit old panel message, creating new one:", error.message);
        // If editing fails, create a new message
        panelMessage = await channel.send(panelData);
        await roleService.updatePanelMessageIdForPanel(interaction.guild.id, panelId, panelMessage.id);
      }
    } else {
      // No existing message, create new one
      panelMessage = await channel.send(panelData);
      await roleService.updatePanelMessageIdForPanel(interaction.guild.id, panelId, panelMessage.id);
    }

    await interaction.editReply(`✅ Panel **${panelConfig.name}** has been ${panelConfig.panelMessageId ? 'updated' : 'created'} in ${channel}!`);
  } catch (error) {
    console.error("Error in handleUpdatePanel:", error);
    await interaction.editReply("❌ An error occurred while updating the panel.");
  }
}

async function handleListPanels(interaction) {
  try {
    const panels = await roleService.getAllPanels(interaction.guild.id);
    
    if (Object.keys(panels).length === 0) {
      await interaction.editReply("❌ No role panels found for this server.\n\nUse `/setup_panel` to create your first panel!");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("🎭 Role Panels")
      .setDescription("Here are all the role panels configured for this server:")
      .setColor(0x5865F2)
      .setFooter({ text: `${interaction.guild.name} • Role Panel Management` })
      .setTimestamp();

    for (const [panelId, panel] of Object.entries(panels)) {
      const channel = interaction.guild.channels.cache.get(panel.channelId);
      const channelMention = channel ? channel.toString() : "❌ Channel not found";
      
      let fieldValue = `**Channel:** ${channelMention}\n`;
      fieldValue += `**Roles:** ${panel.roles.length}\n`;
      
      if (panel.requiredRoles && panel.requiredRoles.length > 0) {
        const requiredRolesList = panel.requiredRoles.map(roleId => {
          const role = interaction.guild.roles.cache.get(roleId);
          return role ? role.toString() : "❌ Role not found";
        }).join(", ");
        fieldValue += `**Required:** ${requiredRolesList}\n`;
      }
      
      if (panel.approvalChannelId) {
        const approvalChannel = interaction.guild.channels.cache.get(panel.approvalChannelId);
        const approvalChannelMention = approvalChannel ? approvalChannel.toString() : "❌ Channel not found";
        fieldValue += `**Approval Channel:** ${approvalChannelMention}\n`;
      }
      
      fieldValue += `**Status:** ${panel.panelMessageId ? "✅ Active" : "⚠️ Not deployed"}`;
      
      embed.addFields({
        name: `${panel.name} (\`${panelId}\`)`,
        value: fieldValue,
        inline: true
      });
    }

    embed.addFields({
      name: "📋 Quick Commands",
      value: "• `/add_panel_role` - Add roles to a panel\n• `/update_panel` - Refresh a panel\n• `/setup_panel` - Create new panel",
      inline: false
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error in handleListPanels:", error);
    await interaction.editReply("❌ An error occurred while listing panels.");
  }
}

async function handleRolesHelp(interaction) {
  try {
    const embed = new EmbedBuilder()
      .setTitle("🎭 Enhanced Team Management System Guide")
      .setDescription("Complete guide to the enhanced role system with team captain management and smart approvals!")
      .setColor(0x5865F2)
      .setThumbnail(interaction.guild.iconURL())
      .addFields(
        {
          name: "🌟 What's New in v2.0?",
          value: "• 🔔 Auto-notifications for approvals/rejections\n• 🎯 Smart buttons that adapt to your status\n• 👨‍✈️ Team captain management commands\n• 📢 Role-specific approval channels\n• 🚪 Enhanced leave experience with confirmations",
          inline: false
        },
        {
          name: "🚀 Quick Racing Team Setup",
          value: "```bash\n# 1. Setup teams panel\n/setup_panel panel_id:teams channel:#team-zone name:\"Racing Teams\"\n\n# 2. Add teams with captains\n/add_panel_role panel_id:teams role:@Team-Red emoji:🔴 requires_approval:true team_captain:@CaptainRed approval_channel:#team-red-approvals\n\n# 3. Deploy panel\n/update_panel panel_id:teams\n```",
          inline: false
        },
        {
          name: "🎯 Smart Button Experience",
          value: "**Not on team:** Click → Join confirmation with approval info\n**Already on team:** Click → Leave confirmation with status\n**Visual feedback:** Colors show current membership\n**Smart actions:** Same button, different behavior",
          inline: false
        },
        {
          name: "👨‍✈️ Team Captain Commands",
          value: "**View Teams:** `/my_team` - See all your teams and members\n**Add Member:** `/add_team_member team_role:@Team-Red member:@rider reason:\"welcome\"`\n**Remove Member:** `/remove_team_member team_role:@Team-Red member:@rider reason:\"inactive\"`\n**Approve/Reject:** React ✅/❌ in your team's approval channel",
          inline: false
        },
        {
          name: "📢 Role-Specific Approval Channels",
          value: "Each team can have its own approval channel:\n```bash\n# Add role with specific channel\n/add_panel_role panel_id:teams role:@Team-Red approval_channel:#team-red-approvals\n\n# Change existing role's channel\n/set_role_approval_channel panel_id:teams role:@Team-Blue approval_channel:#team-blue-approvals\n```",
          inline: false
        },
        {
          name: "🔔 Notification System",
          value: "**Riders get notified when:**\n• Request approved (welcome message)\n• Request rejected (with reason)\n• Removed by captain (professional notice)\n\n**Captains get notified when:**\n• Members leave voluntarily",
          inline: false
        },
        {
          name: "🔧 Essential Commands",
          value: "**Admin Setup:**\n• `/setup_panel` - Create panels\n• `/add_panel_role` - Add roles with captain/channel options\n• `/update_panel` - Refresh panels\n• `/list_panels` - View all panels\n\n**Team Management:**\n• `/set_team_captain` - Assign captains\n• `/set_role_approval_channel` - Set role channels\n• `/pending_approvals` - View pending requests",
          inline: false
        },
        {
          name: "⚡ Complete Team Setup Example",
          value: "1. Create approval channels (#team-red-approvals, etc.)\n2. Setup panel with requirements\n3. Add teams with captains and channels\n4. Deploy and test workflow\n5. Train team captains on new commands",
          inline: false
        },
        {
          name: "🎨 Visual Indicators",
          value: "**In Panels:** 🔐 (approval required), 👨‍✈️ (has captain), 📢 (custom channel)\n**Buttons:** Context-aware labels and colors\n**Status:** Green (member), Blue (available), Red (restricted)",
          inline: false
        },
        {
          name: "🚨 Troubleshooting",
          value: "**No approval messages?** Check bot permissions and channel settings\n**Buttons not working?** Update panel after role changes\n**Captain commands failing?** Verify captain assignment\n\n**Debug:** `/list_panels`, `/pending_approvals`, `/my_team`",
          inline: false
        },
        {
          name: "📈 Best Practices",
          value: "• Use role-specific approval channels for teams\n• Assign active members as team captains\n• Test workflow before going live\n• Monitor pending requests regularly\n• Use clear team names and emojis",
          inline: false
        }
      )
      .setFooter({ 
        text: `${interaction.guild.name} • Enhanced Team Management v2.0`, 
        iconURL: interaction.guild.iconURL() 
      })
      .setTimestamp();

    // Check if any panels are set up and show current status
    const panels = await roleService.getAllPanels(interaction.guild.id);
    
    if (Object.keys(panels).length > 0) {
      let panelsList = "";
      let totalRoles = 0;
      let approvalRoles = 0;
      let teamCaptains = new Set();
      let roleSpecificChannels = 0;
      
      for (const [panelId, panel] of Object.entries(panels)) {
        const status = panel.panelMessageId ? "✅" : "⚠️";
        const requiredInfo = panel.requiredRoles && panel.requiredRoles.length > 0 ? "🔒" : "";
        
        // Count statistics
        const panelApprovalRoles = panel.roles.filter(role => role.requiresApproval).length;
        const panelCaptains = panel.roles.filter(role => role.teamCaptainId).map(role => role.teamCaptainId);
        const panelRoleChannels = panel.roles.filter(role => role.roleApprovalChannelId).length;
        
        approvalRoles += panelApprovalRoles;
        roleSpecificChannels += panelRoleChannels;
        panelCaptains.forEach(captain => teamCaptains.add(captain));
        
        const info = [
          panelApprovalRoles > 0 ? `🔐${panelApprovalRoles}` : "",
          panelCaptains.length > 0 ? `👨‍✈️${panelCaptains.length}` : "",
          panelRoleChannels > 0 ? `📢${panelRoleChannels}` : ""
        ].filter(Boolean).join(" ");
        
        panelsList += `${status} **${panel.name}** (\`${panelId}\`) - ${panel.roles.length} roles ${requiredInfo}${info}\n`;
        totalRoles += panel.roles.length;
      }
      
      embed.addFields({
        name: `📊 Current Setup (${Object.keys(panels).length} panels)`,
        value: panelsList.length > 1024 ? panelsList.substring(0, 1000) + "..." : panelsList,
        inline: false
      });
      
      embed.addFields({
        name: "📈 Stats & Next Steps",
        value: `**Panels:** ${Object.keys(panels).length} | **Roles:** ${totalRoles} | **Approval Roles:** ${approvalRoles}\n**Team Captains:** ${teamCaptains.size} | **Role Channels:** ${roleSpecificChannels}\n\n${approvalRoles > 0 ? "Use `/my_team` and monitor approval channels!" : "Consider adding approval roles for teams!"}`,
        inline: false
      });
    } else {
      embed.addFields({
        name: "🚀 Ready to Start?",
        value: "No panels found! Create your first team system:\n\n1. `/setup_panel panel_id:teams channel:#team-selection name:\"Teams\"`\n2. `/add_panel_role panel_id:teams role:@Team-Red requires_approval:true team_captain:@Captain`\n3. `/update_panel panel_id:teams`",
        inline: false
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error in handleRolesHelp:", error);
    await interaction.editReply("❌ An error occurred while displaying the role system guide.");
  }
}

async function handleSetRoleApproval(interaction) {
  try {
    const panelId = interaction.options.getString("panel_id");
    const role = interaction.options.getRole("role");
    const requiresApproval = interaction.options.getBoolean("requires_approval");

    await roleService.updateRoleApprovalRequirement(
      interaction.guild.id,
      panelId,
      role.id,
      requiresApproval
    );

    const statusText = requiresApproval ? "now requires approval" : "no longer requires approval";
    await interaction.editReply(
      `✅ **${role.name}** in panel **${panelId}** ${statusText}!\n\nUse \`/update_panel panel_id:${panelId}\` to refresh the panel.`
    );
  } catch (error) {
    console.error("Error in handleSetRoleApproval:", error);
    if (error.message.includes("not found") && error.message.includes("Panel")) {
      await interaction.editReply(`❌ Panel "${interaction.options.getString("panel_id")}" not found.`);
    } else if (error.message.includes("not found")) {
      await interaction.editReply("❌ This role was not found in this panel.");
    } else {
      await interaction.editReply("❌ An error occurred while updating the role approval requirement.");
    }
  }
}

async function handlePendingApprovals(interaction) {
  try {
    const pendingRequests = await approvalService.getPendingRequests(interaction.guild.id);

    if (pendingRequests.length === 0) {
      await interaction.editReply("✅ No pending team join requests found!");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("🏁 Pending Team Join Requests")
      .setDescription(`Found ${pendingRequests.length} pending team join request(s)`)
      .setColor(0xFFAA00)
      .setFooter({ text: `${interaction.guild.name} • Team Approvals` })
      .setTimestamp();

    for (const request of pendingRequests.slice(0, 10)) { // Limit to 10 to avoid embed limits
      try {
        const user = await interaction.guild.members.fetch(request.userId);
        const role = await interaction.guild.roles.fetch(request.roleId);
        
        let fieldValue = [
          `**Rider:** ${user.displayName} (${user.user.tag})`,
          `**Team:** ${role ? role.toString() : 'Team not found'}`,
          `**Panel:** ${request.panelName}`,
          `**Requested:** <t:${Math.floor(request.requestedAt.toDate().getTime() / 1000)}:R>`
        ];

        // Add team captain info if available
        if (request.teamCaptainId) {
          try {
            const captain = await interaction.guild.members.fetch(request.teamCaptainId);
            fieldValue.push(`**Team Captain:** ${captain.displayName}`);
          } catch (captainError) {
            fieldValue.push(`**Team Captain:** <@${request.teamCaptainId}>`);
          }
        }

        embed.addFields({
          name: `Join Request ${request.id.split('_').pop()}`,
          value: fieldValue.join('\n'),
          inline: true
        });
      } catch (userError) {
        console.error("Error fetching user for approval request:", userError);
      }
    }

    if (pendingRequests.length > 10) {
      embed.addFields({
        name: "📋 Note",
        value: `Showing first 10 of ${pendingRequests.length} pending requests.`,
        inline: false
      });
    }

    embed.addFields({
      name: "✅ How to Approve",
      value: "Team captains and admins can react with ✅ on join requests in your approval channel to welcome riders to their teams.",
      inline: false
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error in handlePendingApprovals:", error);
    await interaction.editReply("❌ An error occurred while fetching pending approvals.");
  }
}

async function handleSetTeamCaptain(interaction) {
  try {
    const panelId = interaction.options.getString("panel_id");
    const role = interaction.options.getRole("role");
    const teamCaptain = interaction.options.getUser("team_captain");

    // Verify the team captain is a member of the guild
    try {
      await interaction.guild.members.fetch(teamCaptain.id);
    } catch (error) {
      await interaction.editReply("❌ The specified team captain is not a member of this server.");
      return;
    }

    await roleService.updateRoleTeamCaptain(
      interaction.guild.id,
      panelId,
      role.id,
      teamCaptain.id
    );

    await interaction.editReply(
      `✅ **${teamCaptain.displayName}** (${teamCaptain.tag}) is now the team captain for **${role.name}** in panel **${panelId}**!\n\nUse \`/update_panel panel_id:${panelId}\` to refresh the panel.`
    );
  } catch (error) {
    console.error("Error in handleSetTeamCaptain:", error);
    if (error.message.includes("not found") && error.message.includes("Panel")) {
      await interaction.editReply(`❌ Panel "${interaction.options.getString("panel_id")}" not found.`);
    } else if (error.message.includes("not found")) {
      await interaction.editReply("❌ This role was not found in this panel.");
    } else {
      await interaction.editReply("❌ An error occurred while setting the team captain.");
    }
  }
}

async function handleSetPanelApprovalChannel(interaction) {
  try {
    const panelId = interaction.options.getString("panel_id");
    const approvalChannel = interaction.options.getChannel("approval_channel");

    // Validate approval channel
    if (approvalChannel.type !== ChannelType.GuildText) {
      await interaction.editReply("❌ Please select a text channel for the approval channel.");
      return;
    }

    // Check bot permissions in approval channel
    const approvalPermissions = approvalChannel.permissionsFor(interaction.guild.members.me);
    if (!approvalPermissions.has(["SendMessages", "ViewChannel", "EmbedLinks", "AddReactions"])) {
      await interaction.editReply("❌ I don't have permission to send messages, view channel, embed links, or add reactions in the approval channel. Please ensure I have the necessary permissions.");
      return;
    }

    await roleService.updatePanelApprovalChannel(
      interaction.guild.id,
      panelId,
      approvalChannel.id
    );

    await interaction.editReply(
      `✅ Approval channel for panel **${panelId}** set to ${approvalChannel}!\n\nAll approval requests for roles in this panel will now be sent to this channel.`
    );
  } catch (error) {
    console.error("Error in handleSetPanelApprovalChannel:", error);
    if (error.message.includes("not found")) {
      await interaction.editReply(`❌ Panel "${interaction.options.getString("panel_id")}" not found.`);
    } else {
      await interaction.editReply("❌ An error occurred while setting the approval channel.");
    }
  }
}

async function handleSetRoleApprovalChannel(interaction) {
  try {
    const panelId = interaction.options.getString("panel_id");
    const role = interaction.options.getRole("role");
    const approvalChannel = interaction.options.getChannel("approval_channel");

    // Validate approval channel
    if (approvalChannel.type !== ChannelType.GuildText) {
      await interaction.editReply("❌ Please select a text channel for the approval channel.");
      return;
    }

    const approvalPermissions = approvalChannel.permissionsFor(interaction.guild.members.me);
    if (!approvalPermissions.has(["SendMessages", "ViewChannel", "EmbedLinks", "AddReactions"])) {
      await interaction.editReply("❌ I don't have permission to send messages, view channel, embed links, or add reactions in the approval channel. Please ensure I have the necessary permissions.");
      return;
    }

    await roleService.updateRoleApprovalChannel(interaction.guild.id, panelId, role.id, approvalChannel.id);

    await interaction.editReply(`✅ Set approval channel for **${role.name}** in panel **${panelId}** to ${approvalChannel}!\n\nUse \`/update_panel panel_id:${panelId}\` to refresh the panel.`);
  } catch (error) {
    console.error("Error in handleSetRoleApprovalChannel:", error);
    if (error.message.includes("not found") && error.message.includes("Panel")) {
      await interaction.editReply(`❌ Panel "${interaction.options.getString("panel_id")}" not found.`);
    } else if (error.message.includes("not found")) {
      await interaction.editReply("❌ This role was not found in this panel.");
    } else {
      await interaction.editReply("❌ An error occurred while setting the approval channel.");
    }
  }
}

async function handleSetRoleButtonColor(interaction) {
  try {
    const panelId = interaction.options.getString("panel_id");
    const role = interaction.options.getRole("role");
    const buttonColor = interaction.options.getString("button_color");

    await roleService.updateRoleButtonColor(interaction.guild.id, panelId, role.id, buttonColor);

    const colorNames = {
      'Primary': 'Blue (Primary)',
      'Secondary': 'Gray (Secondary)',
      'Success': 'Green (Success)',
      'Danger': 'Red (Danger)'
    };

    await interaction.editReply(`✅ Set button color for **${role.name}** in panel **${panelId}** to **${colorNames[buttonColor]}**!\n\nUse \`/update_panel panel_id:${panelId}\` to refresh the panel.`);
  } catch (error) {
    console.error("Error in handleSetRoleButtonColor:", error);
    if (error.message.includes("not found") && error.message.includes("Panel")) {
      await interaction.editReply(`❌ Panel "${interaction.options.getString("panel_id")}" not found.`);
    } else if (error.message.includes("not found")) {
      await interaction.editReply("❌ This role was not found in this panel.");
    } else if (error.message.includes("Invalid button color")) {
      await interaction.editReply("❌ Invalid button color specified.");
    } else {
      await interaction.editReply("❌ An error occurred while setting the button color.");
    }
  }
}

// NEW: Team Captain Management Functions
async function handleMyTeam(interaction) {
  try {
    const teamRole = interaction.options.getRole("team_role");
    const userId = interaction.user.id;

    // Get all panels to find which teams this user is a captain of
    const panels = await roleService.getAllPanels(interaction.guild.id);
    let captainTeams = [];

    // Find all teams where this user is a team captain
    for (const [panelId, panel] of Object.entries(panels)) {
      for (const role of panel.roles) {
        if (role.teamCaptainId === userId) {
          // Get role info and member count
          const guildRole = await interaction.guild.roles.fetch(role.roleId);
          if (guildRole) {
            // Fetch all guild members to ensure we have the complete member list
            await interaction.guild.members.fetch();
            
            // Now get all members with this role
            const members = guildRole.members.map(member => ({
              id: member.id,
              displayName: member.displayName,
              tag: member.user.tag,
              joinedAt: member.joinedAt
            }));

            captainTeams.push({
              roleId: role.roleId,
              roleName: role.roleName,
              panelId: panelId,
              panelName: panel.name,
              members: members,
              guildRole: guildRole
            });
          }
        }
      }
    }

    if (captainTeams.length === 0) {
      await interaction.editReply("❌ You are not a team captain for any roles in this server.");
      return;
    }

    // If specific team role requested, filter to that team
    if (teamRole) {
      const requestedTeam = captainTeams.find(team => team.roleId === teamRole.id);
      if (!requestedTeam) {
        await interaction.editReply(`❌ You are not the team captain for **${teamRole.name}**.`);
        return;
      }
      captainTeams = [requestedTeam];
    }

    // Create embed(s) showing team information
    const embeds = [];

    for (const team of captainTeams) {
      const embed = new EmbedBuilder()
        .setTitle(`👨‍✈️ Team Captain - ${team.roleName}`)
        .setDescription(`You are the captain of **${team.roleName}**`)
        .setColor(team.guildRole.color || 0x5865F2)
        .addFields([
          { name: "🏆 Team", value: `<@&${team.roleId}>`, inline: true },
          { name: "📋 Panel", value: team.panelName, inline: true },
          { name: "👥 Members", value: team.members.length.toString(), inline: true }
        ])
        .setFooter({ text: `${interaction.guild.name} • Team Management` })
        .setTimestamp();

      if (team.members.length === 0) {
        embed.addFields([
          { name: "📝 Team Status", value: "No members yet", inline: false }
        ]);
      } else {
        // Show team members (limit to avoid embed limits)
        const memberList = team.members.slice(0, 20).map((member, index) => 
          `${index + 1}. **${member.displayName}** (${member.tag})`
        ).join('\n');

        embed.addFields([
          { 
            name: `👥 Team Members ${team.members.length > 20 ? `(showing first 20 of ${team.members.length})` : ''}`, 
            value: memberList || "No members", 
            inline: false 
          }
        ]);

        if (team.members.length > 20) {
          embed.addFields([
            { name: "📄 Note", value: `Use \`/remove_team_member team_role:${team.roleName}\` to remove specific members.`, inline: false }
          ]);
        }
      }

      // Add management instructions
      embed.addFields([
        { 
          name: "🛠️ Team Management", 
          value: `• **Add Member**: \`/add_team_member team_role:${team.roleName} member:@username\`\n• **Remove Member**: \`/remove_team_member team_role:${team.roleName} member:@username\`\n• **View Approvals**: Check your approval channel for join requests\n• **Team Panel**: Members can join/leave through the role panel`, 
          inline: false 
        }
      ]);

      embeds.push(embed);
    }

    // Send response (Discord allows up to 10 embeds per message)
    const embedsToSend = embeds.slice(0, 10);
    await interaction.editReply({ embeds: embedsToSend });

    if (embeds.length > 10) {
      await interaction.followUp({ 
        content: `⚠️ You have more than 10 teams. Use \`/my_team team_role:@role\` to view specific teams.`,
        ephemeral: true 
      });
    }

  } catch (error) {
    console.error("Error in handleMyTeam:", error);
    await interaction.editReply("❌ An error occurred while retrieving your team information.");
  }
}

async function handleRemoveTeamMember(interaction) {
  try {
    const teamRole = interaction.options.getRole("team_role");
    const memberToRemove = interaction.options.getUser("member");
    const reason = interaction.options.getString("reason") || "No reason provided";
    const userId = interaction.user.id;

    // Check if the user is a team captain for this role
    const panels = await roleService.getAllPanels(interaction.guild.id);
    const isTeamCaptain = Object.values(panels).some(panel =>
      panel.roles.some(role => role.roleId === teamRole.id && role.teamCaptainId === userId)
    );

    if (!isTeamCaptain) {
      await interaction.editReply(`❌ You are not the team captain for **${teamRole.name}**.`);
      return;
    }

    // Check if the target user is actually a member of the team
    const targetMember = await interaction.guild.members.fetch(memberToRemove.id);
    if (!targetMember.roles.cache.has(teamRole.id)) {
      await interaction.editReply(`❌ **${memberToRemove.displayName}** is not a member of **${teamRole.name}**.`);
      return;
    }

    // Prevent captains from removing themselves (they can leave through the panel)
    if (memberToRemove.id === userId) {
      await interaction.editReply("❌ You cannot remove yourself as team captain. Use the role panel to leave the team or contact an admin to change team captains.");
      return;
    }

    // Remove the role from the target member
    await targetMember.roles.remove(teamRole.id);

    // Send notification to the removed member
    try {
      const captain = await interaction.guild.members.fetch(userId);
      
      const removalEmbed = new EmbedBuilder()
        .setTitle("⚠️ Removed from Team")
        .setDescription("You have been removed from a team")
        .setColor(0xFF6B6B)
        .addFields([
          { name: "🏆 Team", value: `<@&${teamRole.id}>`, inline: true },
          { name: "🏠 Server", value: interaction.guild.name, inline: true },
          { name: "👨‍✈️ Removed By", value: `${captain.displayName} (Team Captain)`, inline: true },
          { name: "📝 Reason", value: reason, inline: false },
          { name: "ℹ️ Next Steps", value: "You can rejoin this team anytime through the role panel if you meet the requirements.", inline: false }
        ])
        .setThumbnail(interaction.guild.iconURL())
        .setFooter({ text: `${interaction.guild.name} • Team Management` })
        .setTimestamp();

      await targetMember.send({ embeds: [removalEmbed] });
    } catch (dmError) {
      console.log(`Could not send removal notification to ${memberToRemove.tag}: ${dmError.message}`);
    }

    // Send confirmation to the team captain
    const confirmationEmbed = new EmbedBuilder()
      .setTitle("✅ Team Member Removed")
      .setDescription("Successfully removed team member")
      .setColor(0x00FF00)
      .addFields([
        { name: "🚴 Removed Member", value: `${targetMember.displayName} (${memberToRemove.tag})`, inline: true },
        { name: "🏆 From Team", value: teamRole.toString(), inline: true },
        { name: "📝 Reason", value: reason, inline: false },
        { name: "👥 Team Status", value: `${teamRole.members.size} members remaining`, inline: true }
      ])
      .setFooter({ text: `${interaction.guild.name} • Team Management` })
      .setTimestamp();

    await interaction.editReply({ embeds: [confirmationEmbed] });

    // Log the action for admins (optional - could log to a moderation channel)
    console.log(`Team Captain ${interaction.user.tag} removed ${memberToRemove.tag} from ${teamRole.name}. Reason: ${reason}`);

  } catch (error) {
    console.error("Error in handleRemoveTeamMember:", error);
    await interaction.editReply("❌ An error occurred while removing the team member.");
  }
}

async function handleAddTeamMember(interaction) {
  try {
    const teamRole = interaction.options.getRole("team_role");
    const memberToAdd = interaction.options.getUser("member");
    const reason = interaction.options.getString("reason") || "No reason provided";
    const userId = interaction.user.id;

    // Check if the user is a team captain for this role
    const panels = await roleService.getAllPanels(interaction.guild.id);
    let isTeamCaptain = false;
    let teamInfo = null;

    for (const [panelId, panel] of Object.entries(panels)) {
      const roleConfig = panel.roles.find(role => role.roleId === teamRole.id && role.teamCaptainId === userId);
      if (roleConfig) {
        isTeamCaptain = true;
        teamInfo = { panelId, panelName: panel.name, roleConfig };
        break;
      }
    }

    if (!isTeamCaptain) {
      await interaction.editReply(`❌ You are not the team captain for **${teamRole.name}**.`);
      return;
    }

    // Fetch target member and check current membership
    const targetMember = await interaction.guild.members.fetch(memberToAdd.id);
    if (targetMember.roles.cache.has(teamRole.id)) {
      await interaction.editReply(`❌ **${targetMember.displayName}** is already a member of **${teamRole.name}**.`);
      return;
    }

    // Check prerequisites for this role if configured
    const roleAccess = await roleService.canUserGetRole(interaction.guild, memberToAdd.id, teamInfo.roleConfig);
    if (!roleAccess.canGetRole) {
      const missingRolesList = roleAccess.missingRoles.join(", ");
      await interaction.editReply(`❌ Cannot add member. They are missing required role(s): **${missingRolesList}**`);
      return;
    }

    // If role requires approval, captain override should directly assign
    // Ensure bot can manage this role
    const botMember = interaction.guild.members.me;
    if (teamRole.position >= botMember.roles.highest.position) {
      await interaction.editReply("❌ I cannot manage this role. Please move my role above the team role in Server Settings.");
      return;
    }

    await targetMember.roles.add(teamRole.id);

    // Notify the added member
    try {
      const captain = await interaction.guild.members.fetch(userId);

      const addedEmbed = new EmbedBuilder()
        .setTitle("✅ Added to Team")
        .setDescription("You have been added to a team")
        .setColor(0x00FF00)
        .addFields([
          { name: "🏆 Team", value: `<@&${teamRole.id}>`, inline: true },
          { name: "🏠 Server", value: interaction.guild.name, inline: true },
          { name: "👨‍✈️ Added By", value: `${captain.displayName} (Team Captain)`, inline: true },
          { name: "📝 Note", value: reason, inline: false },
          { name: "ℹ️ Info", value: "You can leave this team anytime via the role panel.", inline: false }
        ])
        .setThumbnail(interaction.guild.iconURL())
        .setFooter({ text: `${interaction.guild.name} • Team Management` })
        .setTimestamp();

      await targetMember.send({ embeds: [addedEmbed] });
    } catch (dmError) {
      console.log(`Could not send add notification to ${memberToAdd.tag}: ${dmError.message}`);
    }

    // Confirmation to captain
    const confirmationEmbed = new EmbedBuilder()
      .setTitle("✅ Team Member Added")
      .setDescription("Successfully added team member")
      .setColor(0x00FF00)
      .addFields([
        { name: "🚴 New Member", value: `${targetMember.displayName} (${memberToAdd.tag})`, inline: true },
        { name: "🏆 To Team", value: teamRole.toString(), inline: true },
        { name: "📝 Note", value: reason, inline: false },
        { name: "👥 Team Status", value: `${teamRole.members.size} members now`, inline: true }
      ])
      .setFooter({ text: `${interaction.guild.name} • Team Management` })
      .setTimestamp();

    await interaction.editReply({ embeds: [confirmationEmbed] });

    // Optional log
    console.log(`Team Captain ${interaction.user.tag} added ${memberToAdd.tag} to ${teamRole.name}. Note: ${reason}`);

  } catch (error) {
    console.error("Error in handleAddTeamMember:", error);
    await interaction.editReply("❌ An error occurred while adding the team member.");
  }
}

async function handleSetRolePrerequisites(interaction) {
  try {
    const panelId = interaction.options.getString("panel_id");
    const role = interaction.options.getRole("role");
    const requiredRole1 = interaction.options.getRole("required_role_1");
    const requiredRole2 = interaction.options.getRole("required_role_2");
    const requiredRole3 = interaction.options.getRole("required_role_3");

    // Build required roles array
    const requiredRoles = [];
    if (requiredRole1) requiredRoles.push(requiredRole1.id);
    if (requiredRole2) requiredRoles.push(requiredRole2.id);
    if (requiredRole3) requiredRoles.push(requiredRole3.id);

    await roleService.updateRolePrerequisites(interaction.guild.id, panelId, role.id, requiredRoles);

    let response = `✅ Updated prerequisites for **${role.name}** in panel **${panelId}**!`;
    
    if (requiredRoles.length > 0) {
      const requiredRoleNames = [];
      if (requiredRole1) requiredRoleNames.push(requiredRole1.name);
      if (requiredRole2) requiredRoleNames.push(requiredRole2.name);
      if (requiredRole3) requiredRoleNames.push(requiredRole3.name);
      response += `\n🔑 **Required Roles**: ${requiredRoleNames.join(", ")}`;
    } else {
      response += `\n🔑 **Required Roles**: None (cleared all prerequisites)`;
    }

    response += `\n\nUse \`/update_panel panel_id:${panelId}\` to refresh the panel display.`;

    await interaction.editReply(response);
  } catch (error) {
    console.error("Error in handleSetRolePrerequisites:", error);
    if (error.message.includes("not found") && error.message.includes("Panel")) {
      await interaction.editReply(`❌ Panel "${interaction.options.getString("panel_id")}" not found.`);
    } else if (error.message.includes("not found")) {
      await interaction.editReply("❌ Role not found in this panel.");
    } else {
      await interaction.editReply("❌ An error occurred while updating role prerequisites.");
    }
  }
}

module.exports = {
  // Legacy handlers
  handleSetupRoles,
  handleAddSelfRole,
  handleRemoveSelfRole,
  handleRolesPanel,
  handleRolesHelp,
  // New panel handlers
  handleSetupPanel,
  handleAddPanelRole,
  handleRemovePanelRole,
  handleUpdatePanel,
  handleListPanels,
  // New approval handlers
  handleSetRoleApproval,
  handlePendingApprovals,
  handleSetTeamCaptain,
  handleSetPanelApprovalChannel,
  handleSetRoleApprovalChannel,
  handleSetRoleButtonColor,
  handleSetRolePrerequisites,
  // NEW: Team Captain Management Functions
  handleMyTeam,
  handleRemoveTeamMember,
  handleAddTeamMember,
}; 