const crypto = require("crypto");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");

const REPORT_TTL_MS = 15 * 60 * 1000;
const ephemeralStore = new Map();

function ephemeralReplyWithPublish(interaction, content, files = []) {
  return ephemeralMessageWithPublish(interaction, { content, files });
}

async function ephemeralMessageWithPublish(interaction, message, label = "Publish to Channel") {
  const uniqueId = crypto.randomUUID();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`publish_${uniqueId}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Primary)
  );
  // Reports keep their original attachment buffers so they can be uploaded again.
  const timeout = message.embeds?.length
    ? setTimeout(() => ephemeralStore.delete(uniqueId), REPORT_TTL_MS).unref()
    : undefined;
  ephemeralStore.set(uniqueId, { message, timeout, publishing: false });

  try {
    await interaction.editReply({ ...message, components: [row] });
  } catch (error) {
    clearTimeout(timeout);
    ephemeralStore.delete(uniqueId);
    throw error;
  }
}

/**
 * Handle publish button clicks
 */
async function handlePublishButton(interaction, uniqueId) {
  const stored = ephemeralStore.get(uniqueId);
  if (stored) {
    const isReport = Boolean(stored.message.embeds?.length);
    if (stored.publishing) {
      await interaction.reply({
        content: isReport ? "Rapporten bliver allerede postet." : "This result is already being published.",
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }
    stored.publishing = true;
    try {
      await interaction.deferUpdate();
      await interaction.followUp(stored.message);
    } catch (error) {
      stored.publishing = false;
      if (!interaction.deferred) throw error;
      console.error("Could not publish the preview:", error);
      await interaction.followUp({
        content: isReport ? "Rapporten kunne ikke postes. Prøv igen." : "Could not publish this result. Try again.",
        flags: MessageFlags.Ephemeral,
      }).catch((feedbackError) => {
        console.error("Could not report the publish failure:", feedbackError);
      });
      return false;
    }
    await interaction.editReply({ components: [] }).catch((error) => {
      console.error("Could not remove the publish button:", error);
    });
    clearTimeout(stored.timeout);
    ephemeralStore.delete(uniqueId);
    return true;
  }

  if (interaction.message?.embeds?.length) {
    await interaction.reply({
      content: "Rapporten er allerede postet eller udløbet. Kør kommandoen igen for at lave en ny.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  // Fallback: publish the content from the ephemeral message itself (text-only)
  const fallbackContent = interaction?.message?.content;
  if (fallbackContent && fallbackContent.length > 0) {
    await interaction.deferUpdate();
    await interaction.followUp({ content: fallbackContent, ephemeral: false });
    try {
      await interaction.editReply({ components: [] });
    } catch {}
    return true;
  }

  await interaction.reply({
    content: "❌ Could not find the content to publish.", 
    flags: MessageFlags.Ephemeral
  });
  return false;
}

module.exports = {
  ephemeralStore,
  ephemeralMessageWithPublish,
  ephemeralReplyWithPublish,
  handlePublishButton,
};
