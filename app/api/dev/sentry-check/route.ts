// Deliberately unavailable in production, even if SENTRY_LOCAL_TEST is set there.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  if (process.env.NODE_ENV !== 'development' || process.env.SENTRY_LOCAL_TEST !== '1') {
    return new Response(null, { status: 404 })
  }
  throw new Error('Sentry local Next request check')
}
