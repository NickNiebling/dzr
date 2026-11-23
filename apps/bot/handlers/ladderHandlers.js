const { createHash } = require("node:crypto");
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, MessagePayload, PermissionsBitField,
  SectionBuilder, TextDisplayBuilder, escapeMarkdown,
} = require("discord.js");
const ladderTeams = require("../services/ladder/ladderTeams");
const ladderClient = require("../services/ladder/ladderClient");
const { buildLadderOptaktMessage, buildLadderScoutMessage } = require("../services/ladder/ladderEmbed");
const { buildLadderAnalysisMessage } = require("../services/ladder/ladderAnalysis");
const { buildLadderAiMessage } = require("../services/ladder/ladderAi");
const config = require("../config/config");
const { ephemeralReplyWithPublish } = require("../utils/ephemeralStore");

const LADDER_TEAM_BUTTON_PREFIX = "ladder_team:";

// Prefer the explicit team, then the linked channel's team, then the only linked team.
async function resolveTeam(interaction) {
  const input = interaction.options.getString("team");
  if (input) return ladderTeams.parseTeamName(input);
  const { channel, channelId } = interaction;
  const inChannel = await ladderTeams.findByChannel(channel?.isThread() ? channel.parentId : channelId);
  if (inChannel) return inChannel.name;
  const teams = await ladderTeams.list();
  return teams.length === 1 ? teams[0].name : null;
}

// Shown when no team was given and more (or fewer) than one team is added, so there is nothing to default to.
async function missingTeamMessage() {
  const names = (await ladderTeams.list()).map((team) => team.name);
  return names.length
    ? `Vælg et hold i feltet team, eller brug /ladder_link til at vælge et standardhold for en kanal. Tilføjede hold: ${names.join(", ")}.`
    : "Der er ingen hold endnu. Tilføj et med /ladder_link.";
}

// Tells a team name the ladder does not know (no matches at all) from matches that have all started.
async function noFixtureMessage(teamName) {
  const count = (await ladderClient.getFixtures(teamName)).length;
  return count
    ? `Fandt ingen kommende kamp for ${teamName}. Ladder-siden viser ${count} kamp(e), men ingen med en starttid forude.`
    : `Ladder-siden viser ingen kampe for "${teamName}". Tjek, at holdnavnet er stavet som på ladder-siden.`;
}

async function findFixture(interaction, teamName) {
  const fixtureId = interaction.options.getInteger("match");
  const fixture = fixtureId ? await ladderClient.getFixture(fixtureId) : await ladderClient.getNextFixture(teamName);
  return fixture && fixture.start ? ladderClient.refreshFixture(fixture) : null;
}

async function replyError(interaction, name, error) {
  if (ladderClient.isAuthUnavailable(error)) {
    console.warn(`${name}:`, error.message);
  } else {
    console.error(`❌ ${name} error:`, error);
  }
  const content = error.userMessage || "⚠️ Der skete en fejl.";
  await interaction.editReply(name === "ladder_teams"
    ? ladderTeamsPayload(interaction, new TextDisplayBuilder().setContent(content))
    : { content });
}

function canManageLadderTeams(interaction) {
  return interaction.guildId === config.discord.guildId && interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
}

function ladderTeamButtonKey(team) {
  return createHash("sha256").update(team.name.toLowerCase()).digest("base64url");
}

function ladderTeamsPayload(interaction, ...components) {
  const message = interaction.message;
  const payload = {
    flags: MessageFlags.IsComponentsV2,
    components,
    allowedMentions: { parse: [] },
    // Buttons from the previous overview can still be clicked after deployment.
    ...(message?.embeds?.length && { embeds: [] }),
  };
  if (!message?.content) return payload;

  // Discord requires a null reset when converting a legacy confirmation to V2.
  const edit = MessagePayload.create(interaction.webhook, payload).resolveBody();
  edit.body.content = null;
  return edit;
}

