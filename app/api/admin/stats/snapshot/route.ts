import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/admin/_lib/auth'

export const maxDuration = 150

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.error) return auth.error
  const runId = crypto.randomUUID()
  const base = process.env.CONTENT_API_BASE_URL
  const key = process.env.CONTENT_API_KEY
  if (!base || !key) return NextResponse.json({ error: 'Jobs API is not configured.', stage: 'configuration', runId }, { status: 503 })
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/discord/stats/snapshot`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'manual' }),
      signal: AbortSignal.timeout(120000),
      cache: 'no-store',
    })
    const body = await res.json()
    return NextResponse.json(body, { status: res.status })
  } catch (error) {
    console.error('Member snapshot request failed', { runId, error })
    return NextResponse.json({ error: 'Could not confirm snapshot completion. Refresh the status before retrying.', stage: 'jobs-api', runId }, { status: 502 })
  }
}
