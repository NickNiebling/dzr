import { admin, adminDb } from '@/app/utils/firebaseAdminConfig'
import { AfterPartyRacesData } from '@/app/dzr-after-party/AfterPartyRaces'
import { ZwiftyFiftyRacesData } from '@/app/the-zwifty-fifty/ZwiftyFiftyRaces'
import { getSheetData } from '@/services/google-sheets.action'
import { findZwiftRoute } from '@/app/lib/zwiftRouteLookup'
import { catalogRouteByName, ensureCatalog } from '@/app/lib/seriesCatalog'
import { loadUpcomingDzrEvents } from '@/app/lib/zwiftPublicEvents'
import {
  courseLength,
  displayDate,
  listSeriesDates,
  parseIsoDate,
  parseSheetDate,
  routeForDate,
} from '@/packages/shared/seriesRotation'
import type { ZwiftEventSummary } from '@/packages/shared/zwiftEvents'

export type SeriesId = 'after-party' | 'zwifty-fifty'

export type ResultsFix = { at: string; updated: number; skipped: number }

type PublishedEvent = {
  id: string
  route: string
  resultsFix: ResultsFix | null
  primesFix: ResultsFix | null
  publishedAt: string | null
}

type StoredSchedule = {
  anchorDate: string
  anchorIndex: number
  overrides: Record<string, string>
  events: Record<string, PublishedEvent>
}

export type SeriesDateView = {
  date: string
  label: string
  route: string
  overridden: boolean
  eventId: string
  publishedRoute: string
  feedEventId: number | null
}

export type SeriesView = {
  id: SeriesId
  name: string
  routes: string[]
  dates: SeriesDateView[]
  error: string
  feedUnavailable: boolean
  primeRoutes: string[]
  automation?: string[]
}

export class SeriesError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

const COLLECTION = 'series_schedules'
const DATE_COUNT = 6

const SERIES = {
  'after-party': {
    id: 'after-party' as const,
    name: 'DZR After Party',
    discordHeader: 'DZR After Party',
    routes: AfterPartyRacesData.map((race) => race.route),
    laps: (route: string) => AfterPartyRacesData.find((race) => race.route === route)?.laps || '',
    km: (route: string) => AfterPartyRacesData.find((race) => race.route === route)?.distance || '',
    match: (name: string) => /after party/i.test(name),
    sheetRows: (data: { APSdata?: any[][] | null; ZFdata?: any[][] | null }) => data.APSdata,
  },
  'zwifty-fifty': {
    id: 'zwifty-fifty' as const,
    name: 'The Zwifty Fifty',
    discordHeader: 'The Zwifty Fifty',
    routes: ZwiftyFiftyRacesData.map((race) => race.route),
    laps: (route: string) => ZwiftyFiftyRacesData.find((race) => race.route === route)?.laps || '',
    km: (route: string) => ZwiftyFiftyRacesData.find((race) => race.route === route)?.length || '',
    match: (name: string) => /zwifty fifty/i.test(name),
    sheetRows: (data: { APSdata?: any[][] | null; ZFdata?: any[][] | null }) => data.ZFdata,
  },
}

export function parseSeriesId(value: unknown): SeriesId | null {
  if (value === 'after-party' || value === 'zwifty-fifty') return value
  return null
}

export function seriesIdFromDiscord(header: string | null): SeriesId | null {
  if (header === 'DZR After Party') return 'after-party'
  if (header === 'The Zwifty Fifty') return 'zwifty-fifty'
  return null
}

export function seriesDiscordHeader(seriesId: SeriesId) {
  return SERIES[seriesId].discordHeader
}

function refFor(seriesId: SeriesId) {
  return adminDb.collection(COLLECTION).doc(seriesId)
}

function asMap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function asStored(data: Record<string, any> | undefined): StoredSchedule | null {
  if (!data || !parseIsoDate(data.anchorDate)) return null
  const overrides: Record<string, string> = {}
  for (const [date, route] of Object.entries(asMap(data.overrides))) {
    if (parseIsoDate(date) && route) overrides[date] = String(route)
  }
  const events: Record<string, PublishedEvent> = {}
  for (const [date, value] of Object.entries(asMap(data.events))) {
    if (!parseIsoDate(date) || !value || typeof value !== 'object') continue
    const row = value as { id?: unknown; route?: unknown }
    const id = String(row.id || '').trim()
    const route = String(row.route || '').trim()
    if (id && route) {
      const publishedAt = String((value as { publishedAt?: unknown }).publishedAt || '').trim()
      events[date] = {
        id,
        route,
        resultsFix: asResultsFix((value as { resultsFix?: unknown }).resultsFix),
        primesFix: asResultsFix((value as { primesFix?: unknown }).primesFix),
        publishedAt: publishedAt || null,
      }
    }
  }
  return {
    anchorDate: String(data.anchorDate),
    anchorIndex: Number.isFinite(Number(data.anchorIndex)) ? Number(data.anchorIndex) : 0,
    overrides,
    events,
  }
}

