const test = require("node:test");
const assert = require("node:assert/strict");
const { handleLadderLink } = require("../../handlers/ladderHandlers");
const ladderTeams = require("./ladderTeams");

test("ladder_link from a thread links and confirms its parent channel", async (t) => {
  const teamName = "Chonky Chaser";
  const link = t.mock.method(ladderTeams, "link", async () => true);
  t.mock.method(ladderTeams, "getTeam", async () => ({ name: teamName, optaktMin: 45 }));
  const editReply = t.mock.fn();

  await handleLadderLink({
    channelId: "100000000000000000",
    channel: { id: "100000000000000000", parentId: "200000000000000000", isThread: () => true },
    options: {
      getString: () => teamName,
      getBoolean: () => false,
      getInteger: () => null,
    },
    editReply,
  });

  assert.deepEqual(link.mock.calls.map(({ arguments: args }) => args), [[teamName, "200000000000000000", null]]);
  assert.match(editReply.mock.calls[0].arguments[0].content, /Chonky Chaser er tilknyttet <#200000000000000000>\./);
  assert.match(editReply.mock.calls[0].arguments[0].content, /Optakt: 45 min før start\./);
});
