const test = require('node:test');
const assert = require('node:assert/strict');
const { beforeSend } = require('./sentryPrivacy');

test('sends diagnostic locations without secrets, message bodies or member data', () => {
  const secret = 'private-payment-token';
  const event = {
    event_id: 'test', level: 'error', environment: 'development', release: 'abc',
    tags: { service: 'website-server', discordId: secret },
    user: { email: secret }, request: { headers: { Authorization: secret }, data: secret },
    extra: { body: secret }, contexts: { trace: { data: secret } },
    breadcrumbs: [{ message: secret }], message: secret,
    exception: { values: [{ type: 'TypeError', value: secret,
      stacktrace: { frames: [{ filename: `https://example.test/app.js?token=${secret}`,
        function: 'checkout', lineno: 42, colno: 3, in_app: true,
        vars: { token: secret }, pre_context: [secret], context_line: secret }] } }] },
  };
  const safe = beforeSend(event);
  assert.ok(!JSON.stringify(safe).includes(secret));
  assert.equal(safe.exception.values[0].type, 'TypeError');
  assert.equal(safe.exception.values[0].stacktrace.frames[0].lineno, 42);
  assert.equal(safe.tags.service, 'website-server');
  assert.equal(event.exception.values[0].value, secret, 'does not mutate hosting diagnostics');
});

test('console events and nonstandard exception types cannot carry raw text', () => {
  assert.equal(beforeSend({ message: 'secret', extra: { arguments: ['secret'] } }).message,
    'Application error log; details remain in platform logs');
  const safe = beforeSend({ exception: { values: [{ type: 'secret with spaces', value: 'secret' }] } });
  assert.equal(safe.exception.values[0].type, 'Error');
});
