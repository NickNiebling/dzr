const { randomUUID } = require("node:crypto");
const { mergeSummaries } = require("./errorSummary");

const LEASE_MS = 5 * 60 * 1000;

// One bounded document, shared by both bot instances during a Render deploy. A delivery is
// frozen while new errors accumulate in pending; acknowledging it must never clear new errors.
function createErrorDigestStore(db) {
  const ref = db.collection("bot_state").doc("error_digest");

  async function read(tx) {
    const snapshot = await tx.get(ref);
    return snapshot.exists ? snapshot.data() : {};
  }

  return {
    async append(summary) {
      if (!summary || summary.total <= 0) return;
      await db.runTransaction(async (tx) => {
        const state = await read(tx);
        state.pending = mergeSummaries(state.pending || null, summary);
        // Replace the complete document: merge:true would retain cleared nested map fields.
        tx.set(ref, state);
      });
    },

    async claim({ day, now, owner, channelId }) {
      return db.runTransaction(async (tx) => {
        const state = await read(tx);
        if (state.delivery) {
          if (state.leaseUntil > now) return null;
          // Retry the same snapshot, even if it belongs to an earlier day.
        } else {
          if (state.lastReportDay === day) return null;
          if (!state.pending || state.pending.total <= 0) {
            state.pending = null;
            state.lastReportDay = day;
            tx.set(ref, state);
            return null;
          }
          state.delivery = {
            id: randomUUID(),
            day,
            channelId,
            summary: state.pending,
          };
          state.pending = null;
        }
        // A corrected destination must also recover an already queued delivery.
        state.delivery.channelId = channelId;
        state.leaseOwner = owner;
        state.leaseUntil = now + LEASE_MS;
        tx.set(ref, state);
        return state.delivery;
      });
    },

    async acknowledge({ id, owner, day }) {
      return db.runTransaction(async (tx) => {
        const state = await read(tx);
        if (state.delivery?.id !== id || state.leaseOwner !== owner) return false;
        state.delivery = null;
        state.leaseOwner = null;
        state.leaseUntil = 0;
        // An old delivery successfully retried today also counts as today's report.
        state.lastReportDay = day;
        tx.set(ref, state);
        return true;
      });
    },

    async release({ id, owner }) {
      return db.runTransaction(async (tx) => {
        const state = await read(tx);
        if (state.delivery?.id !== id || state.leaseOwner !== owner) return false;
        state.leaseOwner = null;
        state.leaseUntil = 0;
        tx.set(ref, state);
        return true;
      });
    },
  };
}

module.exports = { createErrorDigestStore };
