const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createErrorLog, sourceLocation } = require("./errorLog");
const { MAX_SOURCES, mergeSummaries, formatErrorSummary } = require("./errorSummary");

const at = new Date("2026-10-25T07:00:00Z");
const entry = (source, count = 1) => ({ total: count, firstAt: at.toISOString(), lastAt: at.toISOString(), groups: [{ source, count }], omitted: 0 });

test("repeated locations aggregate, with bounded distinct sources and an honest overflow total", () => {
  let summary = null;
  for (let i = 0; i < MAX_SOURCES + 100; i++) summary = mergeSummaries(summary, entry(`services/f${i}.js:1`));
  summary = mergeSummaries(summary, entry("services/f0.js:1", 3));
  assert.equal(summary.total, MAX_SOURCES + 103);
  assert.equal(summary.groups.length, MAX_SOURCES);
  assert.equal(summary.groups[0].count, 4);
  assert.equal(summary.omitted, 100);
  assert.equal(summary.groups.reduce((sum, row) => sum + row.count, summary.omitted), summary.total);
});

test("source capture uses only a local code location, skipping dependency and external frames", () => {
  const bot = path.resolve(__dirname, "..");
  const stack = `Error: secret\n    at method (/elsewhere/private.js:1:2)\n    at ${bot}/node_modules/test/index.js:2:3\n    at Object.handle (${bot}/handlers/memberHandler.js:79:13)`;
  assert.equal(sourceLocation(stack), "handlers/memberHandler.js:79");
  assert.equal(sourceLocation(`Error\n    at ${bot}/bot.js:51:12`), "bot.js:51");
  assert.equal(sourceLocation("Error: secret\n    at <anonymous>"), "unknown");
});

test("a failed flush retains counts and merges errors arriving while the write is in flight", async () => {
  let reject;
  let fail = true;
  const writes = [];
  const diagnostics = [];
  const log = createErrorLog({
    write: async summary => {
      if (fail) await new Promise((resolve, rejectWrite) => { reject = rejectWrite; });
      writes.push(summary);
    },
    diagnostic: (...args) => diagnostics.push(args),
  });
  log.record("services/a.js:1", at);
  const flushing = log.flush();
  assert.equal(log.flush(), flushing);
  await Promise.resolve();
  log.record("services/b.js:2", new Date(at.getTime() + 1000));
  reject(new Error("offline"));
  await assert.rejects(flushing, /offline/);
  fail = false;
  await log.flush();
  await log.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].total, 2);
  assert.equal(writes[0].firstAt, at.toISOString());
  assert.equal(writes[0].lastAt, new Date(at.getTime() + 1000).toISOString());
  assert.equal(diagnostics.length, 1);
});

test("new errors during a successful flush stay for the next write", async () => {
  let finish;
  const writes = [];
  const log = createErrorLog({ write: async summary => {
    writes.push(summary);
    if (writes.length === 1) await new Promise(resolve => { finish = resolve; });
  } });
  log.record("services/a.js:1", at);
  const flushing = log.flush();
  await Promise.resolve();
  log.record("services/a.js:1", at);
  finish();
  await flushing;
  await log.flush();
  assert.deepEqual(writes.map(summary => summary.total), [1, 1]);
});

test("Discord summary stays within the message limit and accounts for every omitted entry", () => {
  let summary = null;
  for (let i = 0; i < 100; i++) summary = mergeSummaries(summary, entry(`services/${"long".repeat(20)}${i}.js:123`, i + 1));
  const content = formatErrorSummary(summary);
  assert.ok(content.length <= 2000);
  assert.match(content, /5050 fejllogninger/);
  assert.match(content, /øvrige fejllogninger/);
  assert.match(content, /Render-loggen/);
});

test("bootstrap bridge is idempotent, preserves stderr arguments and never stores their data", () => {
  // Separate process so installing the bridge cannot change the test runner's own console.
  const script = `
    const assert = require('node:assert/strict');
    const output = [];
    console.error = (...args) => output.push(args);
    const log = require('./errorLog');
    const saved = [];
    require.cache[require.resolve('./errorDigest')] = { exports: { getStore: () => ({ append: async summary => saved.push(summary) }) } };
    log.installErrorLog();
    const wrapped = console.error;
    log.installErrorLog();
    assert.equal(console.error, wrapped);
    const privateData = { token: 'private-token', message: 'private-coach-message' };
    console.error('private-user-name', privateData);
    console.warn = () => {};
    console.warn('ignored warning');
    log.flushErrorLog().then(() => {
      assert.deepEqual(output, [['private-user-name', privateData]]);
      assert.equal(saved[0].total, 1);
      assert.doesNotMatch(JSON.stringify(saved), /private/);
    }).catch(err => { process.stderr.write(String(err)); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ["-e", script], { cwd: __dirname, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
