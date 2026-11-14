const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const config = require("../../config/config");
const ladderTeams = require("./ladderTeams");
const { handleLadderLink } = require("../../handlers/ladderHandlers");

function interaction(team, overrides = {}) {
  const replies = [];
  return {
    channelId: "team-channel",
    options: { getString: () => team, getBoolean: () => false, getInteger: () => null },
    editReply: async (reply) => replies.push(reply.content),
    replies,
    ...overrides,
  };
}

test("a URL is fetched and the canonical team name is linked to the invoking channel", async (t) => {
  const original = config.contentApi;
  config.contentApi = { baseUrl: "https://content-api.test", apiKey: "test-key" };
  t.after(() => { config.contentApi = original; });
  const fetched = [];
  t.mock.method(axios, "get", async (url, options) => {
    fetched.push({ url, path: options.params.path });
    return { data: '<script>const TEAMID = 82;</script><a href="/matchlist/fixtures/Chonky Chaser">Fixtures</a>' };
  });
  const links = [];
  t.mock.method(ladderTeams, "link", async (name, channelId) => {
    assert.equal(fetched.length, 1, "Lookup must finish before linking");
    links.push({ name, channelId });
    return true;
  });
  t.mock.method(ladderTeams, "getTeam", async () => ({ previewMinutes: 90 }));
  const item = interaction("https://ladder.cycleracing.club/teamView/chonky%20chaser");
  await handleLadderLink(item);
  assert.deepEqual(fetched, [{ url: "https://content-api.test/ladder_page", path: "/teamView/chonky%20chaser" }]);
  assert.deepEqual(links, [{ name: "Chonky Chaser", channelId: item.channelId }]);
  assert.match(item.replies[0], /Chonky Chaser.*primære kanal <#team-channel>/);
  assert.match(item.replies[0], /90 minutter/);
});

test("an unknown team URL does not create a link", async (t) => {
  const original = config.contentApi;
  config.contentApi = { baseUrl: "https://content-api.test", apiKey: "test-key" };
  t.after(() => { config.contentApi = original; });
  t.mock.method(axios, "get", async () => ({ data: '<title>404</title>' }));
  t.mock.method(ladderTeams, "link", async () => assert.fail("Cannot link an unresolved team"));
  t.mock.method(console, "error", () => {});
  const item = interaction("https://ladder.cycleracing.club/teamView/Unknown");
  await handleLadderLink(item);
  assert.match(item.replies[0], /Holdet er ikke linket/);
});

test("channel conflict errors explain how to link without taking another team's channel", async (t) => {
  const error = Object.assign(new Error("Conflict"), { userMessage: "Denne kanal er allerede primær kanal for Chonky Chaser." });
  t.mock.method(ladderTeams, "link", async () => { throw error; });
  t.mock.method(console, "error", () => {});
  const item = interaction("A whole lot of Danes");
  await handleLadderLink(item);
  assert.equal(item.replies[0], error.userMessage);
});

test("removing a team does not create a channel link", async (t) => {
  t.mock.method(ladderTeams, "unlink", async (name) => { assert.equal(name, "Chonky Chaser"); return true; });
  t.mock.method(ladderTeams, "link", async () => assert.fail("Removal must not create a link"));
  const item = interaction("Chonky Chaser");
  item.options.getBoolean = () => true;
  await handleLadderLink(item);
  assert.match(item.replies[0], /får ikke længere preview/);
});
