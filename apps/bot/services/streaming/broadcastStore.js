const crypto = require("node:crypto");
const { hash, announcementKey, HEARTBEAT_TTL_MS, StreamingError } = require("./model");

const LEASE_MS = 120_000;

// Additive v2 records live beside the v1 outbox. Old receipts remain authoritative.
function createBroadcastStore(db, { now = Date.now } = {}) {
  const col = db.collection("streaming_bot");
  const ref = (id) => col.doc(id);
  const read = (snap) => snap.exists ? { ...snap.data(), id: snap.id } : null;

  async function acceptBroadcastEvent(registration, event, channelId) {
    return db.runTransaction(async (tx) => {
      const member = read(await tx.get(ref(registration.id)));
      if (member?.registrationId !== registration.registrationId) throw new StreamingError("invalid_key", "DZR-nøglen er ikke gyldig.", 401);
      if (event.event === "test") {
        tx.update(ref(member.id), { lastCallbackAt: now() });
        return { accepted: true, test: true };
      }
      const sourceId = `obs_${hash(`${registration.registrationId}:${event.sessionId}`)}`;
      const pointerId = `broadcast_current_${hash(`${member.id}:${channelId}`)}`;
      const source = read(await tx.get(ref(sourceId)));
      const pointer = read(await tx.get(ref(pointerId)));
      const previous = pointer?.broadcastId ? read(await tx.get(ref(pointer.broadcastId))) : null;
      if (source && (event.sequence <= source.sequence || source.stopped || source.broadcastId !== previous?.id)) return { accepted: true, duplicate: true };
      if (!source && event.startedAt < (pointer?.latestStartedAt || 0)) return { accepted: true, duplicate: true };
      if (!source && event.event === "stopped") return { accepted: true, duplicate: true };
      const abandonedDiscovery = !source && previous?.work === false && !previous.firstVerifiedAt;
      let broadcast = previous?.registrationId === member.registrationId && !previous.endedAt
        && previous.phase !== "cancelled" && !abandonedDiscovery ? previous : null;
      // An expired discovery needs a new OBS session, never a late heartbeat.
      if (source && (!broadcast || broadcast.discoveryExpired)) return { accepted: true, duplicate: true };
      if (!broadcast) {
        const id = `broadcast_${crypto.randomUUID()}`;
        broadcast = { id, kind: "broadcast", work: true, phase: "discovering", memberId: member.id,
          registrationId: member.registrationId, guildId: member.guildId, discordId: member.discordId, channelId,
          createdAt: now(), startedAt: event.startedAt, platforms: {}, obs: {}, eventRevision: 0,
          nextCheckAt: now(), nonce: hash(id).slice(0, 24) };
      }
      const wasIdle = broadcast.work === false;
      const videoChanged = event.videoId && event.videoId !== broadcast.videoId;
      broadcast.obs[event.sessionId] = { stopped: event.event === "stopped", lastSeenAt: now() };
      if (event.videoId) broadcast.videoId = event.videoId;
      if (event.event !== "heartbeat" || videoChanged) broadcast.eventRevision++;
      broadcast.work = true;
      if (event.event === "started" || event.event === "stopped" || wasIdle) broadcast.nextCheckAt = now();
      if (event.event === "stopped") broadcast.forceMonitor = true;
      tx.set(ref(sourceId), { kind: "obs_source", broadcastId: broadcast.id, sequence: event.sequence, stopped: event.event === "stopped" });
      tx.set(ref(pointerId), { kind: "broadcast_pointer", broadcastId: broadcast.id,
        latestStartedAt: Math.max(event.startedAt, pointer?.latestStartedAt || 0) });
      tx.set(ref(broadcast.id), broadcast);
      tx.update(ref(member.id), { lastCallbackAt: now() });
      return { accepted: true };
    });
  }

  async function claimBroadcast(id) {
    return db.runTransaction(async (tx) => {
      const broadcast = read(await tx.get(ref(id)));
      if (!broadcast?.work || broadcast.nextCheckAt > now() || broadcast.leaseUntil > now()) return null;
      const registration = read(await tx.get(ref(broadcast.memberId)));
      if (registration?.registrationId !== broadcast.registrationId) {
        tx.update(ref(id), { work: false, phase: "cancelled", leaseUntil: 0 });
        return null;
      }
      const leaseId = crypto.randomUUID();
      tx.update(ref(id), { leaseId, leaseUntil: now() + LEASE_MS });
      return { broadcast: { ...broadcast, leaseId, leaseUntil: now() + LEASE_MS }, registration };
    });
  }

  async function saveBroadcast(broadcast, { release = false, delivery = false } = {}) {
    return db.runTransaction(async (tx) => {
      const current = read(await tx.get(ref(broadcast.id)));
      const member = read(await tx.get(ref(broadcast.memberId)));
      if (current?.leaseId !== broadcast.leaseId || current.leaseUntil <= now()) return null;
      if (member?.registrationId !== broadcast.registrationId) {
        tx.update(ref(broadcast.id), { work: false, phase: "cancelled", leaseUntil: 0 });
        return null;
      }
      if (current.eventRevision !== broadcast.eventRevision) {
        // A receipt must survive a stop/heartbeat racing with a successful Discord send.
        tx.update(ref(broadcast.id), { ...(delivery ? { messageId: broadcast.messageId || null,
          deliveredHash: broadcast.deliveredHash || null, deleted: !!broadcast.deleted } : {}), leaseUntil: 0, nextCheckAt: now() });
        return null;
      }
      const receipts = [];
      for (const [platform, state] of Object.entries(broadcast.platforms)) {
        for (const segment of state.segments || []) {
          const id = `notice_${announcementKey(broadcast.channelId, segment.stream)}`;
          const value = read(await tx.get(ref(id)));
          const owner = value?.broadcastId && value.broadcastId !== broadcast.id ? read(await tx.get(ref(value.broadcastId))) : null;
          const reclaimable = value && !value.firstAttemptAt && !value.messageId && (
            value.status === "cancelled" || (owner && !owner.firstAttemptAt && !owner.messageId
              && (owner.phase === "cancelled" || owner.registrationId !== broadcast.registrationId)));
          receipts.push({ id, platform, stream: segment.stream, value, reclaimable });
        }
      }
      for (const receipt of receipts) {
        if (receipt.value && !receipt.reclaimable && receipt.value.broadcastId !== broadcast.id) {
          // Never repost broadcasts already owned by a legacy receipt or another generation.
          broadcast.platforms[receipt.platform] = { suppressed: true, nextDiscoveryAt: null };
        }
      }
      const lastStreams = { ...member.lastStreams };
      for (const receipt of receipts) {
        if (broadcast.platforms[receipt.platform].suppressed) continue;
        if (!receipt.value || receipt.reclaimable) {
          tx.set(ref(receipt.id), { kind: "broadcast_receipt", broadcastId: broadcast.id, stream: receipt.stream });
        }
        lastStreams[receipt.platform] = receipt.stream;
      }
      if (receipts.length) tx.update(ref(member.id), { lastStreams,
        lastLiveAt: Math.max(member.lastLiveAt || 0, ...Object.values(lastStreams).map((stream) => Date.parse(stream.startedAt))) });
      // Heartbeats may arrive while providers/Discord are in flight; retain the newest OBS liveness.
      broadcast.obs = current.obs;
      broadcast.leaseUntil = release ? 0 : now() + LEASE_MS;
      tx.set(ref(broadcast.id), broadcast);
      return broadcast;
    });
  }

  return { acceptBroadcastEvent, claimBroadcast, saveBroadcast,
    listBroadcasts: async () => (await col.where("work", "==", true).get()).docs.map(read),
    listBroadcastIssues: async (guildId) => (await col.where("kind", "==", "broadcast").get()).docs.map(read)
      .filter((item) => item.guildId === guildId && item.lastError) };
}

const obsAlive = (broadcast, now) => Object.values(broadcast.obs).some((source) => !source.stopped && source.lastSeenAt > now - HEARTBEAT_TTL_MS);

module.exports = { createBroadcastStore, obsAlive };
