const { HEARTBEAT_TTL_MS, DISCOVERY_WINDOW_MS, checkDelay, hash, broadcastMessage } = require("./model");
const { obsAlive } = require("./broadcastStore");

const POLL_MS = 60_000;
const GRACE_MS = 300_000;
const RECORDING_DELAYS = [0, 60_000, 300_000, 900_000, 1800_000, 3600_000];
const liveStates = (broadcast) => Object.values(broadcast.platforms).filter((state) => state.stream);
const milliseconds = (value) => typeof value === "number" ? value : Date.parse(value);

async function* completedChecks(checks) {
  const pending = new Map(checks.map((check, index) => [index, check.then((value) => ({ index, value }))]));
  while (pending.size) {
    const { index, value } = await Promise.race(pending.values());
    pending.delete(index);
    yield value;
  }
}

function finishSegment(state, end, approximate) {
  const segment = state.segments[state.segments.length - 1];
  segment.endedAt = Math.max(milliseconds(segment.stream.startedAt), end);
  segment.approximate = !!segment.approximate || approximate;
}

function becameLive(state, stream, time) {
  if (state.stream?.id !== stream.id) {
    if (state.stream) finishSegment(state, state.pendingEndAt || state.lastLiveAt, !state.exactEnd);
    state.segments = [...(state.segments || []), { stream, excludedMs: 0 }];
  } else if (state.offlineSince) {
    const segment = state.segments[state.segments.length - 1];
    segment.excludedMs = (segment.excludedMs || 0) + time - state.offlineSince;
    segment.approximate = true;
  }
  Object.assign(state, { stream, status: "live", lastLiveAt: time, offlineSince: null,
    pendingEndAt: null, exactEnd: false, nextMonitorAt: time + POLL_MS, recordings: state.recordings || [] });
}

