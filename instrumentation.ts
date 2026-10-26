export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.server.config')
  }
}

export { captureRequestError as onRequestError } from '@sentry/nextjs'
