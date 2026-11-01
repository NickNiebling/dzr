import { NextResponse } from 'next/server'
import { dictionarySegmentRows, gameDictionary, resolveDictionaryRoute } from '@/app/lib/gameDictionary'
import { measuredProfileSegments, routeElevation, routeLeadinProfile } from '@/packages/shared/sauceProfile'
import { buildRaceProfile, raceDistanceKm, type CustomClimbRange } from '@/packages/shared/routeProfile'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function parseRanges(value: string | null): CustomClimbRange[] {
  if (!value) return []
  try {
    const rows = JSON.parse(value) as unknown
    if (!Array.isArray(rows)) return []
    return rows.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as { name?: unknown; fromKm?: unknown; toKm?: unknown }
      const name = String(row.name || '').trim()
      const fromKm = Number(row.fromKm)
      const toKm = Number(row.toKm)
      if (!name || !Number.isFinite(fromKm) || !Number.isFinite(toKm)) return []
      return [{ name, fromKm, toKm }]
    })
  } catch {
    return []
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  let dictionary
  try {
    dictionary = await gameDictionary()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Zwift game dictionary is unavailable right now.'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const resolved = resolveDictionaryRoute(dictionary, {
    routeId: url.searchParams.get('routeId') || '',
    name: url.searchParams.get('route') || '',
    world: url.searchParams.get('world') || '',
  })
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 404 })
  }

  try {
    const lap = routeElevation(resolved.id)
    if (lap.distance.length < 2) {
      return NextResponse.json({ error: 'No Sauce profile for that route' }, { status: 404 })
    }
    const lead = routeLeadinProfile(resolved.id)
    const sampledLeadKm = lead.distance.length ? lead.distance[lead.distance.length - 1] / 1000 : 0
    const leadInKm = resolved.leadInKm > 0 ? resolved.leadInKm : sampledLeadKm
    const lapKm = lap.distance[lap.distance.length - 1] / 1000
    const raceKm = raceDistanceKm(
      lapKm,
      url.searchParams.get('laps'),
      url.searchParams.get('distance'),
      leadInKm,
    )
    const climbs = (url.searchParams.get('climbs') || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    const segments = measuredProfileSegments(resolved.id, dictionarySegmentRows(dictionary))
    const profile = buildRaceProfile({
      distanceM: lap.distance,
      altitudeM: lap.altitude,
      segments,
      raceKm,
      finishText: url.searchParams.get('finish') || '',
      climbNames: climbs,
      customClimbs: parseRanges(url.searchParams.get('ranges')),
      leadInKm,
    })
    return NextResponse.json({ routeName: resolved.name, world: resolved.world, ...profile })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load the route profile'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
