const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { db } = require("./firebase");
const approvalService = require("./approvalService");

class RoleService {
  constructor() {
    this.collection = "selfRoles";
  }

  // Legacy method - setup single role system (for backward compatibility)
  async setupRoleSystem(guildId, channelId) {
    try {
      const docRef = db.collection(this.collection).doc(guildId);
      const doc = await docRef.get();

      let data = doc.exists ? doc.data() : {};

      // If this is a legacy setup, convert to new panel structure
      if (!data.panels) {
        data.panels = {};
      }

      // Create default panel
      data.panels['default'] = {
        channelId: channelId,
        name: "Server Roles",
        description: "Click the buttons below to add or remove roles!",
        roles: data.roles || [],
        panelMessageId: data.panelMessageId || null,
        requiredRoles: [],
        order: 1,
        createdAt: data.createdAt || new Date(),
        updatedAt: new Date()
      };

      // Clean up old structure
      delete data.channelId;
      delete data.roles;
      delete data.panelMessageId;

      data.createdAt = data.createdAt || new Date();
      data.updatedAt = new Date();

      await docRef.set(data);
      return true;
    } catch (error) {
      console.error("Error setting up role system:", error);
      return false;
    }
  }

  // NEW: Setup a specific role panel
  async setupRolePanel(guildId, panelId, channelId, name, description = null, requiredRoles = [], approvalChannelId = null) {
    try {
      const docRef = db.collection(this.collection).doc(guildId);
      const doc = await docRef.get();

      const data = doc.exists ? doc.data() : { panels: {} };

      // Initialize panels object if it doesn't exist
      if (!data.panels) {
        data.panels = {};
      }

      // Create or update the specific panel
      data.panels[panelId] = {
        channelId: channelId,
        name: name,
        description: description || "Click the buttons below to add or remove roles!",
        roles: data.panels[panelId]?.roles || [],
        panelMessageId: null,
        requiredRoles: requiredRoles,
        approvalChannelId: approvalChannelId,
        order: Object.keys(data.panels).length + 1,
        createdAt: data.panels[panelId]?.createdAt || new Date(),
        updatedAt: new Date()
      };

      data.createdAt = data.createdAt || new Date();
      data.updatedAt = new Date();

      await docRef.set(data, { merge: true });

      return true;
    } catch (error) {
      console.error("Error setting up role panel:", error);
      return false;
    }
  }

  // Legacy method - add role to default panel (for backward compatibility)
  async addSelfRole(guildId, roleId, roleName, description = null, emoji = null) {
    return this.addSelfRoleToPanel(guildId, 'default', roleId, roleName, description, emoji);
  }

  // NEW: Add role to specific panel
  async addSelfRoleToPanel(guildId, panelId, roleId, roleName, description = null, emoji = null, requiresApproval = false, teamCaptainId = null, roleApprovalChannelId = null, buttonColor = 'Secondary', requiredRoles = []) {
    try {
      const docRef = db.collection(this.collection).doc(guildId);
      const doc = await docRef.get();

      if (!doc.exists || !doc.data().panels || !doc.data().panels[panelId]) {
        throw new Error(`Panel "${panelId}" not found. Use /setup_panel first.`);
      }

      const data = doc.data();
      const panel = data.panels[panelId];

      // Check if role already exists in this panel
      if (panel.roles.some(role => role.roleId === roleId)) {
        throw new Error("This role is already in this panel.");
      }

      panel.roles.push({
        roleId,
        roleName,
        description,
        emoji,
        requiresApproval,
        teamCaptainId, // The specific user who can approve this role
        roleApprovalChannelId, // Role-specific approval channel
        buttonColor, // Individual button color for this role
        requiredRoles, // NEW: Individual role prerequisites
        addedAt: new Date()
      });

      panel.updatedAt = new Date();
      data.updatedAt = new Date();

      await docRef.set(data);
      return true;
    } catch (error) {
      console.error("Error adding role to panel:", error);
      throw error;
    }
  }