async function readStored(seriesId: SeriesId) {
  const snap = await refFor(seriesId).get()
  if (!snap.exists) return null
  return asStored(snap.data())
}

function matchRouteName(names: string[], route: string) {
  const found = names.find((name) => name.toLowerCase() === route.trim().toLowerCase())
  return found || ''
}

async function routeNames(seriesId: SeriesId) {
  const catalog = await ensureCatalog(seriesId)
  return catalog.length ? catalog.map((route) => route.route) : SERIES[seriesId].routes
}

async function seedFromSheet(seriesId: SeriesId): Promise<StoredSchedule> {
  const spec = SERIES[seriesId]
  const data = await getSheetData()
  const rows = (spec.sheetRows(data) || []).slice(1)
  for (const row of [...rows].reverse()) {
    const raceID = String(row?.[2] || '').trim()
    const route = String(row?.[1] || '').trim()
    const date = parseSheetDate(row?.[0])
    if (!raceID || !route || !date) continue
    const names = await routeNames(seriesId)
    const index = names.findIndex((name) => name.toLowerCase() === route.toLowerCase())
    const canonical = index >= 0 ? names[index] : route
    return {
      anchorDate: date,
      anchorIndex: index >= 0 ? index : 0,
      overrides: index >= 0 ? {} : { [date]: route },
      events: { [date]: { id: raceID, route: canonical, resultsFix: null, primesFix: null, publishedAt: null } },
    }
  }
  throw new SeriesError(`No published ${spec.name} row to start the rotation`, 500)
}

export async function ensureSeries(seriesId: SeriesId): Promise<StoredSchedule> {
  const existing = await readStored(seriesId)
  if (existing) return existing
  const seeded = await seedFromSheet(seriesId)
  const ref = refFor(seriesId)
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) tx.set(ref, seeded)
  })
  return (await readStored(seriesId)) || seeded
}

function plannedRoute(names: string[], stored: StoredSchedule, date: string) {
  return routeForDate(names, stored.anchorDate, stored.anchorIndex, stored.overrides, date)
}

export async function plannedSeriesRoute(seriesId: SeriesId, date: string) {
  const iso = parseIsoDate(date)
  if (!iso) throw new SeriesError('Date must be YYYY-MM-DD')
  const stored = await ensureSeries(seriesId)
  return plannedRoute(await routeNames(seriesId), stored, iso)
}

function naturalRoute(names: string[], stored: StoredSchedule, date: string) {
  return routeForDate(names, stored.anchorDate, stored.anchorIndex, {}, date)
}

export type PublishedRace = { date: string; label: string; route: string; raceID: string }

export function latestPublished(seriesId: SeriesId, stored: StoredSchedule): PublishedRace | null {
  const dates = Object.keys(stored.events).sort()
  const date = dates[dates.length - 1]
  if (!date) return null
  const event = stored.events[date]
  return { date, label: displayDate(date), route: event.route, raceID: event.id }
}

function asResultsFix(value: unknown): ResultsFix | null {
  if (!value || typeof value !== 'object') return null
  const row = value as { at?: unknown; updated?: unknown; skipped?: unknown }
  const at = String(row.at || '').trim()
  if (!at) return null
  return {
    at,
    updated: Number.isFinite(Number(row.updated)) ? Number(row.updated) : 0,
    skipped: Number.isFinite(Number(row.skipped)) ? Number(row.skipped) : 0,
  }
}

export type SavedEvent = {
  date: string
  label: string
  route: string
  eventId: string
  resultsFix: ResultsFix | null
  primesFix: ResultsFix | null
}

