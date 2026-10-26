const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const run = promisify(execFile);
async function withLocalSink(check) {
  const envelopes = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      let body = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'gzip') body = gunzipSync(body);
      envelopes.push(body.toString());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await check(envelopes, {
      cwd: path.resolve(__dirname, '..'), timeout: 15000,
      env: { ...process.env, SENTRY_DSN: `http://public@127.0.0.1:${server.address().port}/1`,
        SENTRY_ENVIRONMENT: 'test', SENTRY_CAPTURE_CONSOLE_ERRORS: '1' },
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
}
test('real bot initialization sends only sanitized console.error events to a local sink', async () => {
  await withLocalSink(async (envelopes, options) => {
    await run(process.execPath, ['-e', `
      const Sentry = require('./services/sentry');
      console.error('PRIVATE_TEST_MARKER', new Error('PRIVATE_TEST_MARKER'));
      console.error('PRIVATE_TEST_MARKER plain string');
      console.warn('PRIVATE_TEST_MARKER warning');
      Sentry.close(5000).then(ok => { process.exitCode = ok ? 0 : 1; });
    `], options);
    const body = envelopes.join('\n');
    assert.ok(!body.includes('PRIVATE_TEST_MARKER'));
    assert.match(body, /Application failure/);
    assert.match(body, /"service":"bot"/);
    assert.match(body, /stacktrace/);
    const events = body.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
      .filter(item => item.event_id && item.exception);
    assert.equal(events.length, 2, 'warn is not an error event; both error forms retain a stack');
  });
});
test('unhandled bot errors are sent and still terminate the process with failure', async () => {
  await withLocalSink(async (envelopes, options) => {
    await assert.rejects(run(process.execPath, ['-e', `
      require('./services/sentry');
      setImmediate(() => { throw new Error('PRIVATE_CRASH_MARKER'); });
    `], options), error => error.code === 1);
    const body = envelopes.join('\n');
    assert.match(body, /Application failure/);
    assert.ok(!body.includes('PRIVATE_CRASH_MARKER'));
  });
});

test('console opt-out and missing DSN keep console errors local', async () => {
  await withLocalSink(async (envelopes, options) => {
    for (const overrides of [{ SENTRY_CAPTURE_CONSOLE_ERRORS: '0' }, { SENTRY_DSN: '' }]) {
      await run(process.execPath, ['-e', `
        const Sentry = require('./services/sentry');
        console.error('local only');
        Sentry.close(2000).then(ok => { process.exitCode = ok ? 0 : 1; });
      `], { ...options, env: { ...options.env, ...overrides } });
    }
    assert.equal(envelopes.length, 0);
  });
});

test('unhandled rejections retain fatal behavior and report sanitized events', async () => {
  await withLocalSink(async (envelopes, options) => {
    await assert.rejects(run(process.execPath, ['-e', `
      require('./services/sentry');
      Promise.reject(new Error('PRIVATE_REJECTION_MARKER'));
    `], options), error => error.code === 1);
    assert.match(envelopes.join('\n'), /Application failure/);
    assert.ok(!envelopes.join('\n').includes('PRIVATE_REJECTION_MARKER'));
  });
});
