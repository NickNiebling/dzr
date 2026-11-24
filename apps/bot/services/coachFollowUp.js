const OpenAI = require("openai");
const config = require("../config/config");
const intervals = require("./intervalsService");
const { getCoachClient } = require("./coachBot");
const { sendNoEmbeds } = require("./coachDm");
const {
  listCoachProfiles,
  listCoachChatNotes,
  listCalendarEntries,
  markCoachFollowUpSent,
  recordCoachUsage,
  getBotState,
  setBotState,
} = require("./firebase");
const { formatCoachProfileForPrompt } = require("./coachProfile");
const {
  retrieveRelevantNotes,
  formatNotesForPrompt,
  formatActiveGoalsForPrompt,
  formatCoachToday,
} = require("./coachChatNotes");
const { formatCalendarForPrompt } = require("./memberCalendar");
const { extractTokenUsage } = require("./coachUsage");
const { reportRecurringError } = require("./recurringError");
const {
  COACH_MODEL,
  COACH_BASE_EFFORT,
  createCoachResponse,
} = require("./coachLlm");

const {
  FOLLOW_UP_TZ,
  FOLLOW_UP_HOUR,
  followUpClockWindow,
  shouldRunFollowUpSweep,
  isFollowUpDue,
} = require("./coachFollowUpSchedule");

const FOLLOW_UP_STATE_KEY = "coach_follow_up";
/** Set only after Firestore says today's sweep already finished. Never cache "not yet run". */
let cachedFollowUpRunDate = null;
// Per sweep, not per day: if more athletes are due, the next scheduler tick continues until the
// morning window closes. Sends run one after another, so this mainly bounds one sweep's length.
const MAX_FOLLOW_UPS_PER_RUN = Number.parseInt(process.env.COACH_FOLLOW_UPS_PER_RUN || "100", 10) || 100;
// The scheduler ticks every minute and a sweep can take longer, so two must never overlap —
// both would build the same due list and DM the same athletes twice.
let sweepInFlight = false;
const FALLBACK_DA = "Hvordan går træningen? Skriv hvis du vil have et kig på ugen.";
const FALLBACK_EN = "How is training going? Write if you want a look at the week.";

let openai = null;
try {
  if (config.openai?.apiKey) {
    openai = new OpenAI({ apiKey: config.openai.apiKey });
  }
} catch {
  openai = null;
}

function formatActivitiesForPrompt(activities) {
  const list = Array.isArray(activities) ? activities.slice(0, 12) : [];
  if (!list.length) return "(no recent activities)";
  return list
    .map((a) => {
      const date = String(a.start_date || "").slice(0, 10) || "unknown date";
      const km = typeof a.distance_m === "number" ? `${(a.distance_m / 1000).toFixed(1)} km` : "";
      const min = typeof a.moving_time === "number" ? `${Math.round(a.moving_time / 60)} min` : "";
      const watts = typeof a.average_watts === "number" ? `${Math.round(a.average_watts)} W` : "";
      const hr = typeof a.average_heartrate === "number" ? `${Math.round(a.average_heartrate)} bpm` : "";
      const name = a.name || a.sport_type || "session";
      return `- ${date} — ${name}${km ? `, ${km}` : ""}${min ? `, ${min}` : ""}${watts ? `, ${watts}` : ""}${hr ? `, ${hr}` : ""}`;
    })
    .join("\n");
}

