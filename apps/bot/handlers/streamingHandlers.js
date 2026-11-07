const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, MessageFlags, PermissionsBitField } = require("discord.js");
const { StreamingError } = require("../services/streaming/model");

const COMMANDS = ["streaming_add", "streaming_remove", "streaming_overview"];
const isStreamingInteraction = (interaction) => COMMANDS.includes(interaction.commandName) || String(interaction.customId || "").startsWith("streaming:");
const stamp = (time) => time ? `<t:${Math.floor(time / 1000)}:f>` : "Endnu ikke set live";
const button = (action, userId, label, style = ButtonStyle.Primary) => new ButtonBuilder()
  .setCustomId(`streaming:${action}:${userId}`).setLabel(label).setStyle(style);
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);

function createStreamingHandlers({ service, guildId, adminRoleId, publicUrl, channelId, getClubRoleId = async () => null }) {
  const baseUrl = publicUrl.replace(/\/$/, "");

  async function overview(interaction) {
    const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)
      || interaction.member?.roles?.cache?.has(adminRoleId) || interaction.member?.roles?.includes?.(adminRoleId);
    if (!isAdmin) throw new StreamingError("forbidden", "Kun administratorer kan se streaming-overblikket.", 403);
    const registrations = (await service.overview()).sort((a, b) => a.discordId.localeCompare(b.discordId));
    const issues = await service.issues();
    const page = interaction.options.getInteger("page") || 1;
    const pages = Math.max(1, Math.ceil(registrations.length / 8));
    const selected = registrations.slice((Math.min(page, pages) - 1) * 8, Math.min(page, pages) * 8);
    const embed = new EmbedBuilder().setTitle("DZR Streaming").setColor(0x3498db)
      .setDescription(`${registrations.length} tilmeldte · Side ${Math.min(page, pages)}/${pages}\nAnnonceringer: <#${channelId}>`);
    for (const member of selected) {
      const channelLinks = Object.entries(member.channels).map(([platform, channel]) => `[${platform === "youtube" ? "YouTube" : "Twitch"}](${channel.url})`).join(" · ");
      const streamLinks = Object.entries(member.lastStreams || {}).map(([platform, stream]) => `[Seneste ${platform}-stream](${stream.url})`).join(" · ");
      const errors = [...new Set(issues.filter((item) => item.memberId === member.id).map((item) => item.lastError))];
      embed.addFields({ name: member.discordName.slice(0, 100), value: `<@${member.discordId}> · ${channelLinks}\nSenest gået live: ${stamp(member.lastLiveAt)}`
        + (streamLinks ? `\n${streamLinks}` : "") + (errors.length ? `\n⚠️ ${errors.join(", ")}` : "") });
    }
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  async function handle(interaction) {
    if (!isStreamingInteraction(interaction)) return false;
    try {
      if (interaction.guildId !== guildId || interaction.user.bot) {
        throw new StreamingError("guild_required", "Brug kommandoen på DZR-serveren.", 403);
      }
      const userId = interaction.user.id;
      const [, action, owner] = String(interaction.customId || "").split(":");
      if (interaction.customId && owner !== userId) throw new StreamingError("not_owner", "Start dit eget flow med /streaming_add.", 403);

      if (["streaming_add", "streaming_remove"].includes(interaction.commandName) || ["channels", "save", "remove"].includes(action)) {
        const clubRoleId = await getClubRoleId();
        const eligible = clubRoleId && (interaction.member?.roles?.cache?.has(clubRoleId) || interaction.member?.roles?.includes?.(clubRoleId));
        if (!eligible) throw new StreamingError("club_member_required", "Streaming er kun tilgængelig for Club Members.", 403);
      }

      if (interaction.isButton() && action === "channels") {
        const registration = await service.getRegistration(userId);
        const modal = new ModalBuilder().setCustomId(`streaming:save:${userId}`).setTitle("Dine streamingkanaler");
        for (const [platform, label, placeholder] of [["youtube", "YouTube-kanal (valgfri)", "https://www.youtube.com/@din-kanal"], ["twitch", "Twitch-kanal (valgfri)", "https://www.twitch.tv/din-kanal"]]) {
          const input = new TextInputBuilder().setCustomId(platform).setLabel(label).setStyle(TextInputStyle.Short)
            .setRequired(false).setMaxLength(200).setPlaceholder(placeholder);
          if (registration?.channels[platform]) input.setValue(registration.channels[platform].url);
          modal.addComponents(new ActionRowBuilder().addComponents(input));
        }
        await interaction.showModal(modal);
        return true;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (interaction.isModalSubmit() && action === "save") {
        const { registration, token } = await service.enroll(userId, interaction.user.username, {
          youtube: interaction.fields.getTextInputValue("youtube"), twitch: interaction.fields.getTextInputValue("twitch"),
        });
        await interaction.editReply({ content:
          `✅ **Dine kanaler er tilmeldt**\n${Object.entries(registration.channels).map(([platform, channel]) => `${platform}: ${channel.url}`).join("\n")}\n\n`
          + `**Gør OBS klar — én gang:**\n1. [Download dzr-stream.lua](${baseUrl}/streaming/dzr-stream.lua).\n`
          + "2. Åbn OBS → Værktøjer / Tools → Scripts → **+**, og vælg filen.\n"
          + `3. Indsæt callback-adressen i **DZR endpoint**:\n\`${baseUrl}/streaming/obs\`\n`
          + `4. Indsæt denne personlige nøgle i **DZR key**:\n\`${token}\`\n`
          + "5. Tryk **Test forbindelse** i OBS. DZR finder selv, hvilke af dine tilmeldte kanaler der er live.\n\n"
          + "Nøglen vises kun her. Del den ikke. En tidligere nøgle er nu ugyldig. "
          + "Du kan få en ny med /streaming_add og afmelde dig med /streaming_remove.\n"
          + `Når din offentlige stream er bekræftet live, poster DZR én besked i <#${channelId}>. Ekstra platforme tilføjes til samme opslag, hvis de bliver fundet inden for fem minutter. Planlagte streams annonceres ikke.`,
          components: [row(button("status", userId, "Kontrollér OBS-forbindelse", ButtonStyle.Secondary))], allowedMentions: { parse: [] } });
      } else if (interaction.commandName === "streaming_add") {
        const existing = await service.getRegistration(userId);
        await interaction.editReply({ content: "**Tilmeld din streaming til DZR**\n"
          + "Først angiver du dine egne YouTube- og/eller Twitch-kanaler. Derefter får du OBS-scriptet, en installationsvejledning og din personlige nøgle.\n\n"
          + (existing ? "Du er allerede tilmeldt. Når du gemmer formularen, erstattes kanalerne og din gamle nøgle. Opdatér derefter nøglen i OBS." : "Du behøver ikke forbinde din Google- eller Twitch-konto. Opsætningen er kun synlig for dig."),
          components: [row(button("channels", userId, existing ? "Redigér kanaler og få ny nøgle" : "Angiv streamingkanaler"))] });
      } else if (interaction.commandName === "streaming_remove") {
        await interaction.editReply({ content: "Vil du afmelde din streaming? Din DZR-nøgle spærres, og ventende annonceringer stoppes. Fjern også scriptet fra OBS bagefter.",
          components: [row(button("remove", userId, "Afmeld min streaming", ButtonStyle.Danger), button("cancel", userId, "Behold tilmelding", ButtonStyle.Secondary))] });
      } else if (interaction.isButton() && action === "remove") {
        const removed = await service.remove(userId);
        await interaction.editReply({ content: removed ? "Du er afmeldt. Din nøgle virker ikke længere. Du kan nu fjerne dzr-stream.lua fra OBS." : "Du er ikke tilmeldt streaming." });
      } else if (interaction.isButton() && action === "cancel") {
        await interaction.editReply({ content: "Din tilmelding er uændret." });
      } else if (interaction.isButton() && action === "status") {
        const registration = await service.getRegistration(userId);
        await interaction.editReply({ content: registration?.lastCallbackAt
          ? `✅ DZR har modtaget et signal fra OBS ${stamp(registration.lastCallbackAt)}. En test sender ingen offentlig Discord-besked.`
          : "Der er endnu ikke modtaget et signal. Kontrollér adresse og nøgle, og tryk Test forbindelse i OBS." });
      } else if (interaction.commandName === "streaming_overview") {
        await overview(interaction);
      } else {
        await interaction.editReply({ content: "Start igen med /streaming_add." });
      }
    } catch (error) {
      // In particular, never log Discord payloads: onboarding contains the one-time plaintext key.
      const content = error instanceof StreamingError ? error.userMessage : "DZR Streaming kunne ikke gennemføre handlingen. Prøv igen om lidt.";
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [] });
        else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      } catch { /* An expired interaction contains no recoverable reply path. */ }
    }
    return true;
  }

  return { handle };
}

module.exports = { createStreamingHandlers, isStreamingInteraction };
