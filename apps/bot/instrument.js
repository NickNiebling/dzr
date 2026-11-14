// Load before Discord, Express and other application modules.
require("dotenv").config();
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
  dataCollection: {
    userInfo: false, cookies: false, httpHeaders: false, httpBodies: [],
    urlQueryParams: false, stackFrameVariables: false, databaseQueryData: false,
    genAI: { inputs: false, outputs: false }, queues: false,
  },
  maxBreadcrumbs: 0,
  // Console arguments can contain raw OAuth/payment responses outside dataCollection.
  beforeSend(event) {
    if (event.logger === "console" && event.extra) delete event.extra.arguments;
    return event;
  },
  integrations: [
    Sentry.captureConsoleIntegration({ levels: ["error"] }),
    // Preserve Node's fatal rejection behavior after Sentry flushes the error.
    Sentry.onUnhandledRejectionIntegration({ mode: "strict" }),
  ],
  initialScope: { tags: { service: "bot" } },
});

module.exports = Sentry;