function createBroadcastWorker({ store, providers, publisher, now, reportError }) {
  async function process(id) {
    const claimed = await store.claimBroadcast(id);
    if (!claimed) return;
    let { broadcast } = claimed;
    const { registration } = claimed;
    try {
      const errors = [];
      // Start independent discovery calls together. Publish a successful result as soon as
      // it arrives, without waiting for a slow or offline second provider.
      const checks = Object.keys(registration.channels).map((platform) => {
        const state = broadcast.platforms[platform] ||= { nextDiscoveryAt: broadcast.createdAt, attempts: 0, providerState: {} };
        const deadline = broadcast.firstVerifiedAt ? broadcast.additionalDeadline : broadcast.startedAt + DISCOVERY_WINDOW_MS;
        if (state.stream || state.suppressed || (broadcast.firstVerifiedAt ? now() > deadline : now() >= deadline)
            || state.nextDiscoveryAt > now() || (!broadcast.firstVerifiedAt && !obsAlive(broadcast, now()))) return Promise.resolve({ platform });
        const attemptedAt = now();
        return providers.verify(registration.channels[platform], {
          ...state.providerState, platform, startedAt: broadcast.startedAt,
          ...(platform === "youtube" && broadcast.videoId ? { videoId: broadcast.videoId } : {}),
        }, store).then((result) => ({ platform, result, attemptedAt }), (error) => ({ platform, error, attemptedAt }));
      });
      for await (const check of completedChecks(checks)) {
        const { platform } = check;
        const state = broadcast.platforms[platform];
        let announceFirst = false;
        if (state.suppressed) continue;
        try {
          if (!state.stream) {
            const deadline = broadcast.firstVerifiedAt ? broadcast.additionalDeadline : broadcast.startedAt + DISCOVERY_WINDOW_MS;
            if (check.error) throw check.error;
            if (!check.result) continue;
            const { result, attemptedAt } = check;
            state.providerState = result.state || state.providerState;
            if (result.error) errors.push(result.error);
            const stream = result.streams?.[0];
            const eligible = broadcast.firstVerifiedAt ? attemptedAt <= broadcast.additionalDeadline : now() < deadline;
            if (stream && eligible) {
              becameLive(state, stream, now());
              if (!broadcast.firstVerifiedAt) {
                broadcast.firstVerifiedAt = now();
                broadcast.additionalDeadline = now() + GRACE_MS;
                announceFirst = true;
                // Missing providers switch from initial backoff to the shared minute schedule.
                for (const other of Object.values(broadcast.platforms)) if (!other.stream) other.nextDiscoveryAt = now() + POLL_MS;
              }
            }
            state.attempts++;
            state.nextDiscoveryAt = broadcast.firstVerifiedAt
              ? broadcast.firstVerifiedAt + Math.max(1, Math.floor((attemptedAt - broadcast.firstVerifiedAt) / POLL_MS) + 1) * POLL_MS
              : Math.min(now() + checkDelay(state.attempts - 1), deadline);
          } else if (state.status !== "ended" && (broadcast.forceMonitor || state.nextMonitorAt <= now())) {
            const result = providers.monitor
              ? await providers.monitor(registration.channels[platform], state.stream)
              : { status: "live", stream: (await providers.verify(registration.channels[platform], { platform, videoId: state.stream.id }, store)).streams[0] };
            if (result.status === "unknown") { errors.push(result.error || "provider_unavailable"); state.nextMonitorAt = now() + POLL_MS; continue; }
            if (result.status === "live" && result.stream) becameLive(state, result.stream, now());
            else {
              state.offlineSince ||= now();
              state.status = "offline_pending";
              state.pendingEndAt ||= result.endedAt ? milliseconds(result.endedAt) : state.lastLiveAt;
              if (result.endedAt) { state.pendingEndAt = milliseconds(result.endedAt); state.exactEnd = true; }
              // A new YouTube broadcast ID cannot be found by monitoring the old ID.
              let restarted = null;
              if (platform === "youtube" && now() <= state.offlineSince + GRACE_MS) {
                const found = await providers.verify(registration.channels[platform], { platform, startedAt: state.offlineSince }, store);
                if (found.error) errors.push(found.error);
                restarted = found.streams?.[0];
              }
              if (restarted) becameLive(state, restarted, now());
              else if (now() >= state.offlineSince + GRACE_MS) {
                finishSegment(state, state.pendingEndAt, !state.exactEnd);
                state.status = "ended";
                state.endedAt = now();
                state.approximate = state.segments.some((segment) => segment.approximate);
                state.durationMs = state.segments.reduce((total, segment) => total + Math.max(0,
                  milliseconds(segment.endedAt) - milliseconds(segment.stream.startedAt) - (segment.excludedMs || 0)), 0);
                state.recordingAttempt = 0;
                state.nextRecordingAt = now();
              }
              if (state.status === "offline_pending") state.nextMonitorAt = Math.min(now() + POLL_MS, state.offlineSince + GRACE_MS);
            }
          }
          if (state.status === "ended" && state.recordingAttempt < RECORDING_DELAYS.length && state.nextRecordingAt <= now()) {
            const recordings = providers.recordings ? await providers.recordings(registration.channels[platform], state.segments.map((segment) => segment.stream)) : [];
            state.recordings = recordings;
            state.recordingAttempt++;
            const knownIds = new Set(state.segments.map((segment) => segment.stream.id));
            const complete = [...knownIds].every((streamId) => recordings.some((recording) => recording.streamId === streamId));
            state.nextRecordingAt = complete || state.recordingAttempt >= RECORDING_DELAYS.length ? null
              : state.endedAt + RECORDING_DELAYS[state.recordingAttempt];
            if (complete) state.recordingAttempt = RECORDING_DELAYS.length;
          }
        } catch (error) {
          errors.push(error.code || "verification_failed");
          // Failed requests never manufacture offline state or extend the discovery window.
          if (state.stream && state.status !== "ended") state.nextMonitorAt = now() + POLL_MS;
          else if (state.status === "ended") {
            state.recordingAttempt++;
            state.nextRecordingAt = state.recordingAttempt >= RECORDING_DELAYS.length ? null : state.endedAt + RECORDING_DELAYS[state.recordingAttempt];
          } else {
            state.attempts++;
            state.nextDiscoveryAt = broadcast.firstVerifiedAt
              ? broadcast.firstVerifiedAt + (Math.floor((now() - broadcast.firstVerifiedAt) / POLL_MS) + 1) * POLL_MS
              : now() + checkDelay(state.attempts - 1);
          }
        }
        if (announceFirst) {
          broadcast.phase = "live";
          broadcast = await store.saveBroadcast(broadcast);
          if (!broadcast) return;
          if (liveStates(broadcast).length) await deliver(broadcast, registration);
          broadcast = await store.saveBroadcast(broadcast, { delivery: true });
          if (!broadcast) return;
        }
      }
      broadcast.forceMonitor = false;
      broadcast.lastError = errors[0] || null;
      for (const code of new Set(errors)) await reportError(registration, code, broadcast.id);
      const states = liveStates(broadcast);
      if (!broadcast.firstVerifiedAt && now() >= broadcast.startedAt + DISCOVERY_WINDOW_MS) {
        broadcast.discoveryExpired = true;
        broadcast.phase = "cancelled";
        broadcast.work = false;
        await reportError(registration, "live_detection_timeout", broadcast.id);
      } else if (!broadcast.firstVerifiedAt && !obsAlive(broadcast, now())) {
        broadcast.work = false; // A fresh heartbeat may recover before the discovery deadline.
      } else if (states.length && states.every((state) => state.status === "ended")) {
        broadcast.endedAt ||= now();
        broadcast.phase = "ended";
      } else if (states.length) broadcast.phase = "live";

      const due = [];
      if (!broadcast.firstVerifiedAt && broadcast.work) due.push(broadcast.startedAt + DISCOVERY_WINDOW_MS,
        ...Object.values(broadcast.obs).filter((source) => !source.stopped).map((source) => source.lastSeenAt + HEARTBEAT_TTL_MS));
      for (const state of Object.values(broadcast.platforms)) {
        if (state.suppressed) continue;
        if (!state.stream && !broadcast.endedAt && broadcast.work) {
          const deadline = broadcast.firstVerifiedAt ? broadcast.additionalDeadline : broadcast.startedAt + DISCOVERY_WINDOW_MS;
          if (state.nextDiscoveryAt <= deadline && now() <= deadline) due.push(state.nextDiscoveryAt);
        } else if (state.stream && state.status !== "ended") due.push(state.nextMonitorAt);
        else if (state.nextRecordingAt) due.push(state.nextRecordingAt);
      }
      broadcast.nextCheckAt = due.length ? Math.max(now() + 1, Math.min(...due)) : now() + POLL_MS;
      broadcast = await store.saveBroadcast(broadcast);
      if (!broadcast) return;
      const visible = liveStates(broadcast);
      if (!visible.length && Object.values(broadcast.platforms).every((state) => state.suppressed)) {
        broadcast.phase = "cancelled";
        broadcast.work = false;
      }
      if (visible.length && !broadcast.deleted) await deliver(broadcast, registration);
      // Keep delivery retries durable even when there are no provider jobs left.
      const message = visible.length ? broadcastMessage(registration, broadcast) : null;
      const pendingDelivery = message && !broadcast.deleted && hash(JSON.stringify(message)) !== broadcast.deliveredHash;
      if (!due.length && !pendingDelivery) {
        broadcast.work = false;
        if (!visible.length && broadcast.firstVerifiedAt) broadcast.phase = "cancelled";
      }
      if (pendingDelivery) broadcast.nextCheckAt = Math.min(broadcast.nextCheckAt, now() + POLL_MS);
      await store.saveBroadcast(broadcast, { release: true, delivery: true });
    } catch (error) {
      broadcast.lastError = error.code || "discord_delivery_pending";
      broadcast.nextCheckAt = now() + POLL_MS;
      await store.saveBroadcast(broadcast, { release: true, delivery: true });
      await reportError(registration, broadcast.lastError, broadcast.id);
    }
  }

  async function deliver(broadcast, registration) {
    const message = broadcastMessage(registration, broadcast);
    const fingerprint = hash(JSON.stringify(message));
    if (fingerprint === broadcast.deliveredHash) return;
    if (!(await store.saveBroadcast(broadcast))) return;
    if (!broadcast.messageId) {
      if (broadcast.firstAttemptAt) {
        const recovered = await publisher.findExisting(broadcast);
        if (recovered.messageId) broadcast.messageId = recovered.messageId;
        else if (!recovered.complete) throw Object.assign(new Error("history unavailable"), { code: "discord_history_unavailable" });
        else broadcast.initialMessage = message;
      }
      if (!broadcast.messageId) {
        // Reverify just before a delayed first send. An expired stream must not be newly announced.
        if (now() - broadcast.firstVerifiedAt > 30_000) {
          let anyLive = false;
          for (const state of liveStates(broadcast)) {
            if (state.status === "ended") continue;
            const status = providers.monitor ? await providers.monitor(registration.channels[state.stream.platform], state.stream)
              : { status: "live", stream: (await providers.verify(registration.channels[state.stream.platform], { platform: state.stream.platform, videoId: state.stream.id }, store)).streams[0] };
            if (status.status === "unknown") throw Object.assign(new Error("verification unavailable"), { code: "provider_unavailable" });
            if (status.status === "live" && status.stream) anyLive = true;
          }
          if (!anyLive) { broadcast.deleted = true; return; }
        }
        broadcast.initialMessage ||= message;
        broadcast.firstAttemptAt ||= now();
        if (!(await store.saveBroadcast(broadcast))) return;
        broadcast.messageId = await publisher.send(broadcast, broadcast.initialMessage);
        broadcast.deliveredHash = hash(JSON.stringify(broadcast.initialMessage));
      }
    }
    if (broadcast.deliveredHash !== fingerprint) {
      if (!(await store.saveBroadcast(broadcast, { delivery: true }))) return;
      const result = await publisher.edit(broadcast, message);
      if (result?.deleted) broadcast.deleted = true;
      else broadcast.deliveredHash = fingerprint;
    }
  }

  return { process };
}

module.exports = { createBroadcastWorker, POLL_MS, GRACE_MS, RECORDING_DELAYS };
