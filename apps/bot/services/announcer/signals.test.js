const test = require("node:test");
const assert = require("node:assert/strict");
const shared = require("../../constants.json");
const {
  upcomingClubEventsSignal,
  newFeaturesSignal,
  unlinkedZwiftIdSignal,
  notInCompanionClubSignal,
  dmUnseenSignal,
  featureSpotlightSignal,
  evergreenSignal,
  pickCandidate,
  computeMemberCounts,
  gatherCandidates,
} = require("./signals");
const { compactCommits, areasOf, fetchCommitLog } = require("./github");
const { isSilent, funnel } = require("./dmStats");
const { DEFAULTS } = require("./settings");

const NOW = new Date("2026-10-29T08:15:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(NOW.getTime() - days * DAY);
const COMMUNITY = shared.discord.roles.communityMember;

test("member counts: unlinked community members, and linked members outside the Companion club", () => {
  const members = [
    { id: "1", roleIds: [COMMUNITY] },
    { id: "2", roleIds: [COMMUNITY] },
    { id: "3", roleIds: [COMMUNITY] },
    { id: "4", roleIds: [] },
    { id: "5", roleIds: [COMMUNITY], bot: true },
  ];
  const linked = new Map([["2", "200"], ["3", "300"], ["4", "400"]]);
  assert.deepEqual(computeMemberCounts(members, linked, new Set(["200"])), {
    communityCount: 3, unlinkedCount: 1, linkedCount: 3, notInCompanionCount: 2,
  });
  // An empty roster is a failed sync, not an empty club.
  assert.equal(computeMemberCounts(members, linked, new Set()).notInCompanionCount, null);
});

test("the Zwift ID nudge fires on count or share, and not for a handful", () => {
  const fires = (unlinkedCount, communityCount) => unlinkedZwiftIdSignal({ counts: { unlinkedCount, communityCount }, settings: DEFAULTS }).length === 1;
  assert.equal(fires(20, 400), true);
  assert.equal(fires(8, 50), true);
  assert.equal(fires(8, 400), false);
  assert.equal(fires(0, 400), false);
  const [candidate] = unlinkedZwiftIdSignal({ counts: { unlinkedCount: 20, communityCount: 400 }, settings: DEFAULTS });
  assert.match(candidate.facts.howTo, new RegExp(shared.discord.channels.zwiftId));
});

test("the Companion nudge needs a known roster and enough members missing", () => {
  assert.equal(notInCompanionClubSignal({ counts: { notInCompanionCount: null, linkedCount: 100 }, settings: DEFAULTS }).length, 0);
  assert.equal(notInCompanionClubSignal({ counts: { notInCompanionCount: 5, linkedCount: 100 }, settings: DEFAULTS }).length, 0);
  const [candidate] = notInCompanionClubSignal({ counts: { notInCompanionCount: 30, linkedCount: 100 }, settings: DEFAULTS });
  assert.equal(candidate.priority, 2);
  assert.match(candidate.facts.howTo, /Companion/);
});

test("dmUnseen fires above its threshold", () => {
  assert.equal(dmUnseenSignal({ silentCount: 3, settings: DEFAULTS }).length, 0);
  assert.equal(dmUnseenSignal({ silentCount: 40, settings: DEFAULTS })[0].score, 40);
});

test("club events: only the next days, each series name once, not recently promoted", () => {
  const event = (id, name, hours) => ({ id, name, startMs: NOW.getTime() + hours * 60 * 60 * 1000, startLocal: "x", url: `u${id}` });
  const events = [event(1, "DZR After Party", 30), event(2, "DZR After Party", 54), event(3, "Zwifty Fifty", 10), event(4, "Far Away", 24 * 10), event(5, "Past", -2)];
  const [candidate] = upcomingClubEventsSignal({ events, settings: DEFAULTS, state: { promotedEvents: {} }, now: NOW });
  assert.deepEqual(candidate.meta.eventNames, ["Zwifty Fifty", "DZR After Party"]);
  const again = upcomingClubEventsSignal({ events, settings: DEFAULTS, state: { promotedEvents: { "Zwifty Fifty": ago(5), "DZR After Party": ago(5) } }, now: NOW });
  assert.equal(again.length, 0);
});

test("feature news carries the head sha so the log advances", () => {
  assert.equal(newFeaturesSignal({ commitLog: { head: "abc", commits: [] }, settings: DEFAULTS }).length, 0);
  const [candidate] = newFeaturesSignal({ commitLog: { head: "abc", commits: [{ subject: "Draw powerups", body: "" }], areas: ["Discord-botten"] }, settings: DEFAULTS });
  assert.equal(candidate.meta.headSha, "abc");
  assert.deepEqual(candidate.facts.commits, [{ subject: "Draw powerups", details: "" }]);
});

const { buildFeatureCatalog, countToolUsage } = require("./featureCatalog");

const tool = (name, description = `${name} does a thing`) => ({ type: "function", function: { name, description } });
const command = (name, description = `${name} command`, adminOnly = false) => ({ name, description, ...(adminOnly ? { default_member_permissions: "8" } : {}) });
const CATALOG = buildFeatureCatalog({
  tools: [tool("rider_stats"), tool("route_profile_image"), tool("zrl_category"), tool("start_quiz"), tool("report_knowledge_gap")],
  commands: [command("rider_stats"), command("quiz"), command("coach"), command("announcer_run", "admin", true), command("streaming_add", "Tilmeld din stream"), { name: "set_zwiftid", description: "mods", default_member_permissions: "8192" }],
  usage: { rider_stats: 40, route_profile_image: 2, zrl_category: 9, start_quiz: 1 },
});

test("the catalog comes from member commands and tools; admin commands and plumbing are left out", () => {
  const keys = CATALOG.map((feature) => feature.key);
  assert.deepEqual(keys, ["coach", "quiz", "report_knowledge_gap", "rider_stats", "route_profile_image", "streaming_add", "zrl_category"]);
  const stats = CATALOG.find((feature) => feature.key === "rider_stats");
  assert.equal(stats.name, "/rider_stats");
  assert.match(stats.howToUse, /\/rider_stats/);
  assert.match(stats.howToUse, /DM/);
  assert.equal(stats.usedLast30Days, 40);
  assert.equal(CATALOG.find((feature) => feature.key === "quiz").tool, "start_quiz");
  assert.equal(CATALOG.find((feature) => feature.key === "coach").usedLast30Days, null);
  assert.equal(CATALOG.find((feature) => feature.key === "report_knowledge_gap").internal, true);
  assert.deepEqual(countToolUsage([{ toolsUsed: ["a", "b"] }, { toolsUsed: ["a"] }, { toolsUsed: ["a"], test: true }]), { a: 2, b: 1 });
});

test("spotlight: never-featured first, least used among equals; switched-off and internal features are skipped", () => {
  const pick = (state, settings = DEFAULTS) => featureSpotlightSignal({ catalog: CATALOG, state, settings, now: NOW })[0]?.key;
  // coach has no usage count and was never featured; it ties at 0 with... coach first by usage ?? 0.
  assert.equal(pick({ perSignal: {} }), "featureSpotlight:coach");
  const perSignal = { "featureSpotlight:coach": ago(40) };
  assert.equal(pick({ perSignal }), "featureSpotlight:streaming_add");
  assert.equal(pick({ perSignal }, { ...DEFAULTS, spotlightExcluded: ["streaming_add"] }), "featureSpotlight:quiz");
  assert.equal(pick({ perSignal }, { ...DEFAULTS, spotlightExcluded: ["streaming_add", "quiz"] }), "featureSpotlight:route_profile_image");
  const all = Object.fromEntries(CATALOG.map((feature, i) => [`featureSpotlight:${feature.key}`, ago(10 + i)]));
  assert.equal(pick({ perSignal: all }), undefined);
  const keys = CATALOG.map((feature) => pick({ perSignal: { ...Object.fromEntries(CATALOG.map((f) => [`featureSpotlight:${f.key}`, ago(5)])), [`featureSpotlight:${feature.key}`]: ago(60) } }));
  assert.ok(!keys.includes("featureSpotlight:report_knowledge_gap"));
});

test("shipped features from the commit log get one spotlight a month after their news, unless skipped", () => {
  const shippedFeatures = [
    { slug: "fresh", title: "Fresh", pitch: "p", at: ago(5) },
    { slug: "ripe", title: "Ripe", pitch: "p", at: ago(35) },
    { slug: "done", title: "Done", pitch: "p", at: ago(60), spotlightedAt: ago(20) },
    { slug: "skip", title: "Skip", pitch: "p", at: ago(40), dismissed: true },
  ];
  const [shipped] = featureSpotlightSignal({ catalog: CATALOG, state: { perSignal: {}, shippedFeatures }, settings: DEFAULTS, now: NOW });
  assert.equal(shipped.key, "featureSpotlight:shipped:ripe");
  assert.equal(shipped.meta.shippedSlug, "ripe");
});

test("evergreen skips articles featured recently", () => {
  const articles = [{ id: "a", title: "A", content: "x" }, { id: "b", title: "B", content: "y" }];
  const [candidate] = evergreenSignal({ articles, state: { perSignal: { "evergreen:a": ago(10) } }, settings: DEFAULTS, now: NOW, random: () => 0 });
  assert.equal(candidate.key, "evergreen:b");
});

test("pickCandidate: priority, then need; cooldowns, open drafts and a repeated kind are skipped", () => {
  const c = (key, kind, priority, score = 0, cooldownDays = 7) => ({ key, kind, priority, score, cooldownDays });
  const candidates = [c("spot", "featureSpotlight", 3), c("unlinked", "unlinkedZwiftId", 2, 20), c("companion", "notInCompanionClub", 2, 40), c("ever", "evergreen", 4)];
  assert.equal(pickCandidate(candidates, { state: {}, now: NOW }).key, "companion");
  assert.equal(pickCandidate(candidates, { state: { perSignal: { companion: ago(2) } }, now: NOW }).key, "unlinked");
  assert.equal(pickCandidate(candidates, { state: {}, now: NOW, openKeys: new Set(["companion", "unlinked"]) }).key, "spot");
  assert.equal(pickCandidate(candidates, { state: { lastKind: "notInCompanionClub" }, now: NOW }).key, "unlinked");
  // Time-bound topics may follow their own kind.
  const events = c("events", "upcomingClubEvents", 1, 2, 0);
  assert.equal(pickCandidate([events, ...candidates], { state: { lastKind: "upcomingClubEvents" }, now: NOW }).key, "events");
});

test("gatherCandidates keeps going when one source fails, and honours disabled signals", async () => {
  const settings = { ...DEFAULTS, signals: { ...DEFAULTS.signals, evergreen: { ...DEFAULTS.signals.evergreen, enabled: false } } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const candidates = await gatherCandidates({
      deps: {
        memberCounts: async () => ({ communityCount: 100, unlinkedCount: 30, linkedCount: 70, notInCompanionCount: 2 }),
        fetchClubEvents: async () => { throw new Error("feed down"); },
        commitLog: async () => ({ head: "h", commits: [] }),
        silentDmCount: async () => 0,
        listKnowledge: async () => [{ id: "a", content: "x" }],
        featureCatalog: async () => CATALOG,
      },
      settings,
      state: {},
      now: NOW,
    });
    assert.deepEqual(candidates.map((candidate) => candidate.kind).sort(), ["featureSpotlight", "unlinkedZwiftId"]);
  } finally {
    console.warn = warn;
  }
});

test("commits: merges dropped, bodies kept short; areas from changed paths", () => {
  const raw = [
    { sha: "1", commit: { message: "Draw a race's powerups\n\nLonger body" } },
    { sha: "2", commit: { message: "Merge pull request #12 from x/y" } },
  ];
  assert.deepEqual(compactCommits(raw), [{ sha: "1", subject: "Draw a race's powerups", body: "Longer body" }]);
  assert.deepEqual(areasOf([{ filename: "apps/bot/x.js" }, { filename: "app/page.tsx" }, { filename: "components/a.tsx" }, { filename: "README.md" }]), ["Discord-botten", "hjemmesiden"]);
});

test("fetchCommitLog compares from the last sha, or lists since a date the first time", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/compare/")) {
      return { ok: true, json: async () => ({ commits: [{ sha: "b", commit: { message: "One" } }, { sha: "c", commit: { message: "Two" } }], files: [{ filename: "apps/api/main.py" }] }) };
    }
    return { ok: true, json: async () => [{ sha: "z", commit: { message: "Newest" } }, { sha: "y", commit: { message: "Older" } }] };
  };
  const compared = await fetchCommitLog({ base: "a", sinceIso: "x", fetchImpl });
  assert.equal(compared.head, "c");
  assert.deepEqual(compared.areas, ["backend (API)"]);
  assert.match(urls[0], /compare\/a\.\.\.main$/);
  const listed = await fetchCommitLog({ base: null, sinceIso: "2026-10-15T00:00:00.000Z", fetchImpl });
  assert.equal(listed.head, "z");
  assert.deepEqual(listed.commits.map((commit) => commit.subject), ["Older", "Newest"]);
});

