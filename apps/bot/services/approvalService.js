const { EmbedBuilder } = require("discord.js");
const { db } = require("./firebase");

class ApprovalService {
  constructor() {
    this.collection = "roleApprovals";
  }

  // Submit a role approval request
  async submitRoleRequest(guildId, userId, roleId, roleName, panelId, panelName, teamCaptainId = null) {
    try {
      const requestId = `${guildId}_${userId}_${roleId}_${Date.now()}`;
      
      const requestData = {
        guildId,
        userId,
        roleId,
        roleName,
        panelId,
        panelName,
        teamCaptainId, // The specific team captain who should approve this
        status: "pending",
        requestedAt: new Date(),
        approvedBy: null,
        approvedAt: null,
        approvalMessageId: null
      };

      // Store the request in Firebase
      await db.collection(this.collection).doc(requestId).set(requestData);

      return requestId;
    } catch (error) {
      console.error("Error submitting role request:", error);
      throw error;
    }
  }

  // Create approval message embed
  createApprovalEmbed(requestData, guild, user) {
    const embed = new EmbedBuilder()
      .setTitle("🏁 Team Join Request")
      .setDescription("A rider wants to join a team!")
      .setColor(0xFFAA00)
      .addFields([
        { name: "🚴 Rider", value: `${user.displayName} (${user.user.tag})`, inline: true },
        { name: "🏆 Team Role", value: `<@&${requestData.roleId}>`, inline: true },
        { name: "🕐 Requested At", value: `<t:${Math.floor(requestData.requestedAt.getTime() / 1000)}:R>`, inline: false }
      ])
      .setThumbnail(user.user.displayAvatarURL())
      .setTimestamp();

    // Add team captain information if specified
    if (requestData.teamCaptainId) {
      embed.addFields([
        { name: "👨‍✈️ Team Captain", value: `<@${requestData.teamCaptainId}>`, inline: true },
        { name: "✅ How to Approve", value: `<@${requestData.teamCaptainId}> React with ✅ to approve or ❌ to reject this rider!\n\n*Admins can also approve or reject this request.*`, inline: false }
      ]);
      embed.setFooter({ text: `${guild.name} • Team Captain: React ✅ to approve, ❌ to reject` });
    } else {
      embed.addFields([
        { name: "✅ How to Approve", value: "Admins: React with ✅ to approve or ❌ to reject this request.", inline: false }
      ]);
      embed.setFooter({ text: `${guild.name} • Admin approval required` });
    }

    return embed;
  }

  // Send approval request to approval channel
  async sendApprovalRequest(client, requestId, requestData) {
    try {
      const guild = await client.guilds.fetch(requestData.guildId);
      const user = await guild.members.fetch(requestData.userId);
      
      // Get approval channel from request data (panel-specific)
      let approvalChannel = null;
      
      if (requestData.approvalChannelId) {
        try {
          approvalChannel = await guild.channels.fetch(requestData.approvalChannelId);
        } catch (error) {
          console.warn("Could not fetch panel-specific approval channel:", error);
        }
      }
      
      // Fallback - find a channel with "approval" in the name
      if (!approvalChannel) {
        approvalChannel = guild.channels.cache.find(
          channel => channel.name.toLowerCase().includes("approval") && 
                    channel.isTextBased() &&
                    channel.permissionsFor(guild.members.me).has(["SendMessages", "ViewChannel", "EmbedLinks"])
        );
      }

      if (!approvalChannel) {
        throw new Error("No approval channel found. Please set an approval channel for this panel using `/set_panel_approval_channel` or create a channel with 'approval' in the name.");
      }

      const embed = this.createApprovalEmbed(requestData, guild, user);
      const message = await approvalChannel.send({ embeds: [embed] });

      // Add approve and reject reactions
      await message.react("✅");
      await message.react("❌");

      // Update request with message ID
      await db.collection(this.collection).doc(requestId).update({
        approvalMessageId: message.id,
        approvalChannelId: approvalChannel.id
      });

      return message;
    } catch (error) {
      console.error("Error sending approval request:", error);
      throw error;
    }
  }

