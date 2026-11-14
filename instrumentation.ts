import * as Sentry from '@sentry/nextjs'

export function register() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
    enabled: Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN),
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
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
    initialScope: { tags: { service: 'website' } },
  })
}

export const onRequestError = Sentry.captureRequestError
