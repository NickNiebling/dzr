import { NextResponse } from 'next/server'
import { requireEventEditor } from '@/app/api/admin/_lib/auth'
import { ensureCatalog } from '@/app/lib/seriesCatalog'
import {
  deleteEventSeries,
  listAdminSeries,
  plannedRaces,
  readAdminSeries,
  saveEventSeries,
  seriesSlug,
  type EventSeries,
} from '@/app/lib/eventSeries'
import { SeriesError } from '@/app/lib/seriesSchedule'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed'
  const status = error instanceof SeriesError ? error.status : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET(req: Request) {
  const auth = await requireEventEditor(req)
  if (auth.error) return auth.error
  const slug = seriesSlug(new URL(req.url).searchParams.get('slug') || '')
  try {
    if (slug) {
      const series = await readAdminSeries(slug)
      if (!series) return NextResponse.json({ error: 'Series not found' }, { status: 404 })
      const routes = await ensureCatalog(slug)
      return NextResponse.json({ series, routes, schedule: plannedRaces(series, routes) })
    }
    return NextResponse.json({ series: await listAdminSeries() })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(req: Request) {
  const auth = await requireEventEditor(req)
  if (auth.error) return auth.error
  const slug = seriesSlug(new URL(req.url).searchParams.get('slug') || '')
  try {
    await deleteEventSeries(slug)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: Request) {
  const auth = await requireEventEditor(req)
  if (auth.error) return auth.error
  const body = await req.json().catch(() => ({}))
  const series = (body?.series || {}) as Partial<EventSeries>
  try {
    const saved = await saveEventSeries(series, {
      value: typeof body?.webhook === 'string' ? body.webhook : undefined,
      clear: Boolean(body?.clearWebhook),
    })
    return NextResponse.json({ series: saved })
  } catch (error) {
    return errorResponse(error)
  }
}