  // Legacy method - remove role from default panel (for backward compatibility)
  async removeSelfRole(guildId, roleId) {
    return this.removeSelfRoleFromPanel(guildId, 'default', roleId);
  }

  // NEW: Remove role from specific panel
  async removeSelfRoleFromPanel(guildId, panelId, roleId) {
    try {
      const docRef = db.collection(this.collection).doc(guildId);
      const doc = await docRef.get();

      if (!doc.exists || !doc.data().panels || !doc.data().panels[panelId]) {
        throw new Error(`Panel "${panelId}" not found.`);
      }

      const data = doc.data();
      const panel = data.panels[panelId];
      const originalLength = panel.roles.length;

      panel.roles = panel.roles.filter(role => role.roleId !== roleId);

      if (panel.roles.length === originalLength) {
        throw new Error("This role was not found in this panel.");
      }

      panel.updatedAt = new Date();
      data.updatedAt = new Date();

      await docRef.set(data);
      return true;
    } catch (error) {
      console.error("Error removing role from panel:", error);
      throw error;
    }
  }

  // Legacy method - get default panel config (for backward compatibility)
  async getRoleConfig(guildId) {
    const panels = await this.getAllPanels(guildId);
    if (panels.default) {
      return {
        channelId: panels.default.channelId,
        roles: panels.default.roles,
        panelMessageId: panels.default.panelMessageId,
        createdAt: panels.default.createdAt,
        updatedAt: panels.default.updatedAt
      };
    }
    return null;
  }

  // NEW: Get specific panel configuration
  async getPanelConfig(guildId, panelId) {
    try {
      const docRef = db.collection(this.collection).doc(guildId);
      const doc = await docRef.get();

      if (!doc.exists || !doc.data().panels || !doc.data().panels[panelId]) {
        return null;
      }

      return { ...doc.data().panels[panelId], panelId };
    } catch (error) {
      console.error("Error getting panel config:", error);
      return null;
    }
  }

  // NEW: Get all panels for a guild
  async getAllPanels(guildId) {
    try {
      const docRef = db.collection(this.collection).doc(guildId);
      const doc = await docRef.get();

      if (!doc.exists || !doc.data().panels) {
        return {};
      }

      // Add panelId to each panel object
      const panels = doc.data().panels;
      Object.keys(panels).forEach(panelId => {
        panels[panelId].panelId = panelId;
      });

      return panels;
    } catch (error) {
      console.error("Error getting all panels:", error);
      return {};
    }
  }

  // NEW: Check if user has required roles for a panel
  async canUserAccessPanel(guild, userId, panelConfig) {
    if (!panelConfig.requiredRoles || panelConfig.requiredRoles.length === 0) {
      return { canAccess: true, missingRoles: [] };
    }

    try {
      const member = await guild.members.fetch(userId);
      const missingRoles = [];

      for (const requiredRoleId of panelConfig.requiredRoles) {
        if (!member.roles.cache.has(requiredRoleId)) {
          const role = await guild.roles.fetch(requiredRoleId);
          missingRoles.push(role ? role.name : 'Unknown Role');
        }
      }

      return {
        canAccess: missingRoles.length === 0,
        missingRoles: missingRoles
      };
    } catch (error) {
      console.error("Error checking panel access:", error);
      return { canAccess: false, missingRoles: ['Error checking permissions'] };
    }
  }

  // NEW: Check if user has required roles for a specific role
  async canUserGetRole(guild, userId, roleConfig) {
    if (!roleConfig.requiredRoles || roleConfig.requiredRoles.length === 0) {
      return { canGetRole: true, missingRoles: [] };
    }

    try {
      const member = await guild.members.fetch(userId);
      const missingRoles = [];

      for (const requiredRoleId of roleConfig.requiredRoles) {
        if (!member.roles.cache.has(requiredRoleId)) {
          const role = await guild.roles.fetch(requiredRoleId);
          missingRoles.push(role ? role.name : 'Unknown Role');
        }
      }

      return {
        canGetRole: missingRoles.length === 0,
        missingRoles: missingRoles
      };
    } catch (error) {
      console.error("Error checking role prerequisites:", error);
      return { canGetRole: false, missingRoles: ['Error checking permissions'] };
    }
  }

