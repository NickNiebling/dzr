const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { loadCommonJs } = require("./test-support/verification");

const source = readFileSync(path.join(__dirname, "scheduler.js"), "utf8");
const noop = async () => {};

function loadScheduler(contentApi, maybePostScheduledQuiz = noop) {
  return loadCommonJs(source, {
    "discord.js": {},
    "./contentApi": {
      getDueScheduledMessages: async () => [],
      refreshClubRoster: noop,
      refreshZwiftPowerRoster: noop,
      fixDueFiftyResults: noop,
      applyDueWeeklySeries: noop,
      ...contentApi,
    },
    "./newMemberService": { sweepGuildForNewMembers: noop },
    "../config/config": {},
    "./firebase": { getBotState: noop, setBotState: noop },
    "./zpRoleSync": { syncZpRolesForGuild: noop },
    "./quizService": { maybePostScheduledQuiz },
    "./coachFollowUp": { maybeSendCoachFollowUps: noop },
    "./ladder/ladderJobs": { maybeRunLadderJobs: noop },
    "./announcementIndex": { maybeSyncAnnouncements: noop },
    "./announcer": { maybeRunAnnouncer: noop },
    "./recurringError": { reportRecurringError: noop },
    "./memberSnapshot": { maybeSaveMemberSnapshot: noop },
  }, {
    console: { log() {}, error() {} },
    process: { env: {} },
  });
}

function makeClient(channels = []) {
  return {
    channels: { cache: new Map(channels), fetch: async () => null },
    guilds: { cache: new Map() },
  };
}

test("an overlapping scheduler check does not send the same scheduled message", async () => {
  const deliveryStarted = Promise.withResolvers();
  const finishDelivery = Promise.withResolvers();
  const deliveries = [];
  const marked = [];
  const client = makeClient([["channel", {
    name: "general",
    guild: { name: "DZR" },
    async send(payload) {
      deliveries.push(payload);
      deliveryStarted.resolve();
      await finishDelivery.promise;
    },
  }]]);
  const { checkScheduledMessages } = loadScheduler({
    getDueScheduledMessages: async () => [{
      id: "reminder", title: "Reminder", channel_id: "channel", content: "Time to ride!",
    }],
    processMessageContent: (content) => content,
    markScheduledMessageSent: async (id) => marked.push(id),
  });

  const firstCheck = checkScheduledMessages(client);
  await deliveryStarted.promise;
  const overlappingCheck = checkScheduledMessages(client);
  finishDelivery.resolve();
  await Promise.all([firstCheck, overlappingCheck]);

  assert.deepEqual(deliveries, [{ content: "Time to ride!" }]);
  assert.deepEqual(marked, ["reminder"]);
});

test("the scheduler checks again after a failed run and after a successful run", async (t) => {
  const getDueScheduledMessages = t.mock.fn(async () => []);
  const quiz = t.mock.fn(noop);
  quiz.mock.mockImplementationOnce(async () => { throw new Error("quiz unavailable"); });
  const { checkScheduledMessages } = loadScheduler({ getDueScheduledMessages }, quiz);
  const client = makeClient();

  await checkScheduledMessages(client);
  await checkScheduledMessages(client);
  await checkScheduledMessages(client);

  assert.equal(getDueScheduledMessages.mock.callCount(), 3);
  assert.equal(quiz.mock.callCount(), 3);
});
