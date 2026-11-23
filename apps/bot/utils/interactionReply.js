const { MessageFlags, MessagePayload, TextDisplayBuilder } = require("discord.js");

function componentsV2Reply(components, flags = 0) {
  return { flags: flags | MessageFlags.IsComponentsV2, components, allowedMentions: { parse: [] } };
}

function editComponentsV2(interaction, components) {
  const reply = componentsV2Reply(components);
  // Only component updates edit the source message. A separate reply has its own message.
  const message = interaction.ephemeral === null ? interaction.message : undefined;
  if (message?.embeds?.length) reply.embeds = [];
  if (!message?.content) return interaction.editReply(reply);

  // Discord needs a raw null to clear existing content when switching to V2.
  const payload = MessagePayload.create(interaction.webhook, reply).resolveBody();
  payload.body.content = null;
  return interaction.editReply(payload);
}

function editTextReply(interaction, content, { useComponentsV2 = false } = {}) {
  // A fresh deferred reply needs an explicit format until its first edit.
  const editingV2 = interaction.ephemeral === null && interaction.message?.flags?.has(MessageFlags.IsComponentsV2);
  if (useComponentsV2 || editingV2) {
    return editComponentsV2(interaction, [new TextDisplayBuilder().setContent(content)]);
  }
  return interaction.editReply({ content });
}

module.exports = { componentsV2Reply, editComponentsV2, editTextReply };