  // Legacy method - update panel message ID for default panel
  async updatePanelMessageId(guildId, messageId) {
    return this.updatePanelMessageIdForPanel(guildId, 'default', messageId);
  }

  // NEW: Update panel message ID for specific panel
  async updatePanelMessageIdForPanel(guildId, panelId, messageId) {
    try {
      const docRef = db.collection(this.collection).doc(guildId);
      const doc = await docRef.get();

      if (!doc.exists || !doc.data().panels || !doc.data().panels[panelId]) {
        return false;
      }

      const data = doc.data();
      data.panels[panelId].panelMessageId = messageId;
      data.panels[panelId].updatedAt = new Date();
      data.updatedAt = new Date();

      await docRef.set(data);
      return true;
    } catch (error) {
      console.error("Error updating panel message ID:", error);
      return false;
    }
  }

  // Legacy method - create role panel for default panel
  async createRolePanel(roles, guildName) {
    const panelConfig = {
      name: "Role Selection",
      description: "Click the buttons below to add or remove roles!",
      panelId: 'default'
    };
    return await this.createRolePanelForPanel(roles, guildName, panelConfig, true);
  }

  // NEW: Create role panel for specific panel with access checks
  async createRolePanelForPanel(roles, guildName, panelConfig, userHasAccess = true) {
    // Build the message content as regular text instead of embed
    let messageContent = `# 🔑 ${panelConfig.name}\n\n`;

    if (panelConfig.description) {
      messageContent += `${panelConfig.description}\n`;
    } else {
      messageContent += `Click the buttons below to add or remove roles!\n`;
    }

    if (!userHasAccess) {
      messageContent += "❌ You don't have the required roles to access this panel.";
      return { content: messageContent, components: [] };
    }

    if (roles.length === 0) {
      messageContent += "No roles are currently available in this panel.";
      return { content: messageContent, components: [] };
    }

    // Pre-fetch all unique team captain IDs to improve cache hit rate
    const uniqueCaptainIds = [...new Set(roles.filter(role => role.teamCaptainId).map(role => role.teamCaptainId))];
    if (uniqueCaptainIds.length > 0) {
      console.log(`🔄 Pre-fetching ${uniqueCaptainIds.length} team captains for role panel...`);
      try {
        // Batch fetch all team captains
        await panelConfig.guild.members.fetch({ user: uniqueCaptainIds, force: false });
        console.log(`✅ Pre-fetch completed for team captains`);
      } catch (error) {
        console.log(`⚠️ Batch pre-fetch failed, will fetch individually: ${error.message}`);
      }
    }

    // Fetch all team captains to ensure consistent username display
    const teamCaptains = new Map();

    // Group all captains to fetch them efficiently
    for (const role of roles) {
      if (role.teamCaptainId && !teamCaptains.has(role.teamCaptainId)) {
        try {
          // Fetch the member if not already in cache. Using force: false to leverage pre-fetch.
          const member = await panelConfig.guild.members.fetch(role.teamCaptainId, { force: false });

          if (member && member.user) {
            // Use both mention formats to maximize compatibility
            const mention = `<@!${role.teamCaptainId}>`;
            teamCaptains.set(role.teamCaptainId, mention);
            console.log(`✅ Successfully fetched team captain: ${member.displayName || member.user.username} (${role.teamCaptainId})`);
          } else {
            throw new Error("Member fetch returned null/undefined");
          }
        } catch (error) {
          console.warn(`⚠️ Could not fetch team captain ${role.teamCaptainId}:`, error.message);

          // Try to get from cache as last resort
          const cachedMember = panelConfig.guild.members.cache.get(role.teamCaptainId);
          if (cachedMember) {
            teamCaptains.set(role.teamCaptainId, `<@!${role.teamCaptainId}>`);
            console.log(`✅ Using cached member for team captain: ${cachedMember.displayName || cachedMember.user.username}`);
          } else {
            // Final fallback - use basic mention
            teamCaptains.set(role.teamCaptainId, `<@${role.teamCaptainId}>`);
            console.log(`⚠️ Using basic mention for team captain ${role.teamCaptainId}`);
          }
        }
      }
    }

    // Add available roles section
    messageContent += `## Available Roles\n`;

    const roleList = roles.map(role => {
      const description = role.description ? ` - ${role.description}` : "";
      const approvalIcon = role.requiresApproval ? " 🔐" : "";
      const teamCaptain = role.teamCaptainId ? ` ${teamCaptains.get(role.teamCaptainId)}` : "";
      const prerequisites = role.requiredRoles && role.requiredRoles.length > 0
        ? ` (requires: ${role.requiredRoles.map(roleId => `<@&${roleId}>`).join(", ")})`
        : "";
      return `${role.emoji || ""} **${role.roleName}**${description}${approvalIcon}${teamCaptain}${prerequisites}`;
    });

    // Add all roles to message content (no character limits like embed fields)
    messageContent += roleList.join("\n") + "\n\n";

    // Add approval info if any roles require approval
    const approvalRoles = roles.filter(role => role.requiresApproval);
    if (approvalRoles.length > 0) {
      messageContent += `🔐 = **Team Approval Required**\n\n`;
    }

    // Add required roles info if any
    if (panelConfig.requiredRoles && panelConfig.requiredRoles.length > 0) {
      const requiredRolesList = panelConfig.requiredRoles.map(roleId => `<@&${roleId}>`).join(", ");
      messageContent += `🔒 **Required Roles**: You need: ${requiredRolesList}\n\n`;
    }

    // Add custom footer text or fallback to default
    if (panelConfig.footerText) {
      // Use custom footer text if defined in the panel
      messageContent += `---\n${panelConfig.footerText.replace(/\\\\n/g, '\\n')}\n\n`;
    } else {
      // Add button color explanation
      messageContent += `---\n`;
      messageContent += `🔴 **Rød** = Løbsserie\n`;
      messageContent += `🔵 **Blå** = DZR hold\n`;
      messageContent += `**ZRL** = Zwift Racing League\n`;
      messageContent += `**DRS** = DIRT Racing Series\n\n`;

      // Add DZR website link
      messageContent += `🌐 **Mere information**\n`;
      messageContent += `Find fuld oversigt over DZR hold og søg hold på https://www.dzrracingseries.com/members-zone/zrl\n`;
    }

    // Create buttons (max 5 per row, max 5 rows = 25 buttons)
    const components = [];
    const maxButtonsPerRow = 5;
    const maxRows = 5;
    const maxButtons = maxButtonsPerRow * maxRows;

    for (let i = 0; i < Math.min(roles.length, maxButtons); i += maxButtonsPerRow) {
      const row = new ActionRowBuilder();
      const rowRoles = roles.slice(i, i + maxButtonsPerRow);

      for (const role of rowRoles) {
        // Determine button style from role's buttonColor setting
        let buttonStyle = ButtonStyle.Secondary; // Default fallback
        switch (role.buttonColor) {
          case 'Primary':
            buttonStyle = ButtonStyle.Primary;
            break;
          case 'Success':
            buttonStyle = ButtonStyle.Success;
            break;
          case 'Danger':
            buttonStyle = ButtonStyle.Danger;
            break;
          case 'Secondary':
          default:
            buttonStyle = ButtonStyle.Secondary;
            break;
        }

        const button = new ButtonBuilder()
          .setCustomId(`role_toggle_${panelConfig.panelId || 'default'}_${role.roleId}`)
          .setLabel(role.roleName)
          .setStyle(buttonStyle);

        if (role.emoji) {
          // Check if it's a custom emoji or unicode
          if (role.emoji.match(/^<:\w+:\d+>$/)) {
            // Custom emoji format
            const emojiMatch = role.emoji.match(/<:\w+:(\d+)>/);
            if (emojiMatch) {
              button.setEmoji(emojiMatch[1]);
            }
          } else {
            // Unicode emoji
            button.setEmoji(role.emoji);
          }
        }

        row.addComponents(button);
      }

      components.push(row);
    }

    // Safety check: Discord content has 2000 character limit
    // If we're getting close, switch to an embed which allows 4096 in description
    if (messageContent.length > 1900) {
      console.log(`⚠️ Panel content length (${messageContent.length}) is near limits. Switching to Embed format.`);

      const embed = new EmbedBuilder()
        .setTitle(`🔑 ${panelConfig.name}`)
        .setColor(0x5865F2);

      // Remove the main header from the content as it becomes the embed title
      let embedDescription = messageContent.replace(`# 🔑 ${panelConfig.name}\n\n`, "");

      // Check for Embed description limit (4096)
      if (embedDescription.length > 4096) {
        console.warn(`🚨 Panel still too large for embed description (${embedDescription.length}). Truncating.`);
        embedDescription = embedDescription.substring(0, 4090) + "...";
      }

      embed.setDescription(embedDescription);

      return { content: "", embeds: [embed], components };
    }

    return { content: messageContent, components };
  }