  // Handle approval reaction
  async handleApprovalReaction(messageId, userId, guild, emoji) {
    // Find the approval request by message ID
    const snapshot = await db.collection(this.collection)
      .where("approvalMessageId", "==", messageId)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null; // No pending request found for this message
    }

    const requestDoc = snapshot.docs[0];
    const requestData = requestDoc.data();
    const requestId = requestDoc.id;

    // Check if user has permission to approve/reject
    const approver = await guild.members.fetch(userId);
    let hasPermission = false;
    let approverType = "";

    // Check if user is the designated team captain
    if (requestData.teamCaptainId && userId === requestData.teamCaptainId) {
      hasPermission = true;
      approverType = "Team Captain";
    }
    // Check if user is an admin (fallback)
    else if (approver.permissions.has("Administrator") || approver.permissions.has("ManageRoles")) {
      hasPermission = true;
      approverType = "Admin";
    }

    if (!hasPermission) {
      // Send ephemeral message if someone without permission tries to approve/reject
      return {
        approved: false,
        rejected: false,
        error: "You don't have permission to approve or reject this request. Only the team captain or admins can approve/reject.",
        requestData
      };
    }

    // Handle approval or rejection based on emoji
    if (emoji === "✅") {
      // Approve the request
      await this.approveRequest(requestId, userId, guild, approverType);
      return {
        approved: true,
        rejected: false,
        requestData,
        approver: approver.user,
        approverType
      };
    } else if (emoji === "❌") {
      // Reject the request
      await this.rejectRequest(requestId, userId, guild, approverType);
      return {
        approved: false,
        rejected: true,
        requestData,
        approver: approver.user,
        approverType
      };
    }

