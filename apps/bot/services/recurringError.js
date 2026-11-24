const ERROR_WINDOW_MS = 60 * 60 * 1000;
const nextErrorAtByKey = new Map();

/** Report a recurring failure at error level once per hour. Null reports immediately. */
function reportRecurringError(key, ...args) {
  if (key === null) {
    console.error(...args);
    return;
  }

  const now = performance.now();
  if ((nextErrorAtByKey.get(key) ?? 0) > now) {
    console.warn(...args);
    return;
  }

  // Deadlines are inserted in time order, so only the expired prefix needs pruning.
  for (const [expiredKey, nextErrorAt] of nextErrorAtByKey) {
    if (nextErrorAt > now) break;
    nextErrorAtByKey.delete(expiredKey);
  }

  nextErrorAtByKey.set(key, now + ERROR_WINDOW_MS);
  console.error(...args);
}

module.exports = { reportRecurringError };