  // NEW: Update role approval requirement
  async updateRoleApprovalRequirement(guildId, panelId, roleId, requiresApproval) {
    try {
      const docRef = db.collection(this.collection).doc(guildId);
      const doc = await docRef.get();

      if (!doc.exists || !doc.data().panels || !doc.data().panels[panelId]) {
        throw new Error(`Panel "${panelId}" not found.`);
      }

      const data = doc.data();
      const panel = data.panels[panelId];

      // Find the role and update it
      const roleIndex = panel.roles.findIndex(role => role.roleId === roleId);
      if (roleIndex === -1) {
        throw new Error("Role not found in this panel.");
      }

      panel.roles[roleIndex].requiresApproval = requiresApproval;
      panel.updatedAt = new Date();
      data.updatedAt = new Date();

      await docRef.set(data);
      return true;
    } catch (error) {
      console.error("Error updating role approval requirement:", error);
      throw error;
    }
  }

  // Toggle role for a user (updated to handle approval workflow)
  async toggleUserRole(guild, userId, roleId, panelId = null) {
    try {
      const member = await guild.members.fetch(userId);
      const role = await guild.roles.fetch(roleId);

      if (!role) {
        throw new Error("Role not found.");
      }

      // Check if bot can manage this role
      const botMember = await guild.members.fetch(guild.client.user.id);
      if (role.position >= botMember.roles.highest.position) {
        throw new Error("I don't have permission to manage this role. Please ensure my role is higher than the roles I need to manage.");
      }

      const hasRole = member.roles.cache.has(roleId);

      // If user is removing the role, proceed immediately with notifications
      if (hasRole) {
        await member.roles.remove(roleId);

        // Notify team captain if one is assigned
        if (panelId) {
          try {
            const panelConfig = await this.getPanelConfig(guild.id, panelId);
            if (panelConfig) {
              const roleConfig = panelConfig.roles.find(r => r.roleId === roleId);
              if (roleConfig && roleConfig.teamCaptainId) {
                try {
                  const captain = await guild.members.fetch(roleConfig.teamCaptainId);

                  const leaveEmbed = new EmbedBuilder()
                    .setTitle("🚪 Team Member Left")
                    .setDescription("A rider has left your team")
                    .setColor(0xFFA500)
                    .addFields([
                      { name: "🚴 Rider", value: `${member.displayName} (${member.user.tag})`, inline: true },
                      { name: "🏆 Team", value: `<@&${roleId}>`, inline: true },
                      { name: "📋 Panel", value: panelConfig.name, inline: true },
                      { name: "🕐 Left At", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: false }
                    ])
                    .setThumbnail(member.user.displayAvatarURL())
                    .setFooter({ text: `${guild.name} • Team Management` })
                    .setTimestamp();

                  await captain.send({ embeds: [leaveEmbed] });
                } catch (dmError) {
                  console.log(`Could not send leave notification to team captain: ${dmError.message}`);
                }
              }
            }
          } catch (configError) {
            console.log(`Could not get panel config for leave notification: ${configError.message}`);
          }
        }

        return { action: "removed", roleName: role.name };
      }

      // If user is adding the role, check prerequisites and approval requirements
      if (panelId) {
        const panelConfig = await this.getPanelConfig(guild.id, panelId);
        if (panelConfig) {
          const roleConfig = panelConfig.roles.find(r => r.roleId === roleId);
          if (roleConfig) {
            // NEW: Check role prerequisites first
            const roleAccess = await this.canUserGetRole(guild, userId, roleConfig);
            if (!roleAccess.canGetRole) {
              const missingRolesList = roleAccess.missingRoles.join(", ");
              throw new Error(`You need the following roles first: ${missingRolesList}`);
            }

            // Check if role requires approval
            if (roleConfig.requiresApproval) {
              // Submit approval request instead of directly adding role
              const requestId = await approvalService.submitRoleRequest(
                guild.id,
                userId,
                roleId,
                role.name,
                panelId,
                panelConfig.name,
                roleConfig.teamCaptainId // Pass the team captain ID
              );

              // Send approval request to approval channel
              await approvalService.sendApprovalRequest(guild.client, requestId, {
                guildId: guild.id,
                userId: userId,
                roleId: roleId,
                roleName: role.name,
                panelId: panelId,
                panelName: panelConfig.name,
                teamCaptainId: roleConfig.teamCaptainId,
                approvalChannelId: roleConfig.roleApprovalChannelId || panelConfig.approvalChannelId, // Use role-specific or fallback to panel-level
                requestedAt: new Date()
              });

              return {
                action: "approval_requested",
                roleName: role.name,
                message: roleConfig.teamCaptainId
                  ? "Your request has been submitted for team captain approval. You will receive the role once your team captain approves it."
                  : "Your request has been submitted for admin approval. You will receive the role once an admin approves it."
              };
            }
          }
        }
      }

      // If no approval required, add the role immediately
      await member.roles.add(roleId);
      return { action: "added", roleName: role.name };

    } catch (error) {
      console.error("Error toggling user role:", error);
      throw error;
    }
  }