async function generateFollowUpText({ profile, activities, notesBlock, goalsBlock, calendarBlock, username }) {
  const language = profile?.style?.language === "en" ? "en" : "da";
  const fallback = language === "en" ? FALLBACK_EN : FALLBACK_DA;
  if (!openai) return fallback;

  const today = formatCoachToday();
  const settings = formatCoachProfileForPrompt(profile);
  const instructions = `You write one short proactive check-in from DZR Coach to an athlete in a Discord DM.
Rules:
- Reply in ${language === "en" ? "English" : "Danish"}.
- Discord-short: a few sentences, one question.
- Cite a real recent session only if it appears in the activity list, and only the one number that makes the point. Never invent numbers. Do not reprint a full ride summary.
- Weeks start Monday (Denmark / ISO). Sunday is the last day of the week.
- If Active goals lists any, default the check-in toward the nearest dated goal. Injuries still override.
- Use Coach settings and chat notes as hints. Do not say you saved a note or changed settings.
- The Calendar is what the athlete planned to do. Lead with it: a race or event in the next days is the thing to write about, and a session under "Recently planned" is worth asking how it went. Following up on what was planned is the point of a check-in. If a coming race or event has a clock time, mention it. An evening race is that day's hard session — do not also push a hard morning.
- A calendar row still marked planned does NOT mean it was skipped. Nothing marks these automatically and a ride can be missing for dull reasons, so check the activity list and ask rather than assert. A missed session usually has a reason worth hearing — ask, do not accuse.
- A chat note of kind "plan" records advice YOU gave, which is not the same as what they planned. Use it as context for the question, not as a record of their intentions.
- Not medical advice. No doping or extreme restriction.
- Do not mention tokens, Firestore, or this being a scheduled job.`;
  const input = [{
    role: "user",
    content: `${today.line}

Athlete: ${username || "athlete"}

## Coach settings
${settings}

## Active goals
${goalsBlock || "No saved goals."}

## Calendar
${calendarBlock || "(nothing planned)"}

## Chat notes
${notesBlock || "(none)"}

## Recent activities (last 14 days)
${formatActivitiesForPrompt(activities)}

Write the check-in now.`,
  }];
  const response = await createCoachResponse(openai, {
    instructions,
    input,
    allowTools: false,
    model: COACH_MODEL,
    maxOutputTokens: 220,
    reasoningEffort: COACH_BASE_EFFORT,
    cacheKey: "dzr-coach:follow-up",
  });

  const usage = extractTokenUsage(response);
  if (usage.totalTokens > 0 || usage.promptTokens > 0) {
    await recordCoachUsage({
      discordId: profile.discordId,
      username: username || null,
      model: COACH_MODEL,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      cachedPromptTokens: usage.cachedPromptTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      reasoningTokens: usage.reasoningTokens,
      latencyMs: response.latencyMs,
      openaiCalls: 1,
    });
  }

  return response.text || fallback;
}

async function sendFollowUpDm(discordId, text) {
  const coachClient = await getCoachClient();
  if (!coachClient) throw new Error("coach_not_configured");
  const user = await coachClient.users.fetch(discordId);
  const dm = await user.createDM();
  await sendNoEmbeds(dm, String(text || "").trim());
}

async function sendOneFollowUp(profile) {
  const discordId = String(profile.discordId || "").trim();
  if (!discordId) return;
  const eligible = await intervals.hasClubMemberRole(discordId);
  if (!eligible) return;
  const connected = await intervals.isConnected(discordId);
  if (!connected) return;

  let activities = [];
  try {
    const result = await intervals.getRecentActivities(discordId, { days: 14 });
    if (result?.success && Array.isArray(result.activities)) activities = result.activities;
  } catch (err) {
    console.warn("coach follow-up activities failed:", err?.message || err);
  }

  // Read ungated, exactly as the chat path does: notesOptIn governs silent extraction from
  // conversation, and a calendar entry is something the athlete typed into a form themselves.
  // Without this the 08:00 check-in cheerfully asks how training is going on the morning of
  // someone's race.
  let calendarBlock = "";
  try {
    calendarBlock = formatCalendarForPrompt(await listCalendarEntries(discordId));
  } catch (err) {
    console.warn("coach follow-up calendar failed:", err?.message || err);
  }

  // Goals ungated, retrieval gated — same split the chat path uses. A goal set on the Kalender
  // page is form-entered, not extracted from a conversation, so a member with chat notes off can
  // still have one and the check-in should steer toward it.
  let notesBlock = "";
  let goalsBlock = "No saved goals.";
  try {
    const notes = await listCoachChatNotes(discordId);
    goalsBlock = formatActiveGoalsForPrompt(notes);
    if (profile.notesOptIn === true) {
      const hits = retrieveRelevantNotes(notes, "training week follow up", { now: new Date() });
      notesBlock = formatNotesForPrompt(hits.filter((note) => note.kind !== "goal")) || "";
    }
  } catch (err) {
    console.warn("coach follow-up notes failed:", err?.message || err);
  }

  let username = null;
  try {
    const coachClient = await getCoachClient();
    const user = await coachClient?.users.fetch(discordId);
    username = user?.username || null;
  } catch {
    username = null;
  }

  const text = await generateFollowUpText({ profile, activities, notesBlock, goalsBlock, calendarBlock, username });
  try {
    await sendFollowUpDm(discordId, text);
  } catch (err) {
    console.warn("coach follow-up DM failed:", discordId, err?.message || err);
  }
  await markCoachFollowUpSent(discordId);
}

