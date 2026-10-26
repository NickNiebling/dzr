// Load before Discord, HTTP clients and handlers. dotenv reads apps/bot/.env when
// running from the bot root, matching config/config.js and the Render rootDir.
require('dotenv').config();
const Sentry = require('@sentry/node');
const { beforeSend } = require('./sentryPrivacy');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.SENTRY_ENVIRONMENT || 'development',
  release: process.env.RENDER_GIT_COMMIT || process.env.SENTRY_RELEASE,
  dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, genAI: { inputs: false, outputs: false }, mcp: { inputs: false, outputs: false }, stackFrameVariables: false, frameContextLines: 0, databaseQueryData: false, queues: false },
  tracesSampleRate: 0,
  beforeSend,
  // Keep Node's fatal behavior for unhandled rejections; do not silently continue.
  integrations: [Sentry.onUnhandledRejectionIntegration({ mode: 'strict' })],
  initialScope: { tags: { service: 'bot' } },
});

module.exports = Sentry;
