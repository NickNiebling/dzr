const ladderTeams = require("../services/ladder/ladderTeams");
const ladderClient = require("../services/ladder/ladderClient");
const { buildLadderPreviewMessage, buildLadderScoutMessage } = require("../services/ladder/ladderEmbed");
const { buildLadderAnalysisMessage } = require("../services/ladder/ladderAnalysis");
const { buildLadderAiMessage } = require("../services/ladder/ladderAi");
const config = require("../config/config");

// The team from the option, else the team added from this channel, else the only added team.
async function resolveTeam(interaction) {
  const input = interaction.options.getString("team");
  if (input) return ladderTeams.parseTeamName(input);
  const inChannel = await ladderTeams.findByChannel(interaction.channelId);
  if (inChannel) return inChannel.name;
  const teams = await ladderTeams.list();
  return teams.length === 1 ? teams[0].name : null;
}

// Shown when no team was given and more (or fewer) than one team is added, so there is nothing to default to.
async function missingTeamMessage() {
  const names = (await ladderTeams.list()).map((team) => team.name);
  return names.length
    ? `Vælg et hold i feltet team, eller kør /ladder_link i denne kanal for at gøre holdet til standard her. Tilføjede hold: ${names.join(", ")}.`
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
  console.error(`❌ ${name} error:`, error);
  await interaction.editReply({ content: error.userMessage || "⚠️ Der skete en fejl." });
}

async function handleLadderLink(interaction) {
  try {
    const teamName = ladderTeams.parseTeamName(interaction.options.getString("team", true));
    if (!teamName) {
      await interaction.editReply({ content: "Angiv et holdnavn eller et ladder-link." });
      return;
    }

    if (interaction.options.getBoolean("remove")) {
      const removed = await ladderTeams.unlink(teamName);
      await interaction.editReply({ content: removed ? `${teamName} får ikke længere preview.` : `${teamName} var ikke tilføjet.` });
      return;
    }

    const minutes = interaction.options.getInteger("minutes");
    if (!(await ladderTeams.link(teamName, interaction.channelId))) {
      await interaction.editReply({ content: `Der kan højst tilføjes ${ladderTeams.MAX_TEAMS} hold. Fjern et hold først.` });
      return;
    }
    if (minutes) await ladderTeams.setPreviewMinutes(teamName, minutes);
    await interaction.editReply({
      content: `${teamName} får nu preview og løbsdag-besked i <#${config.ladder.channelId}>${minutes ? `, preview ${minutes} minutter før start` : ""}. Kommandoer i denne kanal bruger holdet som standard.`,
    });
  } catch (error) {
    await replyError(interaction, "ladder_link", error);
  }
}

async function handleLadderPreview(interaction) {
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
    // Deliberately does not mark the match as posted, so the scheduled preview is unaffected.
    await interaction.channel.send(await buildLadderPreviewMessage(fixture, teamName));
    await interaction.editReply({ content: "✅ Preview postet." });
  } catch (error) {
    await replyError(interaction, "ladder_preview", error);
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
    await interaction.editReply(await buildLadderScoutMessage(home, away));
  } catch (error) {
    await replyError(interaction, "ladder_scout", error);
  }
}

module.exports = { handleLadderLink, handleLadderPreview, handleLadderAnalysis, handleLadderAi, handleLadderScout };
