const test = require("node:test");
const assert = require("node:assert/strict");
const ladderClient = require("./ladderClient");
const ladderEmbed = require("./ladderEmbed");
const ladderTeams = require("./ladderTeams");

test("optakt in a thread defaults to the parent channel's team and posts in the thread", async (t) => {
  const teams = [
    { name: "Other team", channelId: "100000000000000000" },
    { name: "Chonky Chaser", channelId: "200000000000000000" },
  ];
  const team = teams[1];
  t.mock.method(ladderTeams, "list", async () => teams);
  t.mock.method(ladderTeams, "findByChannel", async (channelId) => teams.find((entry) => entry.channelId === channelId) || null);
  const fixture = { start: "2026-11-24T18:00:00Z" };
  const getNextFixture = t.mock.method(ladderClient, "getNextFixture", async () => fixture);
  t.mock.method(ladderClient, "refreshFixture", async () => fixture);
  const optakt = { content: "Match optakt" };
  t.mock.method(ladderEmbed, "buildLadderOptaktMessage", async () => optakt);
  const { handleLadderOptakt } = require("../../handlers/ladderHandlers");

  const threadId = "300000000000000000";
  const send = t.mock.fn();
  const parentSend = t.mock.fn();
  const editReply = t.mock.fn();
  await handleLadderOptakt({
    channelId: threadId,
    channel: {
      id: threadId, parentId: team.channelId, parent: { id: team.channelId, send: parentSend }, isThread: () => true, send,
    },
    options: { getString: () => null, getInteger: () => null },
    editReply,
  });

  assert.deepEqual(getNextFixture.mock.calls.map((call) => call.arguments), [[team.name]]);
  assert.deepEqual(send.mock.calls.map((call) => call.arguments), [[optakt]]);
  assert.equal(parentSend.mock.callCount(), 0);
  assert.match(editReply.mock.calls[0].arguments[0].content, /Optakt sendt/);
});
