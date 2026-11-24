const test = require("node:test");
const assert = require("node:assert/strict");
const { reportRecurringError } = require("./recurringError");

const DAY_MS = 24 * 60 * 60 * 1000;

test("recurring errors warn until 24 hours after the last error", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const calls = [];
  t.mock.method(console, "error", (...args) => calls.push({ level: "error", args }));
  t.mock.method(console, "warn", (...args) => calls.push({ level: "warn", args }));
  const failure = new Error("Discord unavailable");
  const context = { channelId: "123" };
  const args = ["Could not send scheduled message:", failure, context];

  reportRecurringError("scheduled-send:123", ...args);
  now = DAY_MS - 1;
  reportRecurringError("scheduled-send:123", ...args);
  now = DAY_MS;
  reportRecurringError("scheduled-send:123", ...args);
  now += 1;
  reportRecurringError("scheduled-send:123", ...args);

  assert.deepEqual(calls.map((call) => call.level), ["error", "warn", "error", "warn"]);
  for (const call of calls) {
    assert.equal(call.args.length, args.length);
    assert.equal(call.args[0], args[0]);
    assert.equal(call.args[1], failure);
    assert.equal(call.args[2], context);
  }
});

test("each failure key has its own error window", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const error = t.mock.method(console, "error", () => {});
  const warn = t.mock.method(console, "warn", () => {});

  reportRecurringError("due-lookup", "Due lookup failed");
  now += 1;
  reportRecurringError("mark-sent:123", "Mark as sent failed");
  now = DAY_MS;
  reportRecurringError("due-lookup", "Due lookup failed again");
  reportRecurringError("mark-sent:123", "Mark as sent failed again");

  assert.deepEqual(error.mock.calls.map((call) => call.arguments[0]), [
    "Due lookup failed", "Mark as sent failed", "Due lookup failed again",
  ]);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments[0]), ["Mark as sent failed again"]);
});

test("manual failures always report at error severity without changing the background window", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const error = t.mock.method(console, "error", () => {});
  const warn = t.mock.method(console, "warn", () => {});

  reportRecurringError("kms-update", "Background update failed");
  now = DAY_MS - 1;
  reportRecurringError(null, "Manual update failed");
  reportRecurringError(null, "Manual update failed again");
  reportRecurringError("kms-update", "Background update still failing");
  now = DAY_MS;
  reportRecurringError("kms-update", "Background update failed again");

  assert.deepEqual(error.mock.calls.map((call) => call.arguments[0]), [
    "Background update failed", "Manual update failed", "Manual update failed again", "Background update failed again",
  ]);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments[0]), ["Background update still failing"]);
});
