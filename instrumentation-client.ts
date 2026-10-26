import * as Sentry from '@sentry/nextjs'
import { beforeSend } from './packages/shared/telemetry/sentryPrivacy'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || 'development',
  dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, genAI: { inputs: false, outputs: false }, mcp: { inputs: false, outputs: false }, stackFrameVariables: false, frameContextLines: 0, databaseQueryData: false, queues: false },
  tracesSampleRate: 0,
  beforeSend,
  initialScope: { tags: { service: 'website-browser' } },
})
