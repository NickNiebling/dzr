// Explicit local test only. Loads .env.local through Next's own env loader.
import nextEnv from '@next/env'
import * as Sentry from '@sentry/nextjs'
import { beforeSend } from '../packages/shared/telemetry/sentryPrivacy.js'
nextEnv.loadEnvConfig(process.cwd())
if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
  console.error('Set NEXT_PUBLIC_SENTRY_DSN in .env.local first (never commit it).')
  process.exitCode = 1
} else {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: 'development',
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, genAI: { inputs: false, outputs: false }, mcp: { inputs: false, outputs: false }, stackFrameVariables: false, frameContextLines: 0, databaseQueryData: false, queues: false },
    tracesSampleRate: 0,
    beforeSend,
    initialScope: { tags: { service: 'website-setup-check' } },
  })
  const id = Sentry.captureException(new Error('Sentry local connection check'))
  const drained = await Sentry.close(5000)
  console.log(`Local test queued: ${id}; queue drained: ${drained}. Confirm receipt in Sentry; this does not prove ingestion.`)
}