function buildLadderTeamsOverview(teams) {
  const ladderOrigin = "https://ladder.cycleracing.club";
  const { channelId, optaktMin, tz } = config.ladder;
  const header = [
    "## Tilknyttede Ladder-hold",
    "**Standardkonfiguration**",
    `Ladder kanal: <#${channelId}>`,
    `Optakt: ${optaktMin} min før start`,
    `Tidszone: ${tz}`,
  ];
  if (!teams.length) {
    header.push("", "Der er ingen tilknyttede Ladder-hold. Tilføj et med `/ladder_link`.");
  }
  const headerText = header.join("\n");
  const overview = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
  // Budget the 4,000 characters of Text Display content across the whole message.
  const sectionTextBudget = Math.floor((4000 - headerText.length) / Math.max(1, teams.length));

  for (const team of teams.toSorted((a, b) => a.name.localeCompare(b.name, "da"))) {
    const channel = team.channelId ? `<#${team.channelId}>` : `<#${channelId}> (standard)`;
    const details = `### ${escapeMarkdown(team.name).slice(0, 256)}\n${channel} · ${team.optaktMin || optaktMin} min før start`;
    const links = [
      `[Holdside](<${ladderOrigin}/teamView/${encodeURIComponent(team.name)}>)`,
      `[Kampe](<${ladderOrigin}${ladderClient.fixturesPath(team.name)}>)`,
    ];
    const linkBudget = sectionTextBudget - details.length - 1;
    const allLinks = links.join(" · ");
    const visibleLinks = allLinks.length <= linkBudget ? allLinks : links.find((link) => link.length <= linkBudget);
    overview.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(visibleLinks ? `${details}\n${visibleLinks}` : details))
      .setButtonAccessory(new ButtonBuilder()
        .setCustomId(`${LADDER_TEAM_BUTTON_PREFIX}remove:${ladderTeamButtonKey(team)}`)
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🗑️")));
  }

  return overview;
}

async function handleLadderTeams(interaction) {
  if (!canManageLadderTeams(interaction)) {
    await interaction.editReply(ladderTeamsPayload(interaction, new TextDisplayBuilder()
      .setContent("Kun administratorer på DZR-serveren kan se Ladder-konfigurationen.")));
    return;
  }

  try {
    await interaction.editReply(ladderTeamsPayload(interaction, buildLadderTeamsOverview(await ladderTeams.list())));
  } catch (error) {
    await replyError(interaction, "ladder_teams", error);
  }
}

function isLadderTeamsButton(interaction) {
  return interaction.isButton() && interaction.customId.startsWith(LADDER_TEAM_BUTTON_PREFIX);
}

