// Scheduled ladder posts: optakt shortly before each match and a reminder on match day.
const { EmbedBuilder, RESTJSONErrorCodes } = require("discord.js");
const config = require("../../config/config");
const ladderTeams = require("./ladderTeams");
const ladderClient = require("./ladderClient");
const ladderState = require("./ladderState");
const { buildLadderOptaktMessage, accentColor } = require("./ladderEmbed");
const { describeProfile, loadMatchProfile } = require("./routeInfo");
const { reportRecurringError } = require("../recurringError");

const TICK_MS = 10 * 60 * 1000;
const REMINDER_HOUR = 12;
const OPTAKT_STATE_KEY = "postedLadderPreview"; // Existing key in the saved delivery state.

let lastRun = 0;
let running = false;

// "sv-SE" formats as YYYY-MM-DD, which makes same-day comparison a string compare.
function localDate(date, tz) {
  return date.toLocaleDateString("sv-SE", { timeZone: tz });
}

function localHour(date, tz) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(date)) % 24;
}

// Optakt is due once the match is inside the lead-time window and has not started.
function isOptaktDue(startIso, optaktMin, now = new Date()) {
  const minutesUntil = (new Date(startIso).getTime() - now.getTime()) / 60000;
  return Number.isFinite(minutesUntil) && minutesUntil > 0 && minutesUntil <= optaktMin;
}

// A reminder is due from REMINDER_HOUR on the day of a match that has not started yet.
function isReminderDue(startIso, now, tz) {
  const start = new Date(startIso);
  return localDate(start, tz) === localDate(now, tz) && start > now && localHour(now, tz) >= REMINDER_HOUR;
}

function dayEmbed(fixture, ourTeam, info = null) {
  const ts = Math.floor(new Date(fixture.start).getTime() / 1000);
  const route = [
    fixture.route ? `${fixture.route}${fixture.world ? ` (${fixture.world})` : ""}` : null,
    fixture.laps ? `${fixture.laps} omgange` : null,
    info ? `${info.distKm.toFixed(1)} km, ${Math.round(info.elevM)} hm` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  const ours = fixture.away.name && fixture.away.name.toLowerCase() === ourTeam.toLowerCase() ? fixture.away : fixture.home;

  return new EmbedBuilder()
    .setTitle(`Løbsdag: ${fixture.home.name} mod ${fixture.away.name}`)
    .setURL(`https://ladder.cycleracing.club/fixture/${fixture.id}`)
    .setDescription(`Vi kører i dag. Start <t:${ts}:t> (<t:${ts}:R>).${route ? `\nRute: ${route}` : ""}\nOptakt med power-sammenligning kommer før start.`)
    .setColor(accentColor(fixture, ourTeam))
    .addFields({
      name: `${ours.name} (${ours.riders.length} tilmeldte)`,
      value: ours.riders.length ? ours.riders.map((r) => r.name).join("\n").slice(0, 1024) : "Ingen tilmeldte endnu",
    });
}

async function syncTeam(client, team, now) {
  const fixtures = await ladderClient.getFixtures(team.name);
  const teamKey = team.name.trim().toLowerCase();
  const defaultChannelId = config.ladder.channelId;
  let channelId = team.channelId || defaultChannelId;
  const optaktMin = team.optaktMin || config.ladder.optaktMin;

  async function send(message) {
    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send(message);
    } catch (err) {
      if (channelId === defaultChannelId || err.code !== RESTJSONErrorCodes.UnknownChannel) throw err;
      channelId = defaultChannelId;
      const channel = await client.channels.fetch(channelId);
      await channel.send(message);
    }
  }

  for (const { id } of fixtures) {
    const deliveryKey = `${id}:${teamKey}`;
    const wantOptakt = !(await ladderState.isPosted(OPTAKT_STATE_KEY, deliveryKey));
    const wantReminder = !(await ladderState.isPosted("postedLadderDayReminder", deliveryKey));
    if (!wantOptakt && !wantReminder) continue;

    try {
      const start = await ladderClient.getFixtureStart(id);

      if (wantReminder && isReminderDue(start, now, config.ladder.tz)) {
        const fixture = await ladderClient.getFixture(id);
        const info = describeProfile(await loadMatchProfile(fixture));
        await send({ embeds: [dayEmbed(fixture, team.name, info)] });
        await ladderState.markPosted("postedLadderDayReminder", deliveryKey);
      }
      if (wantOptakt && isOptaktDue(start, optaktMin, now)) {
        // Re-fetch inside the window so signups are current; this also presses the ladder's refresh button.
        const fixture = await ladderClient.refreshFixture(await ladderClient.getFixture(id));
        await send(await buildLadderOptaktMessage(fixture, team.name));
        await ladderState.markPosted(OPTAKT_STATE_KEY, deliveryKey);
      }
    } catch (err) {
      if (ladderClient.isAuthUnavailable(err)) throw err;
      reportRecurringError(`ladder.match:${deliveryKey}`, `[ladder] Match ${id} (${team.name}) failed:`, err.message);
    }
  }
}

// Called from the one-minute scheduler tick; does the real work every ten minutes.
async function maybeRunLadderJobs(client, now = new Date()) {
  if (running || now.getTime() - lastRun < TICK_MS) return;
  running = true;
  lastRun = now.getTime();
  try {
    for (const team of await ladderTeams.list()) {
      try {
        await syncTeam(client, team, now);
      } catch (err) {
        if (ladderClient.isAuthUnavailable(err)) {
          console.warn("[ladder] Job paused:", err.message);
          return;
        }
        reportRecurringError(`ladder.team:${String(team.name).trim().toLowerCase()}`, `[ladder] Team ${team.name} failed:`, err.message);
      }
    }
  } catch (err) {
    reportRecurringError("ladder.job", "[ladder] Job failed:", err.message);
  } finally {
    running = false;
  }
}

module.exports = { maybeRunLadderJobs, isOptaktDue, isReminderDue, localDate, localHour, dayEmbed };