test("silent DMs: delivered days ago with no reply, click or conversion", () => {
  const sent = { steps: { link_zwift_id_channel: { sentAt: ago(5) } } };
  assert.equal(isSilent(sent, NOW, 3), true);
  assert.equal(isSilent({ steps: { link_zwift_id_channel: { sentAt: ago(1) } } }, NOW, 3), false);
  assert.equal(isSilent({ ...sent, firstReplyAt: ago(4) }, NOW, 3), false);
  assert.equal(isSilent({ ...sent, zwiftLinkedAt: ago(2) }, NOW, 3), false);
  assert.equal(isSilent({ steps: { link_zwift_id_channel: { dmFailedAt: ago(5) } } }, NOW, 3), false);
  assert.equal(isSilent({ reminders: { join_companion: { lastAt: ago(5), count: 1, clickedAt: ago(4) } } }, NOW, 3), false);
  assert.equal(isSilent({ ...sent, test: true }, NOW, 3), false);
});

test("funnel counts per step", () => {
  const rows = funnel([
    { steps: { link_zwift_id_channel: { sentAt: ago(10) } }, zwiftLinkedAt: ago(8) },
    { steps: { link_zwift_id_channel: { sentAt: ago(10) } } },
    { steps: { link_zwift_id_channel: { dmFailedAt: ago(10) } } },
    { reminders: { join_companion: { lastAt: ago(6), count: 2 } }, firstReplyAt: ago(5) },
  ], NOW, 3);
  assert.deepEqual(rows.link_zwift_id_channel, { sent: 2, failed: 1, engaged: 0, converted: 1, silent: 1 });
  assert.deepEqual(rows.join_companion, { sent: 2, failed: 0, engaged: 1, converted: 0, silent: 0 });
});

test("settings from the admin page are checked and clamped", () => {
  const { sanitizeSettings, flattenSettings } = require("../announcerSettings");
  const { patch, errors } = sanitizeSettings({
    weeklyCap: "4",
    dailyCap: 99,
    "signals.unlinkedZwiftId.minShare": 0.123,
    "signals.evergreen.enabled": false,
    "channels.default": "not-a-channel",
    unknown: 5,
  });
  assert.equal(patch.weeklyCap, 4);
  assert.equal(patch.dailyCap, 5);
  assert.equal(patch.signals.unlinkedZwiftId.minShare, 0.12);
  assert.equal(patch.signals.evergreen.enabled, false);
  assert.equal(patch.unknown, undefined);
  assert.equal(patch.channels, undefined);
  assert.equal(errors.length, 1);
  assert.equal(sanitizeSettings({ "postWindow.startHour": 20, "postWindow.endHour": 10 }).errors.length, 1);
  assert.equal(flattenSettings(DEFAULTS)["dmReminders.dailyCap"], 20);
});
