const crypto = require("node:crypto");
const { createBroadcastStore } = require("./broadcastStore");
const { HEARTBEAT_TTL_MS, DISCOVERY_WINDOW_MS, checkDelay, discoveryExpired, hash, StreamingError, registrationKey, sessionKey, announcementKey } = require("./model");

const COLLECTION = "streaming_bot";
const LEASE_MS = 120_000;

function createStore(db, { now = Date.now, searchBudget = 90 } = {}) {
  const col = db.collection(COLLECTION);
  const ref = (id) => col.doc(id);
  const read = (snap) => snap.exists ? { ...snap.data(), id: snap.id } : null;
  const memberRef = (guildId, discordId) => ref(`member_${registrationKey(guildId, discordId)}`);
  const channelRef = (guildId, platform, channel) => ref(`channel_${guildId}_${platform}_${channel.id}`);
  const values = async (kind) => (await col.where("kind", "==", kind).get()).docs.map(read);
  const validSession = (session, registration) => registration && session?.active
    && session.registrationId === registration.registrationId && session.lastSeenAt > now() - HEARTBEAT_TTL_MS
    && !discoveryExpired(session, now());
  const expire = (tx, session) => tx.update(ref(session.id), { active: false, detectionExpired: true,
    leaseUntil: 0, lastError: "live_detection_timeout" });

  async function getRegistration(guildId, discordId) { return read(await memberRef(guildId, discordId).get()); }

  async function register({ guildId, discordId, discordName, channels, tokenHash }) {
    const target = memberRef(guildId, discordId);
    return db.runTransaction(async (tx) => {
      const previous = read(await tx.get(target));
      const claims = await Promise.all(Object.entries(channels).map(async ([platform, channel]) => {
        const claimRef = channelRef(guildId, platform, channel);
        return { platform, channel, ref: claimRef, value: read(await tx.get(claimRef)) };
      }));
      if (claims.some((claim) => claim.value && claim.value.owner !== target.id)) {
        throw new StreamingError("channel_in_use", "En af kanalerne er allerede tilmeldt af et andet medlem. Kontakt en admin.");
      }
      const registration = { id: target.id, kind: "member", guildId, discordId, discordName, channels, tokenHash,
        registrationId: crypto.randomUUID(), createdAt: previous?.createdAt || now(), updatedAt: now(),
        lastLiveAt: previous?.lastLiveAt || null, lastStreams: previous?.lastStreams || {}, lastCallbackAt: null };
      for (const [platform, channel] of Object.entries(previous?.channels || {})) {
        if (channels[platform]?.id !== channel.id) tx.delete(channelRef(guildId, platform, channel));
      }
      for (const claim of claims) tx.set(claim.ref, { kind: "channel", owner: target.id });
      for (const platform of ["youtube", "twitch"]) tx.delete(ref(`${target.id}_${platform}`));
      tx.set(target, registration);
      return registration;
    });
  }

  async function remove(guildId, discordId) {
    return db.runTransaction(async (tx) => {
      const target = memberRef(guildId, discordId);
      const previous = read(await tx.get(target));
      if (!previous) return false;
      for (const [platform, channel] of Object.entries(previous.channels)) tx.delete(channelRef(guildId, platform, channel));
      for (const platform of ["youtube", "twitch"]) tx.delete(ref(`${target.id}_${platform}`));
      tx.delete(target); // Queued work checks registrationId again before any publication.
      return true;
    });
  }

  async function acceptEvent(registration, event) {
    return db.runTransaction(async (tx) => {
      const current = read(await tx.get(ref(registration.id)));
      const target = ref(sessionKey(registration, event.platform));
      const previous = read(await tx.get(target));
      if (!current || current.registrationId !== registration.registrationId || !current.channels[event.platform]) {
        throw new StreamingError("invalid_key", "DZR-nøglen er ikke gyldig.", 401);
      }
      if (event.event === "test") {
        tx.update(ref(current.id), { lastCallbackAt: now() });
        return { accepted: true, test: true };
      }
      const sameSession = previous?.sessionId === event.sessionId;
      if (previous && (sameSession ? event.sequence <= previous.sequence : event.startedAt <= previous.startedAt)) return { accepted: true, duplicate: true };
      // A late heartbeat must never reactivate a stopped session.
      if (sameSession && (previous.event === "stopped" || previous.detectionExpired)) return { accepted: true, duplicate: true };
      const session = { ...(sameSession ? previous : {}), ...event, id: target.id, kind: "session", memberId: current.id,
        guildId: current.guildId, discordId: current.discordId, registrationId: current.registrationId,
        active: event.event !== "stopped", lastSeenAt: now(), nextCheckAt: sameSession ? previous.nextCheckAt : now() };
      tx.set(target, session);
      tx.update(ref(current.id), { lastCallbackAt: now() });
      return { accepted: true };
    });
  }

  async function claimSession(id) {
    return db.runTransaction(async (tx) => {
      const session = read(await tx.get(ref(id)));
      if (!session?.active || session.nextCheckAt > now() || session.leaseUntil > now()) return null;
      const registration = read(await tx.get(ref(session.memberId)));
      if (registration?.registrationId === session.registrationId && discoveryExpired(session, now())) {
        expire(tx, session);
        return { session, registration, expired: true };
      }
      if (!validSession(session, registration)) { tx.update(ref(id), { active: false }); return null; }
      if (session.discoveredAt) return null; // One discovery per OBS session; delivery rechecks delayed notices separately.
      const leaseId = crypto.randomUUID();
      tx.update(ref(id), { leaseId, leaseUntil: now() + LEASE_MS });
      return { session: { ...session, leaseId }, registration };
    });
  }

  async function finishCheck(session, { state = {}, streams = [], error = null }, channelId) {
    return db.runTransaction(async (tx) => {
      const current = read(await tx.get(ref(session.id)));
      const registration = read(await tx.get(ref(session.memberId)));
      if (current?.leaseId === session.leaseId && current.sessionId === session.sessionId
          && registration?.registrationId === session.registrationId && discoveryExpired(current, now())) {
        expire(tx, current);
        return { expired: true };
      }
      if (!validSession(current, registration) || current.leaseId !== session.leaseId || current.sessionId !== session.sessionId) return;
      const notices = await Promise.all(streams.map(async (stream) => {
        const id = `notice_${announcementKey(channelId, stream)}`;
        return { id, stream, previous: read(await tx.get(ref(id))) };
      }));
      for (const notice of notices) {
        // Never replace an attempted/sent delivery. An entirely unsent cancelled generation
        // can be adopted after the member rotates their key or enrolls again.
        const canReplace = notice.previous && !notice.previous.firstAttemptAt && !notice.previous.messageId
          && (notice.previous.status === "cancelled" || notice.previous.registrationId !== registration.registrationId);
        if (!notice.previous || canReplace) tx.set(ref(notice.id), { id: notice.id, kind: "notice", status: "pending", channelId,
          memberId: registration.id, registrationId: registration.registrationId, sessionId: session.id,
          stream: notice.stream, createdAt: now(), verifiedAt: now(), attempts: 0, nonce: notice.id.slice(7, 31) });
      }
      if (streams.length) {
        const latest = streams.reduce((a, b) => Date.parse(a.startedAt) > Date.parse(b.startedAt) ? a : b);
        tx.update(ref(registration.id), { lastLiveAt: Math.max(registration.lastLiveAt || 0, Date.parse(latest.startedAt)),
          lastStreams: { ...registration.lastStreams, [session.platform]: latest } });
      }
      tx.update(ref(session.id), { ...state, leaseUntil: 0, lastCheckAt: now(), lastError: error,
        discoveredAt: streams.length ? now() : null, checkAttempts: (current.checkAttempts || 0) + 1,
        nextCheckAt: Math.min(now() + checkDelay(current.checkAttempts || 0), current.startedAt + DISCOVERY_WINDOW_MS) });
    });
  }

  async function claimNotice(id) {
    return db.runTransaction(async (tx) => {
      const notice = read(await tx.get(ref(id)));
      if (!notice || notice.status !== "pending" || notice.leaseUntil > now() || notice.nextAttemptAt > now()) return null;
      const registration = read(await tx.get(ref(notice.memberId)));
      const session = read(await tx.get(ref(notice.sessionId)));
      if (!validSession(session, registration) || registration.registrationId !== notice.registrationId) {
        tx.update(ref(id), { status: "cancelled" });
        return null;
      }
      const leaseId = crypto.randomUUID();
      tx.update(ref(id), { leaseId, leaseUntil: now() + LEASE_MS });
      return { notice: { ...notice, leaseId }, registration, session };
    });
  }

  async function beginSend(notice) {
    return db.runTransaction(async (tx) => {
      const current = read(await tx.get(ref(notice.id)));
      const registration = read(await tx.get(ref(notice.memberId)));
      const session = read(await tx.get(ref(notice.sessionId)));
      if (!current || current.leaseId !== notice.leaseId || current.status !== "pending"
          || !validSession(session, registration) || registration.registrationId !== notice.registrationId) return false;
      tx.update(ref(notice.id), { firstAttemptAt: current.firstAttemptAt || now(), attempts: current.attempts + 1 });
      return true;
    });
  }

  async function finishNotice(notice, patch) {
    return db.runTransaction(async (tx) => {
      const current = read(await tx.get(ref(notice.id)));
      if (current?.leaseId !== notice.leaseId) return;
      tx.update(ref(notice.id), { ...patch, leaseUntil: 0, nextAttemptAt: now() + 30_000 });
    });
  }

  async function reserveSearch() {
    // YouTube resets its project quota at midnight in Los Angeles, including DST.
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now());
    return db.runTransaction(async (tx) => {
      const target = ref(`quota_${day}`);
      const previous = read(await tx.get(target));
      if ((previous?.searches || 0) >= searchBudget) return false;
      tx.set(target, { kind: "quota", searches: (previous?.searches || 0) + 1, day });
      return true;
    });
  }

  async function queueAlert(registration, code, sessionId = "callback") {
    const id = `alert_${hash(`${registration.registrationId}:${sessionId}:${code}`)}`;
    return db.runTransaction(async (tx) => {
      const target = ref(id);
      if ((await tx.get(target)).exists) return;
      tx.set(target, { id, kind: "alert", guildId: registration.guildId, discordId: registration.discordId,
        code, createdAt: now(), alertPending: true });
    });
  }

  async function claimAlert(id) {
    return db.runTransaction(async (tx) => {
      const alert = read(await tx.get(ref(id)));
      if (!alert?.alertPending || alert.nextAttemptAt > now() || alert.leaseUntil > now()) return null;
      const leaseId = crypto.randomUUID();
      tx.update(ref(id), { leaseId, leaseUntil: now() + LEASE_MS });
      return { ...alert, leaseId };
    });
  }

  async function finishAlert(alert, sent) {
    return db.runTransaction(async (tx) => {
      const current = read(await tx.get(ref(alert.id)));
      if (current?.leaseId !== alert.leaseId) return;
      tx.update(ref(alert.id), { alertPending: !sent, leaseUntil: 0, nextAttemptAt: now() + 60_000 });
    });
  }

  return { ...createBroadcastStore(db, { now }), getRegistration, register, remove, acceptEvent, claimSession, finishCheck, claimNotice, beginSend, finishNotice, reserveSearch,
    queueAlert, claimAlert, finishAlert,
    listAlerts: async () => (await col.where("alertPending", "==", true).get()).docs.map(read),
    listRegistrations: async (guildId) => (await values("member")).filter((item) => item.guildId === guildId),
    listSessions: async () => (await col.where("active", "==", true).get()).docs.map(read),
    listNotices: async () => (await col.where("status", "==", "pending").get()).docs.map(read),
    listIssues: async (guildId) => (await values("session")).filter((item) => item.guildId === guildId && item.lastError) };
}

module.exports = { createStore, COLLECTION };
