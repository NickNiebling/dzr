import * as Sentry from '@sentry/nextjs'
import constants from './packages/shared/constants.json'

const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  ?? (environment === 'production' ? constants.sentry.dsn : undefined)

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment,
  dataCollection: {
    userInfo: false, cookies: false, httpHeaders: false, httpBodies: [],
    urlQueryParams: false, stackFrameVariables: false, databaseQueryData: false,
    genAI: { inputs: false, outputs: false }, queues: false,
  },
  maxBreadcrumbs: 0,
  // Console arguments can contain raw OAuth/payment responses outside dataCollection.
  beforeSend(event) {
    if (event.logger === 'console' && event.extra) delete event.extra.arguments
    return event
  },
  integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
  initialScope: { tags: { service: 'website-browser' } },
})