async function maybeSendCoachFollowUps(now = new Date()) {
  const window = followUpClockWindow(now);
  if (!window.open) return { skipped: window.reason };
  if (cachedFollowUpRunDate === window.todayKey) return { skipped: "already_ran" };
  if (sweepInFlight) return { skipped: "in_flight" };

  sweepInFlight = true;
  try {
    return await runFollowUpSweep(now);
  } finally {
    sweepInFlight = false;
  }
}

async function runFollowUpSweep(now) {
  const existing = await getBotState(FOLLOW_UP_STATE_KEY);
  const decision = shouldRunFollowUpSweep({ now, lastRunDate: existing?.lastRunDate || null });
  if (!decision.run) {
    if (decision.reason === "already_ran" && decision.todayKey) {
      cachedFollowUpRunDate = decision.todayKey;
    }
    return { skipped: decision.reason };
  }
  const todayKey = decision.todayKey;

  const due = [];
  let moreDue = false;
  try {
    const profiles = await listCoachProfiles();
    for (const profile of profiles) {
      if (!isFollowUpDue(profile, now)) continue;
      const discordId = String(profile.discordId || "").trim();
      if (!discordId) continue;
      if (due.length >= MAX_FOLLOW_UPS_PER_RUN) {
        moreDue = true;
        break;
      }
      try {
        const [member, connected] = await Promise.all([
          intervals.hasClubMemberRole(discordId),
          intervals.isConnected(discordId),
        ]);
        if (!member || !connected) continue;
      } catch (err) {
        console.warn("coach follow-up eligibility failed:", discordId, err?.message || err);
        continue;
      }
      due.push(profile);
    }
  } catch (err) {
    reportRecurringError("coachFollowUp.listProfiles", "listCoachProfiles failed:", err?.message || err);
    return { skipped: "list_failed" };
  }

  let sent = 0;
  for (const profile of due) {
    try {
      await sendOneFollowUp(profile);
      sent += 1;
    } catch (err) {
      reportRecurringError(`coachFollowUp.send:${profile?.discordId}`, "coach follow-up failed:", profile?.discordId, err?.message || err);
      try {
        await markCoachFollowUpSent(profile.discordId);
      } catch {
        /* ignore */
      }
    }
  }

  // Every athlete in `due` is now marked as contacted, so the next tick's due list starts where
  // this one stopped.
  if (moreDue) {
    console.log(`🚴 Coach follow-ups: ${sent}/${due.length} on ${todayKey}, more due — continuing next tick`);
    return { sent, considered: due.length, moreDue: true };
  }

  await setBotState(FOLLOW_UP_STATE_KEY, {
    lastRunDate: todayKey,
    sent,
    considered: due.length,
    updatedAt: now.toISOString(),
  });
  cachedFollowUpRunDate = todayKey;
  console.log(`🚴 Coach follow-ups: ${sent}/${due.length} on ${todayKey}`);
  return { sent, considered: due.length };
}

module.exports = {
  FOLLOW_UP_TZ,
  FOLLOW_UP_HOUR,
  isFollowUpDue,
  maybeSendCoachFollowUps,
};
