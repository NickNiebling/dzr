const { AttachmentBuilder, EmbedBuilder, escapeMarkdown } = require("discord.js");
const { buildLadderChart } = require("./ladderChart");
const { describeProfile, loadMatchProfile } = require("./routeInfo");
const { placePowerups } = require("../powerupPlaces");
const { renderRouteProfile } = require("../routeProfileChart");
const { enrichRiders } = require("./riderPower");

const DURATIONS = [
  { seconds: 15, label: "15s" },
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 300, label: "5 min" },
  { seconds: 1200, label: "20 min" },
];

const FIELD_LIMIT = 1024;

function clip(text, limit = FIELD_LIMIT) {
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

function fmt(value) {
  return typeof value === "number" ? value.toFixed(2) : "-";
}

function stats(riders, seconds) {
  const values = riders.map((r) => r.wkg[seconds]).filter((v) => typeof v === "number");
  if (!values.length) return { avg: null, max: null };
  return { avg: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) };
}

function riderLines(team) {
  if (!team.riders.length) return "Ingen tilmeldte endnu";
  return team.riders
    .map((r) => `${r.name}: ${DURATIONS.map((d) => `${d.label} ${fmt(r.wkg[d.seconds])}`).join(" | ")}`)
    .join("\n");
}

function comparisonLines(home, away) {
  return DURATIONS.map((d) => {
    const h = stats(home.riders, d.seconds);
    const a = stats(away.riders, d.seconds);
    return `${d.label}: ${home.name} ${fmt(h.avg)} (max ${fmt(h.max)}) | ${away.name} ${fmt(a.avg)} (max ${fmt(a.max)})`;
  }).join("\n");
}

// Embed accent colour = our team's club colour from ladder, falling back to the default orange.
function accentColor(fixture, ourTeam) {
  const awayIsUs = ourTeam && fixture.away.name && fixture.away.name.toLowerCase() === ourTeam.toLowerCase();
  const hex = fixture.colors && (awayIsUs ? fixture.colors.away : fixture.colors.home);
  return /^#[0-9a-f]{6}$/i.test(hex || "") ? parseInt(hex.slice(1), 16) : 0xff6600;
}

// Builds the ladder preview embed from a parsed fixture (see ladderParser.js).
// With compact=true the rider/average text is left out because the chart image shows it.
function buildLadderPreviewEmbed(fixture, { compact = false, ourTeam = null, info = null } = {}) {
  const { home, away } = fixture;
  const ts = Math.floor(new Date(fixture.start).getTime() / 1000);
  const route = fixture.route
    ? [
        `${fixture.route}${fixture.world ? ` (${fixture.world})` : ""}`,
        fixture.laps ? `${fixture.laps} omgange` : null,
        info ? `${info.distKm.toFixed(1)} km, ${Math.round(info.elevM)} hm, ${info.kind.toLowerCase()}` : null,
      ]
        .filter(Boolean)
        .join(" | ")
    : "Rute ikke oplyst";

  const embed = new EmbedBuilder()
    .setTitle(`Ladder: ${home.name} mod ${away.name}`)
    .setURL(`https://ladder.cycleracing.club/fixture/${fixture.id}`)
    .setDescription(`Starter <t:${ts}:R> (<t:${ts}:t>)\nRute: ${route}`)
    .setColor(accentColor(fixture, ourTeam))
    .setFooter({ text: "Power: ZwiftPower (90 dage), ellers ladder | ZRS: Zwift" });

  if (!compact) {
    embed.addFields(
      { name: `${home.name} (${home.riders.length} tilmeldte)`, value: clip(riderLines(home)) },
      { name: `${away.name} (${away.riders.length} tilmeldte)`, value: clip(riderLines(away)) },
      { name: "Gennemsnit pr. varighed (W/kg, 90 dage)", value: clip(comparisonLines(home, away)) }
    );
  }

  const missing = [...home.riders, ...away.riders].filter((r) => !DURATIONS.some((d) => typeof r.wkg[d.seconds] === "number")).length;
  if (missing > 0) {
    const text = missing === 1 ? "1 rytter har" : `${missing} ryttere har`;
    embed.addFields({ name: "Mangler data", value: `${text} ingen power-data.` });
  }
  return embed;
}

