const path = require("node:path");
const { mergeSummaries } = require("./errorSummary");

const BOT_ROOT = path.resolve(__dirname, "..");
// Keep diagnostics out of the collector itself, even after console.error is wrapped.
const originalError = console.error.bind(console);
let installed = false;

function sourceLocation(stack) {
  for (const line of String(stack).split("\n").slice(1)) {
    const match = line.match(/(?:\(|at )(\/[^()]+\.js):(\d+):\d+\)?$/);
    if (!match) continue;
    const relative = path.relative(BOT_ROOT, match[1]);
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative.includes("node_modules")) continue;
    // Only repository path characters; never expose function names or console arguments.
    if (!/^[\w/.-]+\.js$/.test(relative)) continue;
    return `${relative}:${match[2]}`;
  }
  return "unknown";
}

function createErrorLog({ write, diagnostic = originalError }) {
  let pending = null;
  let flushing = null;
  return {
    record(source, now = new Date()) {
      const at = now.toISOString();
      pending = mergeSummaries(pending, { total: 1, firstAt: at, lastAt: at, groups: [{ source, count: 1 }], omitted: 0 });
    },
    flush() {
      if (flushing) return flushing;
      if (!pending) return Promise.resolve();
      const snapshot = pending;
      pending = null;
      flushing = Promise.resolve().then(() => write(snapshot)).catch((error) => {
        pending = mergeSummaries(snapshot, pending);
        diagnostic("[error-digest] Could not persist error counts:", error);
        throw error;
      }).finally(() => { flushing = null; });
      return flushing;
    },
  };
}

const errorLog = createErrorLog({
  write: (summary) => require("./errorDigest").getStore().append(summary),
});

function installErrorLog() {
  if (installed) return;
  installed = true;
  console.error = function capturedError(...args) {
    originalError(...args);
    try {
      const trace = {};
      Error.captureStackTrace(trace, capturedError);
      errorLog.record(sourceLocation(trace.stack));
    } catch (error) {
      originalError("[error-digest] Could not capture error location:", error);
    }
  };
}

module.exports = { createErrorLog, sourceLocation, installErrorLog, flushErrorLog: () => errorLog.flush(), diagnostic: originalError };
