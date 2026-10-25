const { randomUUID, createHash } = require("node:crypto");
const { calendarDateInTz, localClock } = require("./coachFollowUpSchedule");
const { formatErrorSummary } = require("./errorSummary");
const { createErrorDigestStore } = require("./errorDigestStore");
const { flushErrorLog, diagnostic } = require("./errorLog");

let store;
function getStore() {
  if (!store) store = createErrorDigestStore(require("./firebase").db);
  return store;
}

function createErrorDigest({ getStore, flush, channelId, reportError = diagnostic, clock = () => new Date() }) {
  const owner = randomUUID();
  let running = false;
  return async function maybeSendErrorDigest(client) {
    if (running) return;
    running = true;
    let delivery;
    try {
      // Flush on every tick, including before the reporting hour and when delivery is disabled.
      await flush();
      // A slow flush must not consume the delivery lease before it has even been claimed.
      const now = clock();
      if (!channelId || localClock(now).hour < 8) return;
      delivery = await getStore().claim({ day: calendarDateInTz(now), now: now.getTime(), owner, channelId });
      if (!delivery) return;
      const channel = await client.channels.fetch(delivery.channelId);
      if (!channel?.isSendable()) throw new Error("Error digest channel is missing or not sendable");
      await channel.send({
        content: formatErrorSummary(delivery.summary),
        allowedMentions: { parse: [] },
        // Discord only deduplicates recent nonces. This reduces duplicates after an ambiguous
        // send; it cannot make Discord + Firestore an exactly-once transaction.
        nonce: createHash("sha256").update(delivery.id).digest("hex").slice(0, 24),
        enforceNonce: true,
      });
      // Use the actual completion date if a send crosses local midnight.
      await getStore().acknowledge({ id: delivery.id, owner, day: calendarDateInTz(clock()) });
    } catch (error) {
      reportError("[error-digest] Daily summary failed; it will be retried:", error);
      if (delivery) {
        await getStore().release({ id: delivery.id, owner }).catch((releaseError) => {
          reportError("[error-digest] Could not release delivery lease:", releaseError);
        });
      }
    } finally {
      running = false;
    }
  };
}

let run;
function maybeSendErrorDigest(client) {
  if (!run) run = createErrorDigest({ getStore, flush: flushErrorLog, channelId: require("../config/config").errorDigest.channelId });
  return run(client);
}

module.exports = { createErrorDigest, getStore, maybeSendErrorDigest };
