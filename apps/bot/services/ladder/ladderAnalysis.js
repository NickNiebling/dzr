const { EmbedBuilder } = require("discord.js");
const { describeProfile, loadMatchProfile } = require("./routeInfo");
const { enrichRiders } = require("./riderPower");
const { cleanName } = require("./ladderChart");
const { accentColor } = require("./ladderEmbed");

const DURATIONS = [
  { seconds: 15, label: "15s" },
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 300, label: "5 min" },
  { seconds: 1200, label: "20 min" },
];
const LABEL = Object.fromEntries(DURATIONS.map((d) => [d.seconds, d.label]));

// Which durations usually decide a race on each kind of route.
const DECISIVE = { Flad: [15, 60], "Let kuperet": [60, 300], Kuperet: [300, 1200], Bjergrig: [1200] };
const FIELD_LIMIT = 1024;

const clip = (text) => (text.length <= FIELD_LIMIT ? text : `${text.slice(0, FIELD_LIMIT - 3)}...`);
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

function orient(fixture, ourTeam) {
  const awayIsUs = ourTeam && fixture.away.name && fixture.away.name.toLowerCase() === ourTeam.toLowerCase();
  return awayIsUs ? { us: fixture.away, them: fixture.home } : { us: fixture.home, them: fixture.away };
}

// avg and top 3 mean of a team's W/kg at one duration, plus the ranked riders.
function stats(team, seconds) {
  const ranked = team.riders
    .filter((r) => typeof r.wkg[seconds] === "number")
    .sort((a, b) => b.wkg[seconds] - a.wkg[seconds]);
  if (!ranked.length) return null;
  const values = ranked.map((r) => r.wkg[seconds]);
  return { avg: mean(values), top3: mean(values.slice(0, 3)), ranked };
}

function diffText(diff, us, them) {
  if (Math.abs(diff) < 0.05) return "jævnt";
  return `${diff > 0 ? us.name : them.name} +${Math.abs(diff).toFixed(2)}`;
}

function riderText(r, seconds) {
  const zrs = typeof r.zrs === "number" ? `, ZRS ${r.zrs}` : "";
  return `${cleanName(r.name)} ${r.wkg[seconds].toFixed(2)} W/kg${zrs}`;
}

function buildTactics({ us, them, usStats, themStats, decisive, info, fixture }) {
  const bullets = [];
  if (info) bullets.push(`Ruten er ${info.kind.toLowerCase()} (${info.distKm.toFixed(1)} km, ${Math.round(info.elevM)} hm) og afgøres typisk på ${decisive.map((s) => LABEL[s]).join(" og ")}.`);

  const edges = decisive
    .filter((s) => usStats[s] && themStats[s])
    .map((s) => ({ s, diff: usStats[s].top3 - themStats[s].top3 }));
  if (edges.length) {
    const labelsOf = (list) => list.map((e) => LABEL[e.s]).join(" og ");
    const detail = `vores top 3 mod deres: ${edges.map((e) => `${LABEL[e.s]} ${e.diff >= 0 ? "+" : "-"}${Math.abs(e.diff).toFixed(2)}`).join(", ")} W/kg`;
    const ours = edges.filter((e) => e.diff > 0.1);
    const theirs = edges.filter((e) => e.diff < -0.1);
    if (ours.length === edges.length) bullets.push(`Vi har fordelen på ${labelsOf(edges)} (${detail}). Sæt tempoet ved de selektive punkter og lad dem køre efter.`);
    else if (theirs.length === edges.length) bullets.push(`De er stærkest på ${labelsOf(edges)} (${detail}). Spar kræfter i feltet, åbn ikke tidligt og brug holdet til at lukke huller.`);
    else if (ours.length) bullets.push(`Fordelen er delt (${detail}). Læg løbet an, så det afgøres på ${labelsOf(ours)}.`);
    else if (theirs.length) bullets.push(`Fordelen er delt (${detail}). Undgå, at det afgøres på ${labelsOf(theirs)}.`);
    else bullets.push(`Holdene er jævnt matchede på ${labelsOf(edges)} (${detail}). Kør økonomisk og gem mindst én rytter til afgørelsen.`);
  }

  if (usStats[15] && themStats[15]) {
    const sprint = usStats[15].top3 - themStats[15].top3;
    if (sprint > 0.5) bullets.push(`Vi har den stærkeste sprint (top 3 +${sprint.toFixed(2)} W/kg på 15s). Hold feltet samlet mod mål.`);
    else if (sprint < -0.5) bullets.push(`Deres top 3 er stærkere i sprint (+${Math.abs(sprint).toFixed(2)} W/kg på 15s). Undgå en samlet spurt og forsøg at skille feltet før mål.`);
  }

  if (us.riders.length !== them.riders.length) {
    bullets.push(`Tilmeldte: ${us.riders.length} mod ${them.riders.length}. ${us.riders.length < them.riders.length ? "Vi er i undertal, så hold sammen og undgå dobbeltarbejde." : "Vi er flest, så brug antallet til at dække angreb."}`);
  }

  const lowForm = us.riders.filter((r) => typeof r.form === "number" && r.form < 85).map((r) => `${cleanName(r.name)} (${r.form}%)`);
  if (lowForm.length) bullets.push(`Lav form hos os: ${lowForm.join(", ")}. Tæl med lavere styrke end tallene viser.`);
  const hotForm = them.riders.filter((r) => typeof r.form === "number" && r.form >= 98).map((r) => `${cleanName(r.name)} (${r.form}%)`);
  if (hotForm.length) bullets.push(`I topform hos dem: ${hotForm.join(", ")}.`);

  if (fixture.powerups && fixture.powerups.length) {
    bullets.push(`Powerups i spil: ${fixture.powerups.join(", ")}. Aftal på forhånd, hvem der bruger hvad og hvornår.`);
  }
  return bullets;
}

