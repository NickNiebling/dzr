const test = require("node:test");
const assert = require("node:assert/strict");
const { RESTJSONErrorCodes } = require("discord.js");
const config = require("../../config/config");
const { maybeRunLadderJobs, isOptaktDue, isReminderDue, localDate, localHour } = require("./ladderJobs");
const { parseTeamName } = require("./ladderTeams");
const ladderClient = require("./ladderClient");
const ladderState = require("./ladderState");
const ladderTeams = require("./ladderTeams");
const { createStore } = require("./ladderStore");
const { summarizeProfile, formPercent } = require("./riderPower");

const TZ = "Europe/Copenhagen";

test("optakt is due only inside the lead-time window before start", () => {
  const now = new Date("2026-10-15T17:00:00Z");
  assert.equal(isOptaktDue("2026-10-15T18:00:00Z", 65, now), true);
  assert.equal(isOptaktDue("2026-10-15T18:30:00Z", 65, now), false);
  assert.equal(isOptaktDue("2026-10-15T16:59:00Z", 65, now), false);
  assert.equal(isOptaktDue("not a date", 65, now), false);
});

test("local date and hour follow the configured timezone", () => {
  const instant = new Date("2026-10-15T22:30:00Z");
  assert.equal(localDate(instant, TZ), "2026-10-16");
  assert.equal(localHour(instant, TZ), 0);
  assert.equal(localHour(new Date("2026-10-15T10:00:00Z"), TZ), 12);
});

test("reminder is due from 12:00 local time on match day until the match starts", () => {
  const start = "2026-10-15T18:00:00Z";
  assert.equal(isReminderDue(start, new Date("2026-10-15T09:59:00Z"), TZ), false);
  assert.equal(isReminderDue(start, new Date("2026-10-15T10:00:00Z"), TZ), true);
  assert.equal(isReminderDue(start, new Date("2026-10-15T18:01:00Z"), TZ), false);
  assert.equal(isReminderDue(start, new Date("2026-10-14T12:00:00Z"), TZ), false);
});

test("scheduled jobs pause once on an auth outage and still report other errors per match", async (t) => {
  const errorLog = t.mock.method(console, "error", () => {});
  const warningLog = t.mock.method(console, "warn", () => {});
  t.mock.method(ladderTeams, "list", async () => [{ name: "First team" }, { name: "Second team" }]);
  const getFixtures = t.mock.method(ladderClient, "getFixtures", async () => [{ id: "1" }, { id: "2" }]);
  t.mock.method(ladderState, "isPosted", async () => false);
  let failure = Object.assign(new Error("Ladder authentication is unavailable"), { code: "ladder_auth_unavailable" });
  const getFixtureStart = t.mock.method(ladderClient, "getFixtureStart", async () => { throw failure; });
  const client = { channels: { fetch: async () => ({}) } };

  await maybeRunLadderJobs(client, new Date("2026-10-15T17:00:00Z"));
  assert.equal(getFixtures.mock.callCount(), 1);
  assert.equal(getFixtureStart.mock.callCount(), 1);
  assert.equal(warningLog.mock.callCount(), 1);
  assert.equal(errorLog.mock.callCount(), 0);

  failure = new Error("Unexpected match error");
  await maybeRunLadderJobs(client, new Date("2026-10-15T17:10:00Z"));
  assert.equal(getFixtures.mock.callCount(), 3);
  assert.equal(getFixtureStart.mock.callCount(), 5);
  assert.equal(warningLog.mock.callCount(), 1);
  assert.equal(errorLog.mock.callCount(), 4);
});