// Two images when the site profile loads: the route (with powerup icons) and the W/kg chart.
// A missing profile still posts the chart. A failed chart falls back to the text embed.
async function buildLadderPreviewMessage(fixture, ourTeam = null) {
  await enrichRiders([...fixture.home.riders, ...fixture.away.riders]);
  const profile = await loadMatchProfile(fixture);
  const info = describeProfile(profile);
  try {
    const files = [];
    const embed = buildLadderPreviewEmbed(fixture, { compact: true, ourTeam, info });
    let routeImage = false;
    if (profile) {
      const subtitle = [fixture.world, info ? `${info.distKm.toFixed(1)} km · ${Math.round(info.elevM)} m` : null]
        .filter(Boolean)
        .join(" · ");
      const routePng = await renderRouteProfile(profile, {
        name: fixture.route || "",
        subtitle,
        powerups: placePowerups(profile, fixture),
      });
      if (routePng) {
        files.push(new AttachmentBuilder(routePng, { name: "profile.png" }));
        embed.setImage("attachment://profile.png");
        routeImage = true;
      }
    }
    const statsPng = await buildLadderChart(fixture, ourTeam, info);
    files.push(new AttachmentBuilder(statsPng, { name: "preview.png" }));
    if (!routeImage) embed.setImage("attachment://preview.png");
    return { embeds: [embed], files };
  } catch (err) {
    console.error("[ladderEmbed] Chart rendering failed, using text embed:", err.message);
    return { embeds: [buildLadderPreviewEmbed(fixture, { ourTeam, info })] };
  }
}

// Scout compares full current rosters using the same power cache and chart as the match preview.
async function buildLadderScoutMessage(home, away, { enrich = enrichRiders, render = buildLadderChart } = {}) {
  const teams = [home, away];
  await enrich([...home.riders, ...away.riders]);
  const counts = (predicate) => teams.map((team) => `${team.name}: ${team.riders.filter(predicate).length}`).join("\n");
  const embed = new EmbedBuilder()
    .setTitle(clip(`Ladder scout: ${home.name} mod ${away.name}`, 256))
    .setURL(home.url)
    .setDescription(teams.map((team) => `[${escapeMarkdown(team.name)}](${team.url}): **${team.riders.length} ryttere i truppen**`).join("\n"))
    .setColor(0xff6600)
    .addFields(
      { name: "Mangler Zwift-id", value: counts((rider) => !rider.zwiftId) },
      { name: "Mangler power", value: counts((rider) => !DURATIONS.some((d) => Number.isFinite(rider.wkg[d.seconds]) && rider.wkg[d.seconds] > 0)) }
    )
    .setFooter({ text: "Hele aktuelle trupper | Power: ZwiftPower (90 dage), ellers Ladder | ZRS: Zwift" });
  try {
    const png = await render({ home, away, scout: true }, home.name);
    embed.setImage("attachment://scout.png");
    return { content: "", embeds: [embed], files: [new AttachmentBuilder(png, { name: "scout.png" })], allowedMentions: { parse: [] } };
  } catch (error) {
    console.warn("[ladderEmbed] Scout rendering failed, using text:", error.message);
    // Keep every rider in the fallback even when a full roster exceeds Discord's embed limits.
    const text = teams.map((team) => `${team.name}: ${team.riders.length} ryttere i truppen\n${team.url}\n${riderLines(team)}`).join("\n\n");
    return {
      content: "Grafikken kunne ikke tegnes. Hele sammenligningen er vedhæftet som tekst.",
      embeds: [embed],
      files: [new AttachmentBuilder(Buffer.from(text, "utf8"), { name: "scout.txt" })],
      allowedMentions: { parse: [] },
    };
  }
}

module.exports = { buildLadderPreviewEmbed, buildLadderPreviewMessage, buildLadderScoutMessage, accentColor };