export async function listSavedEvents(seriesId: SeriesId): Promise<SavedEvent[]> {
  const stored = await ensureSeries(seriesId)
  return Object.entries(stored.events)
    .map(([date, event]) => ({
      date,
      label: displayDate(date),
      route: event.route,
      eventId: event.id,
      resultsFix: event.resultsFix,
      primesFix: event.primesFix,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export async function publishedRaces(seriesId: SeriesId): Promise<PublishedRace[]> {
  const stored = await ensureSeries(seriesId)
  const latest = latestPublished(seriesId, stored)
  return latest ? [latest] : []
}

function feedEventId(events: ZwiftEventSummary[] | null, seriesId: SeriesId, date: string) {
  if (!events) return null
  const hits = events.filter((event) => SERIES[seriesId].match(event.name) && event.eventDate === date)
  return hits.length === 1 ? hits[0].id : null
}

function toView(
  seriesId: SeriesId,
  stored: StoredSchedule,
  events: ZwiftEventSummary[] | null,
  names: string[],
  primeRoutes: string[],
  error = ''
): SeriesView {
  const dates = listSeriesDates(stored.anchorDate, Object.keys(stored.events), DATE_COUNT).map((date) => {
    const published = stored.events[date]
    return {
      date,
      label: displayDate(date),
      route: plannedRoute(names, stored, date),
      overridden: Boolean(stored.overrides[date]),
      eventId: published?.id || '',
      publishedRoute: published?.route || '',
      feedEventId: feedEventId(events, seriesId, date),
    }
  })
  return {
    id: seriesId,
    name: SERIES[seriesId].name,
    routes: names,
    dates,
    error,
    feedUnavailable: events == null,
    primeRoutes,
  }
}

export async function listSeriesViews(): Promise<SeriesView[]> {
  let events: ZwiftEventSummary[] | null = null
  let feedUnavailable = false
  try {
    events = await loadUpcomingDzrEvents()
  } catch {
    feedUnavailable = true
  }
  const ids: SeriesId[] = ['after-party', 'zwifty-fifty']
  return Promise.all(
    ids.map(async (seriesId) => {
      try {
        const stored = await ensureSeries(seriesId)
        const catalog = await ensureCatalog(seriesId)
        const primeRoutes = catalog
          .filter((route) => route.sprints.some((sprint) => sprint.trim()) || route.finishPoints.some((points) => points.trim()))
          .map((route) => route.route)
        return toView(seriesId, stored, feedUnavailable ? null : events, await routeNames(seriesId), primeRoutes)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not load this series'
        return {
          id: seriesId,
          name: SERIES[seriesId].name,
          routes: SERIES[seriesId].routes,
          dates: [],
          error: message,
          feedUnavailable,
          primeRoutes: [],
        }
      }
    })
  )
}

export async function setSeriesOverride(seriesId: SeriesId, date: string, route: string) {
  const iso = parseIsoDate(date)
  if (!iso) throw new SeriesError('Date must be YYYY-MM-DD')
  const names = await routeNames(seriesId)
  const canonical = matchRouteName(names, route)
  if (!canonical) throw new SeriesError('Route is not in this series')
  const stored = await ensureSeries(seriesId)
  const field = `overrides.${iso}`
  if (canonical === naturalRoute(names, stored, iso)) {
    await refFor(seriesId).update({ [field]: admin.firestore.FieldValue.delete() })
  } else {
    await refFor(seriesId).update({ [field]: canonical })
  }
  return listSeriesViews()
}

async function resolveRouteId(routeName: string) {
  try {
    const hit = await findZwiftRoute(routeName)
    return hit.routeId
  } catch (error) {
    throw new SeriesError(error instanceof Error ? error.message : 'Route search failed')
  }
}

export async function courseForRoute(seriesId: SeriesId, routeName: string, chosenRouteId?: number) {
  const entry = await catalogRouteByName(seriesId, routeName)
  const route = entry?.route || matchRouteName(await routeNames(seriesId), routeName)
  if (!route || !entry) throw new SeriesError('Route is not in this series')
  const length = courseLength(entry.laps, entry.distance)
  if (!length) throw new SeriesError(`${route} has no laps or distance`)
  const routeId =
    chosenRouteId && chosenRouteId > 0
      ? chosenRouteId
      : entry.zwiftRouteId || (await resolveRouteId(route))
  if ('laps' in length) return { route, routeId, laps: length.laps }
  return { route, routeId, distanceMeters: length.distanceMeters }
}

export async function savePublishedEvent(seriesId: SeriesId, date: string, eventId: string, route: string) {
  const iso = parseIsoDate(date)
  if (!iso) throw new SeriesError('Date must be YYYY-MM-DD')
  const stored = await ensureSeries(seriesId)
  const existing = stored.events[iso]
  await refFor(seriesId).update({
    [`events.${iso}`]: {
      id: String(eventId),
      route,
      publishedAt: new Date().toISOString(),
      ...(existing?.resultsFix ? { resultsFix: existing.resultsFix } : {}),
    },
  })
}

export async function matchingFeedEvent(seriesId: SeriesId, date: string) {
  const iso = parseIsoDate(date)
  if (!iso) throw new SeriesError('Date must be YYYY-MM-DD')
  let events: ZwiftEventSummary[]
  try {
    events = await loadUpcomingDzrEvents()
  } catch {
    throw new SeriesError('The public event list is unavailable', 502)
  }
  const hits = events.filter((event) => SERIES[seriesId].match(event.name) && event.eventDate === iso)
  if (!hits.length) throw new SeriesError('Zwift has not created this event yet', 409)
  if (hits.length > 1) throw new SeriesError('More than one Zwift event matches this date')
  return hits[0]
}