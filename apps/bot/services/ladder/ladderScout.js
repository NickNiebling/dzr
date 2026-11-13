const { AttachmentBuilder, EmbedBuilder, escapeMarkdown } = require("discord.js");
const ladderTeams = require("./ladderTeams");
const ladderCatalog = require("./ladderCatalog");
const ladderClient = require("./ladderClient");
const { enrichRiders } = require("./riderPower");
const { buildLadderChart } = require("./ladderChart");

const DURATIONS = [15, 60, 120, 300, 1200];
const LABELS = ["15s", "1 min", "2 min", "5 min", "20 min"];
const hasPower = (rider) => DURATIONS.some((seconds) => Number.isFinite(rider.wkg[seconds]) && rider.wkg[seconds] > 0);
const fmt = (value) => Number.isFinite(value) ? value.toFixed(2) : "-";
const clip = (text, max) => text.length <= max ? text : `${text.slice(0, max - 3)}...`;

function userError(message) {
  const error = new Error(message);
  error.userMessage = message;
  return error;
}

function missingLine(team, predicate) {
  const riders = team.riders.filter(predicate);
  const names = riders.length ? ` (${riders.map((rider) => rider.name).join(", ")})` : "";
  return clip(`${team.name}: ${riders.length}${names}`, 500);
}

function scoutEmbed(home, away) {
  return new EmbedBuilder()
    .setTitle(clip(`Ladder scout: ${home.name} mod ${away.name}`, 256))
    .setURL(home.url)
    .setDescription(
      `[${escapeMarkdown(home.name)}](${home.url}): **${home.riders.length} ryttere i truppen**\n` +
      `[${escapeMarkdown(away.name)}](${away.url}): **${away.riders.length} ryttere i truppen**`
    )
    .setColor(0xff6600)
    .addFields(
      { name: "Mangler Zwift-id", value: [home, away].map((team) => missingLine(team, (rider) => !rider.zwiftId)).join("\n") },
      { name: "Mangler power", value: [home, away].map((team) => missingLine(team, (rider) => !hasPower(rider))).join("\n") }
    )
    .setFooter({ text: "Hele aktuelle trupper | Power: ZwiftPower (90 dage), ellers Ladder | ZRS: Zwift" });
}

function rosterText(team) {
  return [
    `${team.name}: ${team.riders.length} ryttere i truppen`,
    team.url,
    `Navn | Zwift-id | ${LABELS.join(" | ")} (W/kg)`,
    ...team.riders.map((rider) => `${rider.name} | ${rider.zwiftId || "mangler"} | ${DURATIONS.map((seconds) => fmt(rider.wkg[seconds])).join(" | ")}`),
  ].join("\n");
}

function averages(team) {
  return `${team.name}: ${DURATIONS.map((seconds, i) => {
    const values = team.riders.map((rider) => rider.wkg[seconds]).filter((value) => Number.isFinite(value) && value > 0);
    return `${LABELS[i]} ${values.length ? fmt(values.reduce((sum, value) => sum + value, 0) / values.length) : "-"}`;
  }).join(" | ")}`;
}

// The existing enrichment uses its shared power cache; both complete rosters are kept for the chart.
async function buildLadderScoutMessage(home, away, { enrich = enrichRiders, render = buildLadderChart } = {}) {
  await enrich([...home.riders, ...away.riders]);
  const embed = scoutEmbed(home, away);
  const comparison = { home, away, scout: true };
  try {
    const png = await render(comparison, home.name);
    embed.setImage("attachment://scout.png");
    return { content: "", embeds: [embed], files: [new AttachmentBuilder(png, { name: "scout.png" })], allowedMentions: { parse: [] } };
  } catch (error) {
    console.warn("[ladderScout] Chart rendering failed, using text:", error.message);
    embed.addFields({ name: "Gennemsnit (W/kg)", value: clip([home, away].map(averages).join("\n"), 1024) });
    // A text attachment preserves every member even when the roster exceeds Discord's embed limits.
    return {
      content: "Grafikken kunne ikke tegnes. Hele sammenligningen er vedhæftet som tekst.",
      embeds: [embed],
      files: [new AttachmentBuilder(Buffer.from([rosterText(home), rosterText(away)].join("\n\n"), "utf8"), { name: "scout.txt" })],
      allowedMentions: { parse: [] },
    };
  }
}

async function scoutTeams(teamInput, opponentInput, {
  listTeams = ladderTeams.list,
  resolveTeam = ladderCatalog.resolveTeam,
  loadRoster = ladderClient.getRoster,
  buildMessage = buildLadderScoutMessage,
} = {}) {
  if (!teamInput || !opponentInput) throw userError("Både team og opponent skal udfyldes.");
  const linked = (await listTeams()).find((team) => team.name.toLowerCase() === teamInput.trim().toLowerCase());
  if (!linked) throw userError("Vælg et DZR-hold fra listen i team. Listen kommer fra /ladder_link.");
  const [homeTeam, awayTeam] = await Promise.all([resolveTeam(linked.name), resolveTeam(opponentInput)]);
  if (String(homeTeam.id) === String(awayTeam.id)) throw userError("Vælg to forskellige hold; team og opponent er det samme hold.");
  const [home, away] = await Promise.all([loadRoster(homeTeam), loadRoster(awayTeam)]);
  return buildMessage(home, away);
}

module.exports = { buildLadderScoutMessage, scoutTeams };
