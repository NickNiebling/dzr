const test = require("node:test");
const assert = require("node:assert/strict");
const { PermissionsBitField } = require("discord.js");
const config = require("../../config/config");
const { handleLadderTeams, handleLadderTeamsButton } = require("../../handlers/ladderHandlers");
const ladderTeams = require("./ladderTeams");

const admin = {
  guildId: config.discord.guildId,
  memberPermissions: new PermissionsBitField(PermissionsBitField.Flags.Administrator),
};

function buttonIds(components) {
  const ids = [];
  for (const component of components) {
    if (component.custom_id) ids.push(component.custom_id);
    if (component.accessory?.custom_id) ids.push(component.accessory.custom_id);
    if (component.components) ids.push(...buttonIds(component.components));
  }
  return ids;
}

test("regular members cannot view or remove Ladder teams", async (t) => {
  const list = t.mock.method(ladderTeams, "list", async () => []);
  const unlink = t.mock.method(ladderTeams, "unlink", async () => true);
  const member = { ...admin, memberPermissions: new PermissionsBitField() };
  const editReply = t.mock.fn();
  const reply = t.mock.fn();

  await handleLadderTeams({ ...member, editReply });
  for (const action of ["remove", "confirm"]) {
    await handleLadderTeamsButton({ ...member, customId: `ladder_team:${action}:test`, reply });
  }

  assert.equal(editReply.mock.callCount(), 1);
  assert.equal(reply.mock.callCount(), 2);
  assert.equal(list.mock.callCount(), 0);
  assert.equal(unlink.mock.callCount(), 0);
});

test("an admin only removes a Ladder team after confirming", async (t) => {
  const teamName = "Chonky Chaser";
  const teams = [{ name: teamName }];
  t.mock.method(ladderTeams, "list", async () => teams);
  const unlink = t.mock.method(ladderTeams, "unlink", async () => {
    teams.pop();
    return true;
  });
  let response;
  const editReply = async (payload) => { response = payload; };
  const actions = () => buttonIds(response.components.map((component) => component.toJSON()));
  const click = (customId) => handleLadderTeamsButton({
    ...admin, customId, deferUpdate: async () => {}, editReply,
  });

  await handleLadderTeams({ ...admin, editReply });
  const removeId = actions().find((id) => id.startsWith("ladder_team:remove:"));
  assert.ok(removeId);

  await click(removeId);
  const cancelId = actions().find((id) => id === "ladder_team:cancel");
  assert.ok(cancelId);

  await click(cancelId);
  assert.equal(unlink.mock.callCount(), 0);
  assert.ok(actions().includes(removeId));

  await click(removeId);
  const confirmId = actions().find((id) => id.startsWith("ladder_team:confirm:"));
  assert.ok(confirmId);
  await click(confirmId);
  assert.equal(unlink.mock.callCount(), 1);
  assert.deepEqual(unlink.mock.calls[0].arguments, [teamName]);
  assert.equal(actions().some((id) => id === removeId || id === confirmId), false);
});
