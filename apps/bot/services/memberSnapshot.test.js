const test = require("node:test");
const assert = require("node:assert/strict");
const { maybeSaveMemberSnapshot } = require("./memberSnapshot");

test("the evening job uses Copenhagen time and retries without erasing history", async t => {
  const previous = { memberCount: 99, estimated: true };
  const documents = {
    "server_member_counts/2026-06-14": previous,
    "system_settings/global": { membership: { clubMemberRoleId: "club" } },
  };
  const db = {
    collection: name => ({
      doc(id) {
        const path = `${name}/${id}`;
        return { path, get: async () => ({ data: () => documents[path] }) };
      },
    }),
    async runTransaction(update) {
      await update({
        get: ref => ref.get(),
        set: (ref, data) => { documents[ref.path] = data; },
      });
    },
  };
  const member = (...roles) => ({ roles: { cache: new Set(["guild", ...roles]) } });
  const fetchMembers = t.mock.fn(async () => new Set([member("club"), member("other")]));
  fetchMembers.mock.mockImplementationOnce(async () => { throw new Error("Discord timeout"); });
  t.mock.method(console, "error", () => {});
  const guild = {
    approximatePresenceCount: 1,
    roles: { cache: new Set(["guild", "club", "other", "empty"]) },
    members: { fetch: fetchMembers },
  };
  const client = { guilds: { fetch: async () => guild } };

  await maybeSaveMemberSnapshot(client, db, "guild", () => new Date("2026-06-14T21:45:00Z"));
  assert.deepEqual(documents["server_member_counts/2026-06-14"], previous);

  await maybeSaveMemberSnapshot(client, db, "guild", () => new Date("2026-06-14T21:46:00Z"));
  await maybeSaveMemberSnapshot(client, db, "guild", () => new Date("2026-06-14T21:47:00Z"));

  assert.deepEqual(documents["server_member_counts/2026-06-14"], {
    dateKey: "2026-06-14",
    timestamp: "2026-06-14T21:46:00.000Z",
    source: "scheduled",
    memberCount: 2,
    presenceCount: 1,
    clubMemberRoleId: "club",
    clubMemberCount: 1,
    roleCounts: { club: 1, other: 1, empty: 0 },
  });
  assert.equal(fetchMembers.mock.callCount(), 2);

  await maybeSaveMemberSnapshot(client, db, "guild", () => new Date("2026-12-06T22:45:00Z"));
  assert.equal(documents["server_member_counts/2026-12-06"]?.timestamp, "2026-12-06T22:45:00.000Z");
});
