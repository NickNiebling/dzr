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
        const installation = new EmbedBuilder().setTitle("1. Hent og tilføj hjælpefilen i OBS").setColor(0x3498db)
          .setDescription(`1. [Download dzr-stream.lua](${baseUrl}/streaming/dzr-stream.lua) på den computer, hvor du bruger OBS.\n`
            + "2. Åbn **OBS Studio**, programmet du streamer fra.\n"
            + "3. Vælg **Værktøjer / Tools → Scripts** i menuen øverst i OBS.\n"
            + "4. Klik på **+** (plusset) under listen med scripts.\n"
            + "5. Find og vælg **dzr-stream.lua**, som du lige har downloadet. Den ligger ofte i **Downloads / Overførsler**. Klik **Åbn / Open**.\n"
            + "6. Klik på **dzr-stream.lua** i listen. Nu vises de felter, du skal udfylde i næste afsnit.");
        const settings = new EmbedBuilder().setTitle("2. Forbind OBS med DZR").setColor(0x3498db)
          .setDescription("Udfyld felterne for **dzr-stream.lua** i Scripts-vinduet. Feltnavnene nedenfor er de samme som i OBS.")
          .addFields(
            { name: "DZR endpoint — DZR-adresse", value: `Kopiér denne adresse, og indsæt den i **DZR endpoint**:\n\`${baseUrl}/streaming/obs\`` },
            { name: "DZR key — din personlige DZR-nøgle", value: `Kopiér denne nøgle, og indsæt den i **DZR key**:\n\`${token}\`\n`
              + "Den forbinder OBS med din DZR-tilmelding. Det er ikke din streamnøgle til YouTube eller Twitch.\n"
              + "Nøglen vises kun i denne private besked. Del den ikke. En tidligere DZR-nøgle er nu ugyldig; opdatér derfor også OBS, hvis du var tilmeldt før." },
            { name: "Platform", value: "Vælg **YouTube** eller **Twitch**, alt efter hvor du streamer fra dette OBS. Vælg en platform, du har tilmeldt ovenfor.\n"
              + "**YouTube-videolink** er valgfrit og kan stå tomt." },
          );
        const connection = new EmbedBuilder().setTitle("3. Test forbindelsen").setColor(0x3498db)
          .setDescription("1. Klik på **Test forbindelse** i OBS.\n"
            + "2. Gå tilbage til denne besked i Discord, og klik på **Kontrollér OBS-forbindelse** nedenfor.\n"
            + "3. Du skal se en bekræftelse med tidspunktet for signalet fra OBS. Kontrollér, at tidspunktet passer med din test.\n\n"
            + "Hvis der ikke er modtaget et signal: Kontrollér **DZR endpoint** og **DZR key** i OBS, tryk **Test forbindelse** igen, og kontrollér derefter i Discord.\n\n"
            + `Testen sender ingen offentlig besked. Når din offentlige stream er bekræftet live, poster DZR én besked i <#${channelId}>. Planlagte streams annonceres ikke.\n\n`
            + "Du kan afmelde dig med /streaming_remove. Har du mistet DZR-nøglen, kan du få en ny med /streaming_add. Det gør den gamle nøgle ugyldig, så husk at opdatere OBS.");
        await interaction.editReply({ content:
          `✅ **Dine kanaler er tilmeldt — gør nu OBS klar**\n${Object.entries(registration.channels).map(([platform, channel]) => `${platform === "youtube" ? "YouTube" : "Twitch"}: ${channel.url}`).join("\n")}\n\n`
          + "Følg de tre afsnit nedenfor på din OBS-computer. Opsætningen er kun synlig for dig.",
          embeds: [installation, settings, connection],
          components: [row(button("status", userId, "Kontrollér OBS-forbindelse", ButtonStyle.Secondary))], allowedMentions: { parse: [] } });
      } else if (interaction.commandName === "streaming_add") {
        const existing = await service.getRegistration(userId);
        await interaction.editReply({ content: "**Tilmeld din streaming til DZR**\n"
          + "Få automatisk en besked i DZR, når din stream går live. Først angiver du din YouTube- eller Twitch-kanal. Derefter hjælper vi dig med at tilføje en lille hjælpefil i **OBS Studio**, programmet du streamer fra.\n\n"
          + "Klik på knappen nedenfor, og indsæt linket til din egen kanal, fx `https://www.youtube.com/@din-kanal` eller `https://www.twitch.tv/din-kanal`. Udfyld mindst én kanal; den anden må gerne være tom.\n\n"
          + "Opsætningen er kun synlig for dig. Du behøver ikke forbinde din Google- eller Twitch-konto.\n\n"
          + (existing ? "**Du er allerede tilmeldt.** Når du gemmer formularen, erstattes kanalerne og din gamle DZR-nøgle. Opdatér derefter nøglen i OBS." : "Når du har gemt formularen, får du en vejledning trin for trin."),
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
