const crypto = require("crypto");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");

const REPORT_TTL_MS = 15 * 60 * 1000;
const ephemeralStore = new Map();

async function ephemeralReplyWithPublish(interaction, content, files = []) {
  const message = typeof content === "object" && content !== null ? content : { content, files };
  const hasEmbeds = Boolean(message.embeds?.length);
  const uniqueId = crypto.randomUUID();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`publish_${uniqueId}`)
      .setLabel(hasEmbeds ? "Post i kanalen" : "Publish to Channel")
      .setStyle(ButtonStyle.Primary)
  );

  ephemeralStore.set(uniqueId, message);
  try {
    await interaction.editReply({ ...message, components: [row] });
  } catch (error) {
    ephemeralStore.delete(uniqueId);
    throw error;
  }
  if (hasEmbeds) {
    // Release attachment buffers even if the report is never posted.
    setTimeout(() => ephemeralStore.delete(uniqueId), REPORT_TTL_MS).unref();
  }
}

async function handlePublishButton(interaction, uniqueId) {
  const stored = ephemeralStore.get(uniqueId);
  const preview = interaction.message;
  // Only older text replies can be recovered from their displayed content.
  const fallback = stored === undefined && !preview?.embeds?.length && preview?.content;
  const message = stored || (fallback && { content: fallback });

  if (!message) {
    await interaction.reply({
      content: stored === null ? "Opslaget er i gang." : "Resultatet kan ikke længere postes. Kør kommandoen igen.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  // Keep the entry reserved until this click finishes posting.
  ephemeralStore.set(uniqueId, null);
  try {
    await interaction.deferUpdate();
    await interaction.followUp(message);
  } catch (error) {
    if (stored && ephemeralStore.has(uniqueId)) {
      ephemeralStore.set(uniqueId, stored);
    } else {
      ephemeralStore.delete(uniqueId);
    }
    if (!interaction.deferred) throw error;
    console.error("Could not publish the preview:", error);
    await interaction.followUp({
      content: "Opslaget kunne ikke sendes. Prøv igen.",
      flags: MessageFlags.Ephemeral,
    }).catch(console.error);
    return false;
  }

  await interaction.editReply({ components: [] }).catch(console.error);
  ephemeralStore.delete(uniqueId);
  return true;
}

module.exports = {
  ephemeralReplyWithPublish,
  handlePublishButton,
};
