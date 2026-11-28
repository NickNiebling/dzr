const { firestore } = require("../constants.json");
const { localParts } = require("./announcer/pacing");
const { reportRecurringError } = require("./recurringError");

const TIME_ZONE = "Europe/Copenhagen";
let running = false;
let savedDate;

function isScheduledSnapshot(doc) {
  const data = doc.data();
  return data?.source === "scheduled" && data.estimated !== true;
}

async function maybeSaveMemberSnapshot(client, db, guildId, now = () => new Date()) {
  if (running) return;
  const { dateKey, hour, minute } = localParts(now(), TIME_ZONE);
  if (hour !== 23 || minute < 45 || dateKey === savedDate) return;

  running = true;
  try {
    const ref = db.collection(firestore.serverMemberCounts).doc(dateKey);
    if (isScheduledSnapshot(await ref.get())) {
      savedDate = dateKey;
      return;
    }

    const settings = await db.collection(firestore.systemSettings).doc("global").get();
    const clubMemberRoleId = String(settings.data()?.membership?.clubMemberRoleId || "").trim();
    if (!clubMemberRoleId) throw new Error("Discord club member role is not configured");

    const guild = await client.guilds.fetch({ guild: guildId, withCounts: true, force: true });
    const roleIds = [...guild.roles.cache.keys()].filter(id => id !== guildId);
    const roleCounts = Object.fromEntries(roleIds.map(id => [id, 0]));
    if (!Object.hasOwn(roleCounts, clubMemberRoleId)) {
      throw new Error(`Configured Discord club member role ${clubMemberRoleId} was not found`);
    }

    const members = await guild.members.fetch();
    for (const member of members.values()) {
      for (const id of member.roles.cache.keys()) {
        if (Object.hasOwn(roleCounts, id)) roleCounts[id] += 1;
      }
    }
    const observedAt = now();
    if (localParts(observedAt, TIME_ZONE).dateKey !== dateKey) {
      throw new Error("Discord member collection ended after midnight");
    }
    const snapshot = {
      dateKey,
      timestamp: observedAt.toISOString(),
      source: "scheduled",
      memberCount: members.size,
      roleCounts,
      clubMemberRoleId,
      clubMemberCount: roleCounts[clubMemberRoleId],
    };
    if (Number.isInteger(guild.approximatePresenceCount)) {
      snapshot.presenceCount = guild.approximatePresenceCount;
    }

    // Another bot process may have saved the day while this one fetched members.
    await db.runTransaction(async tx => {
      if (!isScheduledSnapshot(await tx.get(ref))) tx.set(ref, snapshot);
    });
    savedDate = dateKey;
  } catch (error) {
    reportRecurringError("scheduler.memberSnapshot", "Failed to save the Discord member snapshot:", error);
  } finally {
    running = false;
  }
}

module.exports = { maybeSaveMemberSnapshot };
