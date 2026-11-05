const { StreamingError, HEARTBEAT_TTL_MS, tokenOwner, tokenMatches, parseEvent, createToken, hash, announcementMessage } = require("./model");

function createStreamingService({ store, providers, publisher, guildId, channelId, now = Date.now, logger = console }) {
  let running = false;
  let timer;
  let lastFallbackAt = -Infinity;
  const system = { registrationId: `worker_${guildId}`, guildId, discordId: null };

  async function reportError(registration, code, sessionId) {
    try { await store.queueAlert(registration, code, sessionId); }
    catch {
      // If Firestore is unavailable, still try to tell IT; never forward raw exception/request data.
      if (now() - lastFallbackAt < 60_000) return;
      lastFallbackAt = now();
      try { await publisher.reportError({ id: `fallback_${hash(`${registration.registrationId}:${code}`)}`,
        discordId: registration.discordId, code, createdAt: now() }); }
      catch { logger.warn("Streaming IT reporting unavailable."); }
    }
  }

  async function enroll(discordId, discordName, inputs) {
    const channels = {};
    for (const platform of ["youtube", "twitch"]) {
      if (String(inputs[platform] || "").trim()) channels[platform] = await providers.resolveChannel(platform, inputs[platform]);
    }
    if (!Object.keys(channels).length) throw new StreamingError("missing_channels", "Angiv mindst én YouTube- eller Twitch-kanal.");
    const token = createToken(discordId);
    const registration = await store.register({ guildId, discordId, discordName, channels, tokenHash: hash(token) });
    return { registration, token };
  }

  async function callback(token, body, testOnly = false) {
    const isTest = testOnly || body?.event === "test";
    const discordId = tokenOwner(token);
    if (!discordId) throw new StreamingError("invalid_key", "DZR-nøglen er ikke gyldig.", 401);
    let registration;
    try { registration = await store.getRegistration(guildId, discordId); }
    catch {
      if (!isTest) await reportError(system, "callback_store_unavailable");
      throw new StreamingError("temporarily_unavailable", "DZR Streaming er midlertidigt utilgængelig.", 503);
    }
    if (!registration || !tokenMatches(token, registration.tokenHash)) throw new StreamingError("invalid_key", "DZR-nøglen er ikke gyldig.", 401);
    try {
      if (testOnly && body?.event !== "test") throw new StreamingError("invalid_event", "Test-endpointet accepterer kun forbindelsestests.");
      const event = parseEvent(body, now());
      if (!registration.channels[event.platform]) throw new StreamingError("channel_not_registered", "Denne platform er ikke tilmeldt.", 403);
      return await store.acceptEvent(registration, event);
    } catch (error) {
      if (isTest) {
        if (error instanceof StreamingError && error.code !== "invalid_key") await store.acceptEvent(registration, { ...body, event: "test" }, error.code);
      } else await reportError(registration, error instanceof StreamingError ? error.code : "callback_failed");
      throw error;
    }
  }

  async function check(id) {
    const claimed = await store.claimSession(id);
    if (!claimed) return;
    const { session, registration, expired } = claimed;
    if (expired) { await reportError(registration, "live_detection_timeout", session.sessionId); return; }
    try {
      const result = await providers.verify(registration.channels[session.platform], session, store);
      const finished = await store.finishCheck(session, result, channelId);
      if (finished?.expired) await reportError(registration, "live_detection_timeout", session.sessionId);
      else if (result.error) await reportError(registration, result.error, session.sessionId);
    } catch (error) {
      const code = error instanceof StreamingError ? error.code : "verification_failed";
      logger.warn(`Streaming verification: ${code}`); // Never log request objects, headers, keys or provider URLs.
      let finished;
      try { finished = await store.finishCheck(session, { error: code }, channelId); }
      finally { await reportError(registration, finished?.expired ? "live_detection_timeout" : code, session.sessionId); }
    }
  }

  async function publish(id) {
    const claimed = await store.claimNotice(id);
    if (!claimed) return;
    const { notice, registration, session } = claimed;
    try {
      if (notice.firstAttemptAt) {
        const recovered = await publisher.findExisting(notice);
        if (recovered.messageId) {
          await store.finishNotice(notice, { status: "sent", messageId: recovered.messageId, sentAt: now() });
          return;
        }
        // If history is inaccessible/incomplete, fail closed rather than risk a duplicate.
        if (!recovered.complete) {
          await store.finishNotice(notice, { status: "pending", lastError: "discord_history_unavailable" });
          await reportError(registration, "discord_history_unavailable", session.sessionId);
          return;
        }
      }
      // Reconfirm before delayed delivery/recovery. A queued notice must not announce an ended stream.
      if (now() - notice.verifiedAt > 30_000) {
        const result = await providers.verify(registration.channels[session.platform], {
          ...session, ...(session.platform === "youtube" ? { videoId: notice.stream.id } : {}),
        }, store);
        if (!result.streams.some((stream) => stream.id === notice.stream.id)) {
          await store.finishNotice(notice, { status: "cancelled", lastError: "stream_no_longer_live" });
          return;
        }
      }
      if (!(await store.beginSend(notice))) return;
      const messageId = await publisher.send(notice, announcementMessage(registration, notice.stream));
      await store.finishNotice(notice, { status: "sent", messageId, sentAt: now(), lastError: null });
    } catch {
      logger.warn("Streaming publication deferred; will reconcile Discord history before retrying.");
      try { await store.finishNotice(notice, { status: "pending", lastError: "discord_delivery_pending" }); }
      finally { await reportError(registration, "discord_delivery_pending", session.sessionId); }
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const sessions = (await store.listSessions()).filter((session) => session.guildId === guildId
        && !(session.nextCheckAt > now()) && !(session.leaseUntil > now())
        && (!session.discoveredAt || session.lastSeenAt <= now() - HEARTBEAT_TTL_MS));
      // Bounded concurrency keeps one slow provider from delaying every other streamer.
      for (let i = 0; i < sessions.length; i += 4) await Promise.all(sessions.slice(i, i + 4).map((session) => check(session.id)));
      for (const notice of await store.listNotices()) if (notice.channelId === channelId) await publish(notice.id);
      for (const item of await store.listAlerts()) {
        if (item.guildId !== guildId) continue;
        const alert = await store.claimAlert(item.id);
        if (!alert) continue;
        let sent = false;
        try { await publisher.reportError(alert); sent = true; }
        catch { logger.warn("Streaming IT report deferred."); }
        await store.finishAlert(alert, sent);
      }
    } catch {
      logger.warn("Streaming worker temporarily unavailable; durable work will be retried.");
      await reportError(system, "worker_unavailable");
    } finally { running = false; }
  }

  return { enroll, callback, tick,
    getRegistration: (discordId) => store.getRegistration(guildId, discordId),
    remove: (discordId) => store.remove(guildId, discordId),
    overview: () => store.listRegistrations(guildId),
    async issues() { return [...await store.listIssues(guildId), ...(await store.listNotices()).filter((item) => item.channelId === channelId && item.lastError)]; },
    start() { if (!timer) { timer = setInterval(tick, 5000); timer.unref(); void tick(); } },
    stop() { clearInterval(timer); timer = null; } };
}

module.exports = { createStreamingService };
