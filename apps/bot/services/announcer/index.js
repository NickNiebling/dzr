/**
 * The announcer: once a day it picks the most relevant topic and posts a draft for moderators;
 * through the day it posts approved drafts when pacing allows. Called from the scheduler's minute
 * tick. The flow and the rules are described in docs/architecture/bot-automation.md.
 *
 *   bot_state/announcer  { lastRunDate, paused, published: [{ at, key, kind, channelId }],
 *                          perSignal: { [key]: at }, lastKind, lastPublishedAt,
 *                          github: { lastSha }, promotedEvents: { [name]: at }, shippedFeatures }
 *   bot_state/announcer_features  { features, updatedAt }: the detected spotlight catalog, for
 *                          /admin/announcer (the site cannot read the bot's code)
 */
const { loadSettings } = require("./settings");
const { localParts } = require("./pacing");
const { gatherCandidates, pickCandidate } = require("./signals");
const drafts = require("./drafts");
const { defaultSources, readFeatureCatalog } = require("./sources");
const dmReminders = require("./dmReminders");
const { reportRecurringError } = require("../recurringError");

const QUEUE_CHECK_MS = 15 * 60 * 1000;
const CATALOG_PUBLISH_MS = 6 * 60 * 60 * 1000;
let lastQueueCheck = 0;
let lastCatalogPublish = 0;

/** Write the detected feature catalog where the admin page reads it. */
async function publishFeatureCatalog(db) {
  const features = await readFeatureCatalog(db);
  await db.collection("bot_state").doc("announcer_features").set({ features, updatedAt: new Date() });
  return features.length;
}
let running = false;

async function readState(db) {
  const snap = await drafts.stateRef(db).get();
  return (snap.exists && snap.data()) || {};
}

/**
 * Pick today's topic and draft it.
 * @param {{ dryRun?: boolean }} options dryRun: report candidates and the pick, write nothing.
 * @returns {Promise<{ candidates: object[], picked: object|null, draftId?: string, skipped?: string }>}
 */
async function runDaily(client, { dryRun = false, deps = drafts.defaultDeps(), sources, scheduled = false } = {}) {
  const settings = await loadSettings(deps.db);
  const now = deps.now();
  const state = await readState(deps.db);
  const unfinished = await drafts.listOpenDrafts(deps.db);
  // A draft left in "publishing" past the stale limit (a crash, or a post whose result could not be
  // saved) frees its slot, so it cannot block new drafts until it expires. It still holds its topic:
  // it may already be posted, and a moderator can still publish it.
  const open = unfinished.filter((draft) => drafts.holdsSlot(draft, now.getTime()));
  const candidates = await gatherCandidates({ deps: sources || defaultSources(client, settings), settings, state, now });
  const openKeys = new Set(unfinished.map((draft) => draft.signalKey));
  const ranked = [];
  let rest = candidates;
  for (let pick = pickCandidate(rest, { state, now, openKeys }); pick; pick = pickCandidate(rest, { state, now, openKeys })) {
    ranked.push(pick);
    rest = rest.filter((candidate) => candidate !== pick);
  }
  const report = { candidates, ranked, picked: ranked[0] || null, open: open.length };
  if (dryRun) return report;

  if (!settings.enabled || state.paused) return { ...report, skipped: "paused" };
  if (open.length >= settings.maxOpenDrafts) return { ...report, skipped: "open_drafts" };

  // The model may find nothing worth saying (feature news with only internal commits); then the
  // next topic gets its turn.
  for (const candidate of ranked.slice(0, 2)) {
    let created;
    try {
      created = await drafts.createDraft(client, candidate, settings, deps);
    } catch (error) {
      // The moderators channel could not be reached: try again tomorrow, with the commit log
      // where it was, so no feature news is lost.
      reportRecurringError(
        scheduled ? "announcer.draftPost" : null,
        `Announcer could not post the draft for ${candidate.key}:`, error?.message || error
      );
      return { ...report, skipped: "draft_post_failed" };
    }
    if (candidate.meta?.headSha) {
      await drafts.stateRef(deps.db).set({ github: { lastSha: candidate.meta.headSha } }, { merge: true });
    }
    if (created) return { ...report, picked: candidate, draftId: created.id };
  }
  return { ...report, skipped: ranked.length ? "nothing_written" : "no_candidates" };
}

/** Minute tick: the daily draft at runHour:runMinute, the queue every 15 minutes, due DM reminders. */
async function maybeRunAnnouncer(client) {
  if (running) return;
  running = true;
  try {
    const deps = drafts.defaultDeps();
    const settings = await loadSettings(deps.db);
    const now = deps.now();
    const local = localParts(now, settings.tz);

    if (local.hour === settings.runHour && local.minute === settings.runMinute) {
      const state = await readState(deps.db);
      if (state.lastRunDate !== local.dateKey) {
        await drafts.stateRef(deps.db).set({ lastRunDate: local.dateKey }, { merge: true });
        const result = await runDaily(client, { deps, scheduled: true });
        console.log(`📣 Announcer: ${result.draftId ? `drafted ${result.picked.key}` : `no draft (${result.skipped})`}; ${result.candidates.length} candidate(s)`);
      }
    }

    if (now.getTime() - lastQueueCheck >= QUEUE_CHECK_MS) {
      lastQueueCheck = now.getTime();
      await drafts.expireDrafts(client, deps);
      const published = await drafts.publishQueued(client, settings, deps);
      if (published?.ok) console.log(`📣 Announcer: posted a queued draft (${published.url})`);
    }

    if (now.getTime() - lastCatalogPublish >= CATALOG_PUBLISH_MS) {
      lastCatalogPublish = now.getTime();
      await publishFeatureCatalog(deps.db).catch((error) => console.warn("Announcer feature catalog:", error?.message || error));
    }

    await dmReminders.processDue(client);
  } catch (error) {
    reportRecurringError("announcer.tick", "❌ Announcer tick failed:", error?.message || error);
  } finally {
    running = false;
  }
}

async function setPaused(paused, deps = drafts.defaultDeps()) {
  await drafts.stateRef(deps.db).set({ paused: !!paused }, { merge: true });
}

module.exports = { maybeRunAnnouncer, runDaily, setPaused, readState, publishFeatureCatalog };