test("scheduled posts use the team channel and fall back only for missing or deleted channels", async (t) => {
  const originalConfig = config.ladder;
  t.after(() => { config.ladder = originalConfig; });
  const defaultChannelId = "default-channel";
  config.ladder = { channelId: defaultChannelId, optaktMin: 65, tz: TZ };
  const errorLog = t.mock.method(console, "error", () => {});
  const start = "2026-10-16T18:00:00Z";
  const teams = [
    { id: "1", name: "Linked", channelId: "team-channel", optaktMin: 70 },
    { id: "2", name: "Unlinked" },
    { id: "3", name: "Deleted", channelId: "deleted-channel" },
    { id: "4", name: "Stale", channelId: "stale-channel" },
    { id: "5", name: "Restricted", channelId: "restricted-channel" },
  ];
  const deliveries = [];
  const unknownChannel = Object.assign(new Error("Unknown Channel"), { code: RESTJSONErrorCodes.UnknownChannel });
  t.mock.method(ladderTeams, "list", async () => teams);
  t.mock.method(ladderClient, "getFixtures", async (name) => [{ id: teams.find((team) => team.name === name).id }]);
  t.mock.method(ladderClient, "getFixtureStart", async () => start);
  t.mock.method(ladderClient, "getFixture", async (id) => ({
    id,
    start,
    home: { name: teams.find((team) => team.id === id).name, riders: [] },
    away: { name: "Opponent", riders: [] },
  }));
  t.mock.method(ladderClient, "refreshFixture", async (fixture) => fixture);
  t.mock.method(ladderState, "isPosted", async () => false);
  t.mock.method(ladderState, "markPosted", async (type, id) => deliveries.push([id, "marked", type]));

  const client = {
    channels: {
      async fetch(channelId) {
        if (channelId === "deleted-channel") throw unknownChannel;
        return {
          async send({ embeds }) {
            if (channelId === "stale-channel") throw unknownChannel;
            if (channelId === "restricted-channel") {
              throw Object.assign(new Error("Missing Permissions"), { code: RESTJSONErrorCodes.MissingPermissions });
            }
            const { title, url } = embeds[0].data;
            deliveries.push([url.split("/").at(-1), "sent", title.startsWith("Løbsdag:") ? "reminder" : "optakt", channelId]);
          },
        };
      },
    },
  };

  await maybeRunLadderJobs(client, new Date("2026-10-16T17:00:00Z"));

  const expectedChannels = [["1", "team-channel"], ["2", defaultChannelId], ["3", defaultChannelId], ["4", defaultChannelId]];
  assert.deepEqual(deliveries, expectedChannels.flatMap(([id, channelId]) => [
    [id, "sent", "reminder", channelId],
    [id, "marked", "postedLadderDayReminder"],
    [id, "sent", "optakt", channelId],
    [id, "marked", "postedLadderPreview"],
  ]));
  assert.ok(errorLog.mock.calls.some(({ arguments: args }) => args[1] === "Missing Permissions"));
});

test("parseTeamName accepts plain names and ladder links", () => {
  assert.equal(parseTeamName("  Chonky Chaser "), "Chonky Chaser");
  assert.equal(parseTeamName("https://ladder.cycleracing.club/teamView/Chonky%20Chaser"), "Chonky Chaser");
  assert.equal(parseTeamName("https://ladder.cycleracing.club/matchlist/fixtures/Mad%20Dogs?x=1"), "Mad Dogs");
});

test("summarizeProfile splits recent and all-time best W/kg and picks the latest category", () => {
  const now = 1_800_000_000;
  const day = 86400;
  const json = {
    data: [
      { event_date: now - 10 * day, category: "B", weight: [70], w300: [280], w1200: [245] },
      { event_date: now - 400 * day, category: "C", weight: [70], w300: [315], w1200: [259] },
    ],
  };
  const summary = summarizeProfile(json, now);
  assert.equal(summary.recent[300], 4);
  assert.equal(summary.best[300], 4.5);
  assert.equal(summary.category, "B");
  assert.equal(formPercent(summary), Math.round((100 * (4 / 4.5 + 3.5 / 3.7)) / 2));
});

test("store loads once, serves from memory and writes snapshots through the backend", async () => {
  const writes = [];
  let reads = 0;
  const backend = {
    async read() {
      reads += 1;
      return { a: 1 };
    },
    async write(data) {
      writes.push(data);
    },
  };
  const store = createStore("test", () => ({}), backend);
  assert.deepEqual(await store.load(), { a: 1 });
  await store.load();
  assert.equal(reads, 1);
  store.get().b = 2;
  await store.persist();
  assert.deepEqual(writes, [{ a: 1, b: 2 }]);
});

test("store retries the read after a failure and keeps the fallback when nothing is stored", async () => {
  let calls = 0;
  const backend = {
    async read() {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return undefined;
    },
    async write() {},
  };
  const store = createStore("test", () => ({ fresh: true }), backend);
  await assert.rejects(store.load(), /offline/);
  assert.deepEqual(await store.load(), { fresh: true });
});