  // NEW: Get panel autocomplete options
  async getPanelAutocompleteOptions(guildId) {
    try {
      const panels = await this.getAllPanels(guildId);
      return Object.keys(panels).map(panelId => ({
        name: `${panels[panelId].name} (${panelId})`,
        value: panelId
      }));
    } catch (error) {
      console.error("Error getting panel autocomplete options:", error);
      return [];
    }
  }

  // NEW: Update team captain for a role
  async updateRoleTeamCaptain(guildId, panelId, roleId, teamCaptainId) {
    try {
      const docRef = db.collection(this.collection).doc(guildId);
      const doc = await docRef.get();

      if (!doc.exists || !doc.data().panels || !doc.data().panels[panelId]) {
        throw new Error(`Panel "${panelId}" not found.`);
      }

      const data = doc.data();
      const panel = data.panels[panelId];

      // Find the role and update it
      const roleIndex = panel.roles.findIndex(role => role.roleId === roleId);
      if (roleIndex === -1) {
        throw new Error("Role not found in this panel.");
      }

      panel.roles[roleIndex].teamCaptainId = teamCaptainId;
      panel.updatedAt = new Date();
      data.updatedAt = new Date();

      await docRef.set(data);
      return true;
    } catch (error) {
      console.error("Error updating role team captain:", error);
      throw error;
    }
  }