// Rule-based match analysis from a parsed fixture (see ladderParser.js); riders get ZwiftPower/ZRS data first.
async function buildLadderAnalysisMessage(fixture, ourTeam = null) {
  await enrichRiders([...fixture.home.riders, ...fixture.away.riders]);
  const { us, them } = orient(fixture, ourTeam);
  const info = describeProfile(await loadMatchProfile(fixture));
  const decisive = DECISIVE[info ? info.kind : "Let kuperet"];

  const usStats = {};
  const themStats = {};
  for (const d of DURATIONS) {
    usStats[d.seconds] = stats(us, d.seconds);
    themStats[d.seconds] = stats(them, d.seconds);
  }

  const strength = DURATIONS.filter((d) => usStats[d.seconds] && themStats[d.seconds]).map((d) => {
    const u = usStats[d.seconds];
    const t = themStats[d.seconds];
    return `**${d.label}**: snit ${diffText(u.avg - t.avg, us, them)} | top 3 ${diffText(u.top3 - t.top3, us, them)}`;
  });

  const keySec = decisive[decisive.length - 1];
  const keyText = (stat) => (stat ? stat.ranked.slice(0, 3).map((r) => riderText(r, keySec)).join("\n") : "Ingen data");

  const ts = Math.floor(new Date(fixture.start).getTime() / 1000);
  const embed = new EmbedBuilder()
    .setTitle(`Analyse: ${us.name} mod ${them.name}`)
    .setURL(`https://ladder.cycleracing.club/fixture/${fixture.id}`)
    .setDescription(`Starter <t:${ts}:R> (<t:${ts}:t>)\nRute: ${fixture.route || "ikke oplyst"}${fixture.world ? ` (${fixture.world})` : ""}`)
    .setColor(accentColor(fixture, ourTeam))
    .setFooter({ text: "Regelbaseret analyse | Power: ZwiftPower (90 dage), ellers ladder | ZRS: Zwift" });

  if (strength.length) embed.addFields({ name: "Styrkeforhold (W/kg)", value: clip(strength.join("\n")) });
  embed.addFields(
    { name: `${us.name}: stærkeste på ${LABEL[keySec]}`, value: clip(keyText(usStats[keySec])) },
    { name: `${them.name}: stærkeste på ${LABEL[keySec]}`, value: clip(keyText(themStats[keySec])) }
  );

  const tactics = buildTactics({ us, them, usStats, themStats, decisive, info, fixture });
  if (tactics.length) embed.addFields({ name: "Taktik", value: clip(tactics.map((t) => `- ${t}`).join("\n")) });

  const missing = [...us.riders, ...them.riders].filter((r) => !DURATIONS.some((d) => typeof r.wkg[d.seconds] === "number")).length;
  if (missing > 0) embed.addFields({ name: "Mangler data", value: `${missing === 1 ? "1 rytter har" : `${missing} ryttere har`} ingen power-data.` });

  return { embeds: [embed] };
}

module.exports = { buildLadderAnalysisMessage };