async function handleLadderTeamsButton(interaction) {
  if (!canManageLadderTeams(interaction)) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      components: [new TextDisplayBuilder().setContent("Kun administratorer på DZR-serveren kan fjerne Ladder-hold.")],
    });
    return;
  }

  await interaction.deferUpdate();
  try {
    const [action, id] = interaction.customId.slice(LADDER_TEAM_BUTTON_PREFIX.length).split(":");
    let teams = await ladderTeams.list();
    const team = id && teams.find((candidate) => ladderTeamButtonKey(candidate) === id);
    if (team && action === "remove") {
      await interaction.editReply(ladderTeamsPayload(interaction,
        new TextDisplayBuilder().setContent(`Fjern ${escapeMarkdown(team.name).slice(0, 256)}?`),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${LADDER_TEAM_BUTTON_PREFIX}confirm:${id}`).setStyle(ButtonStyle.Danger).setLabel("Fjern hold"),
          new ButtonBuilder().setCustomId(`${LADDER_TEAM_BUTTON_PREFIX}cancel`).setStyle(ButtonStyle.Secondary).setLabel("Annuller"),
        ),
      ));
      return;
    }

    if (team && action === "confirm") {
      await ladderTeams.unlink(team.name);
      teams = await ladderTeams.list();
    }
    await interaction.editReply(ladderTeamsPayload(interaction, buildLadderTeamsOverview(teams)));
  } catch (error) {
    await replyError(interaction, "ladder_teams", error);
  }
}

async function handleLadderLink(interaction) {
  if (interaction.guildId !== config.discord.guildId) {
    await interaction.editReply({ content: "Denne kommando kan kun bruges på DZR-serveren." });
    return;
  }

  const canManage = canManageLadderTeams(interaction);
  try {
    const teamName = ladderTeams.parseTeamName(interaction.options.getString("team", true));
    if (!teamName) {
      await interaction.editReply({ content: "Angiv et holdnavn eller et ladder-link." });
      return;
    }

    if (interaction.options.getBoolean("remove")) {
      if (!canManage) {
        await interaction.editReply({ content: "Kun administratorer kan fjerne Ladder-hold." });
        return;
      }
      const removed = await ladderTeams.unlink(teamName);
      await interaction.editReply({ content: removed ? `${teamName} er fjernet fra Ladder-oversigten.` : `${teamName} var ikke tilføjet.`, allowedMentions: { parse: [] } });
      return;
    }

    const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId);
    const channelId = channel?.isThread() ? channel.parentId : channel?.id;
    if (!channelId) {
      await interaction.editReply({ content: "Kunne ikke finde kanalen til holdet." });
      return;
    }

    const optaktMin = interaction.options.getInteger("minutes");
    const { team, error } = await ladderTeams.link(teamName, channelId, optaktMin, canManage);
    if (error) {
      const messages = {
        admin_required: "Kun administratorer kan ændre kanal eller optakttid for et eksisterende Ladder-hold.",
        channel_taken: "Kanalen er allerede tilknyttet et andet Ladder-hold.",
        team_limit: `Der kan højst tilføjes ${ladderTeams.MAX_TEAMS} hold. En administrator kan fjerne et hold.`,
      };
      await interaction.editReply({ content: messages[error] });
      return;
    }
    const effectiveOptaktMin = team.optaktMin || config.ladder.optaktMin;
    await interaction.editReply({
      content: `✅ ${escapeMarkdown(team.name)} er tilknyttet <#${team.channelId}>.\n\nOptakt og løbsdagsbeskeder sendes til denne kanal.\n\nOptakt: ${effectiveOptaktMin} min før start.`,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    await replyError(interaction, "ladder_link", error);
  }
}

async function handleLadderOptakt(interaction) {
  try {
    const teamName = await resolveTeam(interaction);
    if (!teamName) {
      await interaction.editReply({ content: await missingTeamMessage() });
      return;
    }
    const fixture = await findFixture(interaction, teamName);
    if (!fixture) {
      await interaction.editReply({ content: await noFixtureMessage(teamName) });
      return;
    }
    // Manual posts leave the scheduled optakt pending.
    await interaction.channel.send(await buildLadderOptaktMessage(fixture, teamName));
    await interaction.editReply({ content: "✅ Optakt sendt." });
  } catch (error) {
    await replyError(interaction, "ladder_optakt", error);
  }
}

async function handleLadderAnalysis(interaction) {
  try {
    const teamName = await resolveTeam(interaction);
    if (!teamName) {
      await interaction.editReply({ content: await missingTeamMessage() });
      return;
    }
    const fixture = await findFixture(interaction, teamName);
    if (!fixture) {
      await interaction.editReply({ content: await noFixtureMessage(teamName) });
      return;
    }
    await interaction.editReply(await buildLadderAnalysisMessage(fixture, teamName));
  } catch (error) {
    await replyError(interaction, "ladder_analysis", error);
  }
}

async function handleLadderAi(interaction) {
  try {
    const teamName = await resolveTeam(interaction);
    if (!teamName) {
      await interaction.editReply({ content: await missingTeamMessage() });
      return;
    }
    const fixture = await findFixture(interaction, teamName);
    if (!fixture) {
      await interaction.editReply({ content: await noFixtureMessage(teamName) });
      return;
    }
    await interaction.editReply(await buildLadderAiMessage(fixture, teamName, { userId: interaction.user.id }));
  } catch (error) {
    await replyError(interaction, "ladder_ai", error);
  }
}

async function handleLadderScout(interaction) {
  try {
    const team = interaction.options.getString("team", true);
    const opponent = interaction.options.getString("opponent", true);
    const linked = await ladderTeams.getTeam(team);
    if (!linked) {
      await interaction.editReply({ content: "Vælg et DZR-hold fra listen i team. Listen kommer fra /ladder_link." });
      return;
    }
    const [homeTeam, awayTeam] = await Promise.all([ladderClient.resolveTeam(linked.name), ladderClient.resolveTeam(opponent)]);
    if (String(homeTeam.id) === String(awayTeam.id)) {
      await interaction.editReply({ content: "Vælg to forskellige hold; team og opponent er det samme hold." });
      return;
    }
    const [home, away] = await Promise.all([ladderClient.getRoster(homeTeam), ladderClient.getRoster(awayTeam)]);
    await ephemeralReplyWithPublish(interaction, await buildLadderScoutMessage(home, away));
  } catch (error) {
    await replyError(interaction, "ladder_scout", error);
  }
}

module.exports = {
  handleLadderTeams,
  isLadderTeamsButton,
  handleLadderTeamsButton,
  handleLadderLink,
  handleLadderOptakt,
  handleLadderAnalysis,
  handleLadderAi,
  handleLadderScout,
};