  // NEW: Update approval channel for a panel
  async updatePanelApprovalChannel(guildId, panelId, approvalChannelId) {
    try {
      const docRef = db.collection(this.collection).doc(guildId);
      const doc = await docRef.get();

      if (!doc.exists || !doc.data().panels || !doc.data().panels[panelId]) {
        throw new Error(`Panel "${panelId}" not found.`);
      }

      const data = doc.data();
      data.panels[panelId].approvalChannelId = approvalChannelId;
      data.panels[panelId].updatedAt = new Date();
      data.updatedAt = new Date();

      await docRef.set(data);
      return true;
    } catch (error) {
      console.error("Error updating panel approval channel:", error);
      throw error;
    }
  }

  // NEW: Update approval channel for a specific role
  async updateRoleApprovalChannel(guildId, panelId, roleId, approvalChannelId) {
    try {
      const docRef = db.collection(this.collection).doc(guildId);
      const doc = await docRef.get();

      if (!doc.exists || !doc.data().panels || !doc.data().panels[panelId]) {
        throw new Error(`Panel "${panelId}" not found.`);
      }

      const data = doc.data();
      const panel = data.panels[panelId];

      // Find the role and update it
      const roleIndex = panel.roles.findIndex(role => role.roleId === roleId);
      if (roleIndex === -1) {
        throw new Error("Role not found in this panel.");
      }

      panel.roles[roleIndex].roleApprovalChannelId = approvalChannelId;
      panel.updatedAt = new Date();
      data.updatedAt = new Date();

      await docRef.set(data);
      return true;
    } catch (error) {
      console.error("Error updating role approval channel:", error);
      throw error;
    }
  }