    return null; // Unknown emoji
  }

  // Approve a role request
  async approveRequest(requestId, approverId, guild, approverType = "Admin") {
    const requestDoc = await db.collection(this.collection).doc(requestId).get();

    if (!requestDoc.exists) {
      throw new Error("Request not found");
    }

    const requestData = requestDoc.data();

    if (requestData.status !== "pending") {
      throw new Error("Request is not pending");
    }

    // Get the user and role
    const member = await guild.members.fetch(requestData.userId);
    const role = await guild.roles.fetch(requestData.roleId);

    if (!role) {
      throw new Error("Role not found");
    }

    // Check if bot can manage this role
    const botMember = await guild.members.fetch(guild.client.user.id);
    if (role.position >= botMember.roles.highest.position) {
      throw new Error("Bot doesn't have permission to manage this role");
    }

    // Add the role to the user
    await member.roles.add(requestData.roleId);

    // Send approval notification to the user
    try {
      const approver = await guild.members.fetch(approverId);

      const approvalEmbed = new EmbedBuilder()
        .setTitle("✅ Team Join Request Approved!")
        .setDescription("Welcome to your new team!")
        .setColor(0x00FF00)
        .addFields([
          { name: "🏆 Team", value: `<@&${requestData.roleId}>`, inline: true },
          { name: "🏠 Server", value: guild.name, inline: true },
          { name: "👮 Approved By", value: `${approver.displayName} (${approverType})`, inline: true },
          { name: "🎉 Welcome!", value: "You have been successfully added to the team. You can leave anytime by clicking the role button again.", inline: false }
        ])
        .setThumbnail(guild.iconURL())
        .setFooter({ text: `${guild.name} • Team Management` })
        .setTimestamp();

      await member.send({ embeds: [approvalEmbed] });
    } catch (dmError) {
      console.log(`Could not send approval notification to ${member.user.tag}: ${dmError.message}`);
    }

    // Update request status
    await db.collection(this.collection).doc(requestId).update({
      status: "approved",
      approvedBy: approverId,
      approvedAt: new Date(),
      approverType: approverType
    });

    // Update the approval message
    const approvalChannel = await guild.channels.fetch(requestData.approvalChannelId);
    if (approvalChannel && requestData.approvalMessageId) {
      try {
        const approvalMessage = await approvalChannel.messages.fetch(requestData.approvalMessageId);
        const approver = await guild.members.fetch(approverId);

        const updatedEmbed = EmbedBuilder.from(approvalMessage.embeds[0])
          .setColor(0x00FF00)
          .setTitle("✅ Team Join Request - APPROVED")
          .addFields([
            { name: "👮 Approved By", value: `${approver.displayName} (${approver.user.tag})`, inline: true },
            { name: "✅ Approved At", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
            { name: "👥 Approver Type", value: approverType, inline: true }
          ]);

        await approvalMessage.edit({ embeds: [updatedEmbed] });
        await approvalMessage.reactions.removeAll();
      } catch (messageError) {
        console.error("Error updating approval message:", messageError);
      }
    }

    return true;
  }

  // Reject a role request
  async rejectRequest(requestId, rejecterId, guild, rejecterType = "Admin") {
    const requestDoc = await db.collection(this.collection).doc(requestId).get();

    if (!requestDoc.exists) {
      throw new Error("Request not found");
    }

    const requestData = requestDoc.data();

    if (requestData.status !== "pending") {
      throw new Error("Request is not pending");
    }

    // Get the user and role for validation
    const member = await guild.members.fetch(requestData.userId);
    const role = await guild.roles.fetch(requestData.roleId);

    if (!role) {
      throw new Error("Role not found");
    }

    // Send rejection notification to the user
    try {
      const rejecter = await guild.members.fetch(rejecterId);

      const rejectionEmbed = new EmbedBuilder()
        .setTitle("❌ Team Join Request Declined")
        .setDescription("Your team join request was not approved")
        .setColor(0xFF6B6B)
        .addFields([
          { name: "🏆 Team", value: `<@&${requestData.roleId}>`, inline: true },
          { name: "🏠 Server", value: guild.name, inline: true },
          { name: "👮 Declined By", value: `${rejecter.displayName} (${rejecterType})`, inline: true },
          { name: "ℹ️ Next Steps", value: "You can submit a new request anytime by clicking the role button again. Consider reaching out to the team captain if you have questions.", inline: false }
        ])
        .setThumbnail(guild.iconURL())
        .setFooter({ text: `${guild.name} • Team Management` })
        .setTimestamp();

      await member.send({ embeds: [rejectionEmbed] });
    } catch (dmError) {
      console.log(`Could not send rejection notification to ${member.user.tag}: ${dmError.message}`);
    }

    // Update request status to rejected
    await db.collection(this.collection).doc(requestId).update({
      status: "rejected",
      rejectedBy: rejecterId,
      rejectedAt: new Date(),
      rejecterType: rejecterType
    });

    // Update the approval message
    const approvalChannel = await guild.channels.fetch(requestData.approvalChannelId);
    if (approvalChannel && requestData.approvalMessageId) {
      try {
        const approvalMessage = await approvalChannel.messages.fetch(requestData.approvalMessageId);
        const rejecter = await guild.members.fetch(rejecterId);

        const updatedEmbed = EmbedBuilder.from(approvalMessage.embeds[0])
          .setColor(0xFF0000)
          .setTitle("❌ Team Join Request - REJECTED")
          .addFields([
            { name: "👮 Rejected By", value: `${rejecter.displayName} (${rejecter.user.tag})`, inline: true },
            { name: "❌ Rejected At", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
            { name: "👥 Rejecter Type", value: rejecterType, inline: true }
          ]);

        await approvalMessage.edit({ embeds: [updatedEmbed] });
        await approvalMessage.reactions.removeAll();
      } catch (messageError) {
        console.error("Error updating approval message:", messageError);
      }
    }

    return true;
  }

  // Get pending requests for a guild
  async getPendingRequests(guildId) {
    try {
      const snapshot = await db.collection(this.collection)
        .where("guildId", "==", guildId)
        .where("status", "==", "pending")
        .orderBy("requestedAt", "desc")
        .get();

      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error("Error getting pending requests:", error);
      return [];
    }
  }

  // Cleanup old requests (optional - can be called periodically)
  async cleanupOldRequests(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const snapshot = await db.collection(this.collection)
        .where("requestedAt", "<=", cutoffDate)
        .get();

      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      
      console.log(`Cleaned up ${snapshot.docs.length} old approval requests`);
      return snapshot.docs.length;
    } catch (error) {
      console.error("Error cleaning up old requests:", error);
      return 0;
    }
  }
}

module.exports = new ApprovalService(); 