  // NEW: Update button color for a specific role
  async updateRoleButtonColor(guildId, panelId, roleId, buttonColor) {
    try {
      const docRef = db.collection(this.collection).doc(guildId);
      const doc = await docRef.get();

      if (!doc.exists || !doc.data().panels || !doc.data().panels[panelId]) {
        throw new Error(`Panel "${panelId}" not found.`);
      }

      const data = doc.data();
      const panel = data.panels[panelId];

      // Find the role and update it
      const roleIndex = panel.roles.findIndex(role => role.roleId === roleId);
      if (roleIndex === -1) {
        throw new Error("Role not found in this panel.");
      }

      // Validate button color
      const validColors = ['Primary', 'Secondary', 'Success', 'Danger'];
      if (!validColors.includes(buttonColor)) {
        throw new Error(`Invalid button color. Must be one of: ${validColors.join(', ')}`);
      }

      panel.roles[roleIndex].buttonColor = buttonColor;
      panel.updatedAt = new Date();
      data.updatedAt = new Date();

      await docRef.set(data);
      return true;
    } catch (error) {
      console.error("Error updating role button color:", error);
      throw error;
    }
  }

  // NEW: Update role prerequisites
  async updateRolePrerequisites(guildId, panelId, roleId, requiredRoles) {
    try {
      const docRef = db.collection(this.collection).doc(guildId);
      const doc = await docRef.get();

      if (!doc.exists || !doc.data().panels || !doc.data().panels[panelId]) {
        throw new Error(`Panel "${panelId}" not found.`);
      }

      const data = doc.data();
      const panel = data.panels[panelId];

      // Find the role and update it
      const roleIndex = panel.roles.findIndex(role => role.roleId === roleId);
      if (roleIndex === -1) {
        throw new Error("Role not found in this panel.");
      }

      panel.roles[roleIndex].requiredRoles = requiredRoles;
      panel.updatedAt = new Date();
      data.updatedAt = new Date();

      await docRef.set(data);
      return true;
    } catch (error) {
      console.error("Error updating role prerequisites:", error);
      throw error;
    }
  }
}

module.exports = new RoleService(); 