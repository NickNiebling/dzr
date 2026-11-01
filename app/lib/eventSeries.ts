import { randomUUID } from 'crypto'
import axios from 'axios'
import { admin, adminDb } from '@/app/utils/firebaseAdminConfig'
import { catalogRouteByName, ensureCatalog } from '@/app/lib/seriesCatalog'
import { findZwiftRoute } from '@/app/lib/zwiftRouteLookup'
import { loadUpcomingDzrEvents } from '@/app/lib/zwiftPublicEvents'
import { flaskData } from '@/app/api/admin/_lib/flask'
import { ensureSeries, SeriesError, type SeriesId } from '@/app/lib/seriesSchedule'
import { courseLength, addDays, displayDate, parseIsoDate, routeForDate } from '@/packages/shared/seriesRotation'
import { zwiftInsiderUrl } from '@/packages/shared/routeProfile'
import type { CatalogRoute } from '@/app/lib/catalogRoute'
import { eventIdFromInput, type ZwiftEventSummary } from '@/packages/shared/zwiftEvents'
import { seriesMenuIconId } from '@/app/lib/seriesMenuIcons'

const COLLECTION = 'event_series'
const LOGO_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'dzr-member-site-media'
const LOGO_EXTENSIONS = ['png', 'jpg', 'webp'] as const

export type SeriesKind = 'weekly' | 'limited'

export type PointsRow = { label: string; points: string }

export type RaceStart = { time: string; eventId: string }

export type SeriesRace = {
  date: string
  route: string
  label: string
  match: string
  starts: RaceStart[]
}

export type EventSeries = {
  slug: string
  name: string
  intro: string
  timeLabel: string
  kind: SeriesKind
  zwiftName: string
  published: boolean
  logoUrl: string
  rules: string[]
  carousel: boolean
  icon: string
  pointsNote: string
  pointsRows: PointsRow[]
  leagueUrl: string
  anchorDate: string
  anchorIndex: number
  overrides: Record<string, string>
  races: SeriesRace[]
}

export type AdminSeries = EventSeries & { discordWebhookSet: boolean }

export type PublicSeries = EventSeries & {
  routes: CatalogRoute[]
  schedule: PlannedRace[]
}

export type PlannedRace = {
  date: string
  label: string
  route: CatalogRoute | null
  routeName: string
  starts: RaceStart[]
}

type StoredSeries = EventSeries & { discordWebhook: string }

const RESERVED = new Set(['after-party', 'zwifty-fifty'])

const LEGACY_SERIES: Array<{
  slug: SeriesId
  name: string
  intro: string
  timeLabel: string
  zwiftName: string
  icon: string
}> = [
  {
    slug: 'after-party',
    name: 'DZR After Party',
    intro: 'A weekly race series with carefully selected routes all finishing uphill (aka after parties).',
    timeLabel: 'Thursdays 17:15 CET | 11:15 AM EST',
    zwiftName: 'After Party',
    icon: 'mountain',
  },
  {
    slug: 'zwifty-fifty',
    name: 'The Zwifty Fifty',
    intro: 'Weekly races of about 50 km, every Sunday 14:45 CET | 8:45 AM EST.',
    timeLabel: 'Sundays 14:45 CET | 8:45 AM EST',
    zwiftName: 'Zwifty Fifty',
    icon: 'fifty',
  },
]

function isLegacySlug(slug: string): slug is SeriesId {
  return slug === 'after-party' || slug === 'zwifty-fifty'
}

/** The original weekly series share the route catalogs already used by the rotation. */
async function ensureLegacySeries() {
  for (const legacy of LEGACY_SERIES) {
    if (await readStored(legacy.slug)) continue
    const schedule = await ensureSeries(legacy.slug)
    const stored: StoredSeries = {
      slug: legacy.slug,
      name: legacy.name,
      intro: legacy.intro,
      timeLabel: legacy.timeLabel,
      kind: 'weekly',
      zwiftName: legacy.zwiftName,
      published: false,
      logoUrl: '',
      rules: [],
      carousel: false,
      icon: seriesMenuIconId(legacy.icon),
      pointsNote: '',
      pointsRows: [],
      leagueUrl: '',
      anchorDate: schedule.anchorDate,
      anchorIndex: schedule.anchorIndex,
      overrides: schedule.overrides,
      races: [],
      discordWebhook: '',
    }
    await refFor(legacy.slug).set(stored)
  }
}

async function keepLegacySchedule(slug: string, stored: Pick<StoredSeries, 'anchorDate' | 'anchorIndex' | 'overrides'>) {
  if (!isLegacySlug(slug) || !stored.anchorDate) return
  await adminDb.collection('series_schedules').doc(slug).set(
    {
      anchorDate: stored.anchorDate,
      anchorIndex: stored.anchorIndex,
      overrides: stored.overrides,
    },
    { merge: true }
  )
}

export function seriesSlug(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function upcomingWeeklyDates(anchorDate: string, count = 6, today = todayIso()) {
  const anchor = parseIsoDate(anchorDate)
  if (!anchor) return []
  let date = anchor
  let guard = 0
  while (date < today && guard < 520) {
    date = addDays(date, 7)
    guard += 1
  }
  const dates: string[] = []
  const total = count > 0 ? count : 6
  for (let index = 0; index < total; index += 1) dates.push(addDays(date, index * 7))
  return dates
}

function textList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

function pointsRows(value: unknown): PointsRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as { label?: unknown; points?: unknown }
    const label = String(row.label || '').trim()
    const points = String(row.points || '').trim()
    if (!label && !points) return []
    return [{ label, points }]
  })
}

function startsOf(value: unknown): RaceStart[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as { time?: unknown; eventId?: unknown }
    const eventId = eventIdFromInput(row.eventId)
    if (eventId === null) throw new SeriesError('Event id must be the number from the Zwift event')
    const time = String(row.time || '').trim()
    if (!eventId) return []
    return [{ time, eventId }]
  })
}

function racesOf(value: unknown): SeriesRace[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new SeriesError('Every race needs a date and a route')
    const row = item as { date?: unknown; route?: unknown; label?: unknown; match?: unknown; starts?: unknown }
    const date = parseIsoDate(row.date)
    const route = String(row.route || '').trim()
    if (!date || !route) throw new SeriesError('Every race needs a date and a route')
    return { date, route, label: String(row.label || '').trim(), match: String(row.match || '').trim(), starts: startsOf(row.starts) }
  })
}

function overridesOf(value: unknown) {
  const overrides: Record<string, string> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return overrides
  for (const [date, route] of Object.entries(value as Record<string, unknown>)) {
    const iso = parseIsoDate(date)
    const name = String(route || '').trim()
    if (iso && name) overrides[iso] = name
  }
  return overrides
}

function asStored(id: string, data: Record<string, unknown> | undefined): StoredSeries | null {
  if (!data) return null
  const name = String(data.name || '').trim()
  if (!name) return null
  const kind = data.kind === 'limited' ? 'limited' : 'weekly'
  return {
    slug: seriesSlug(String(data.slug || id)) || id,
    name,
    intro: String(data.intro || ''),
    timeLabel: String(data.timeLabel || ''),
    kind,
    zwiftName: String(data.zwiftName || '').trim(),
    published: Boolean(data.published),
    logoUrl: String(data.logoUrl || ''),
    rules: textList(data.rules),
    carousel: Boolean(data.carousel),
    icon: seriesMenuIconId(data.icon),
    pointsNote: String(data.pointsNote || ''),
    pointsRows: pointsRows(data.pointsRows),
    leagueUrl: String(data.leagueUrl || '').trim(),
    anchorDate: parseIsoDate(data.anchorDate) || '',
    anchorIndex: Number.isFinite(Number(data.anchorIndex)) ? Number(data.anchorIndex) : 0,
    overrides: overridesOf(data.overrides),
    races: racesOf(data.races),
    discordWebhook: String(data.discordWebhook || '').trim(),
  }
}

function refFor(slug: string) {
  return adminDb.collection(COLLECTION).doc(slug)
}

/** Event ids already saved for the weekly rotation, used when this series has not stored one itself. */
async function withKnownStarts(series: StoredSeries): Promise<StoredSeries> {
  if (!isLegacySlug(series.slug) || series.kind !== 'weekly') return series
  const schedule = await ensureSeries(series.slug)
  const races = series.races.map((race) => ({ ...race, starts: race.starts.map((start) => ({ ...start })) }))
  for (const [date, event] of Object.entries(schedule.events)) {
    const eventId = String(event?.id || '').trim()
    const route = String(event?.route || '').trim()
    if (!eventId || !route) continue
    const index = races.findIndex((race) => race.date === date && race.route.toLowerCase() === route.toLowerCase())
    if (index >= 0) {
      if (!races[index].starts.some((start) => start.eventId)) {
        races[index] = { ...races[index], starts: [{ time: races[index].starts[0]?.time || '', eventId }] }
      }
      continue
    }
    races.push({ date, route, label: '', match: '', starts: [{ time: '', eventId }] })
  }
  return { ...series, races }
}

function withoutWebhook(series: StoredSeries): AdminSeries {
  const { discordWebhook, ...rest } = series
  return { ...rest, discordWebhookSet: Boolean(discordWebhook) }
}

export async function listAdminSeries(): Promise<AdminSeries[]> {
  await ensureLegacySeries()
  const snap = await adminDb.collection(COLLECTION).get()
  return snap.docs
    .map((doc) => asStored(doc.id, doc.data()))
    .filter((row): row is StoredSeries => Boolean(row))
    .map(withoutWebhook)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function readAdminSeries(slug: string): Promise<AdminSeries | null> {
  const id = seriesSlug(slug)
  if (!id) return null
  if (isLegacySlug(id)) await ensureLegacySeries()
  const snap = await refFor(id).get()
  const stored = asStored(id, snap.data())
  return stored ? withoutWebhook(await withKnownStarts(stored)) : null
}

async function readStored(slug: string) {
  const id = seriesSlug(slug)
  if (!id) return null
  const snap = await refFor(id).get()
  return asStored(id, snap.data())
}

export async function saveEventSeries(
  input: Partial<EventSeries> & { slug?: string },
  webhook?: { value?: string; clear?: boolean }
) {
  const slug = seriesSlug(String(input.slug || input.name || ''))
  if (!slug) throw new SeriesError('Choose a page address')
  const name = String(input.name || '').trim()
  if (!name) throw new SeriesError('A series name is required')
  const existing = await readStored(slug)
  const kind: SeriesKind = input.kind === 'limited' ? 'limited' : 'weekly'
  const anchorDate = parseIsoDate(input.anchorDate) || existing?.anchorDate || ''
  if (kind === 'weekly' && input.published && !anchorDate) {
    throw new SeriesError('A weekly series needs the date of its first week')
  }
  let discordWebhook = existing?.discordWebhook || ''
  if (webhook?.clear) discordWebhook = ''
  else if (webhook?.value?.trim()) discordWebhook = webhook.value.trim()
  const stored: StoredSeries = {
    slug,
    name,
    intro: String(input.intro || ''),
    timeLabel: String(input.timeLabel || ''),
    kind,
    zwiftName: String(input.zwiftName || '').trim(),
    published: Boolean(input.published),
    logoUrl: String(input.logoUrl || existing?.logoUrl || ''),
    rules: textList(input.rules),
    carousel: Boolean(input.carousel),
    icon: seriesMenuIconId(input.icon),
    pointsNote: String(input.pointsNote || ''),
    pointsRows: pointsRows(input.pointsRows),
    leagueUrl: String(input.leagueUrl || '').trim(),
    anchorDate,
    anchorIndex: Number.isFinite(Number(input.anchorIndex)) ? Number(input.anchorIndex) : 0,
    overrides: overridesOf(input.overrides),
    races: racesOf(input.races),
    discordWebhook,
  }
  await refFor(slug).set(stored)
  await ensureCatalog(slug)
  await keepLegacySchedule(slug, stored)
  return withoutWebhook(stored)
}

/** Removes one event series, its route list, and its logo. The original After Party and Zwifty Fifty catalogs stay. */
export async function deleteEventSeries(slugInput: string) {
  const slug = seriesSlug(slugInput)
  if (!slug || RESERVED.has(slug)) throw new SeriesError('That series cannot be deleted')
  const existing = await readStored(slug)
  if (!existing) throw new SeriesError('Series not found', 404)
  await refFor(slug).delete()
  await adminDb.collection('series_catalogs').doc(slug).delete()
  const bucket = admin.storage().bucket(LOGO_BUCKET)
  await Promise.all(
    LOGO_EXTENSIONS.map((extension) =>
      bucket.file(`event-series/${slug}/logo.${extension}`).delete({ ignoreNotFound: true }).catch(() => undefined)
    )
  )
}

function logoExtension(contentType: string) {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  return 'jpg'
}

function storageError(error: unknown): never {
  const raw = error instanceof Error ? error.message : ''
  if (raw.includes('bucket does not exist') || raw.includes('notFound')) {
    throw new SeriesError('Logo storage is not available', 502)
  }
  throw new SeriesError('Could not store the logo', 502)
}

export async function saveSeriesLogo(slug: string, bytes: Buffer, contentType: string) {
  const series = await readStored(slug)
  if (!series) throw new SeriesError('Save the series before adding a logo', 404)
  const extension = logoExtension(contentType)
  const path = `event-series/${series.slug}/logo.${extension}`
  const bucket = admin.storage().bucket(LOGO_BUCKET)
  try {
    await bucket.file(path).save(bytes, {
      metadata: { contentType, cacheControl: 'public, max-age=86400' },
    })
    await Promise.all(
      LOGO_EXTENSIONS.filter((item) => item !== extension).map((item) =>
        bucket.file(`event-series/${series.slug}/logo.${item}`).delete({ ignoreNotFound: true })
      )
    )
  } catch (error) {
    storageError(error)
  }
  const logoUrl = `/api/series/${series.slug}/logo?v=${randomUUID()}`
  await refFor(series.slug).update({ logoUrl })
  return logoUrl
}

export async function readSeriesLogo(slug: string) {
  const series = await readStored(slug)
  if (!series?.logoUrl) return null
  const bucket = admin.storage().bucket(LOGO_BUCKET)
  let chosen: { path: string; updated: string } | null = null
  for (const extension of LOGO_EXTENSIONS) {
    const path = `event-series/${series.slug}/logo.${extension}`
    const file = bucket.file(path)
    const [exists] = await file.exists()
    if (!exists) continue
    const [meta] = await file.getMetadata()
    const updated = String(meta.updated || '')
    if (!chosen || updated > chosen.updated) chosen = { path, updated }
  }
  if (!chosen) return null
  const file = bucket.file(chosen.path)
  const [bytes] = await file.download()
  const [meta] = await file.getMetadata()
  return { bytes, contentType: String(meta.contentType || 'image/png') }
}

function catalogByName(routes: CatalogRoute[], name: string) {
  const wanted = name.trim().toLowerCase()
  return routes.find((route) => route.route.toLowerCase() === wanted) || null
}

export function plannedRaces(series: EventSeries, routes: CatalogRoute[], today = todayIso()): PlannedRace[] {
  if (series.kind === 'limited') {
    return series.races
      .map((race) => ({
        date: race.date,
        label: race.label,
        routeName: race.route,
        route: catalogByName(routes, race.route),
        starts: race.starts,
      }))
      .sort((left, right) => left.date.localeCompare(right.date) || left.label.localeCompare(right.label))
  }
  if (!series.anchorDate || !routes.length) return []
  const names = routes.map((route) => route.route)
  return upcomingWeeklyDates(series.anchorDate, 6, today).map((date) => {
    const routeName = routeForDate(names, series.anchorDate, series.anchorIndex, series.overrides, date)
    const applied = series.races.find((race) => race.date === date && race.route.toLowerCase() === routeName.toLowerCase())
    return {
      date,
      label: displayDate(date),
      routeName,
      route: catalogByName(routes, routeName),
      starts: applied?.starts || [],
    }
  })
}

export async function publicSeries(slug: string): Promise<PublicSeries | null> {
  const stored = await readStored(slug)
  if (!stored) return null
  const ready = await withKnownStarts(stored)
  const { discordWebhook: _webhook, ...series } = ready
  const routes = await ensureCatalog(ready.slug)
  return { ...series, routes, schedule: plannedRaces(series, routes) }
}

export async function listPublishedSeries() {
  const snap = await adminDb.collection(COLLECTION).where('published', '==', true).get()
  return snap.docs
    .map((doc) => asStored(doc.id, doc.data()))
    .filter((row): row is StoredSeries => Boolean(row))
    .map((row) => ({
      slug: row.slug,
      name: row.name,
      icon: row.icon,
      intro: row.intro,
      timeLabel: row.timeLabel,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function nameHas(name: string, words: string) {
  const folded = words.trim().toLowerCase()
  return folded ? name.toLowerCase().includes(folded) : true
}

async function courseFor(slug: string, routeName: string) {
  const entry = await catalogRouteByName(slug, routeName)
  if (!entry) throw new SeriesError('Route is not in this series')
  const length = courseLength(entry.laps, entry.distance)
  if (!length) throw new SeriesError(`${entry.route} has no laps or distance`)
  const routeId = entry.zwiftRouteId || (await findZwiftRoute(entry.zwiftRouteName || entry.route)).routeId
  if ('laps' in length) return { route: entry, routeId, laps: length.laps }
  return { route: entry, routeId, distanceMeters: length.distanceMeters }
}

function raceOn(series: StoredSeries, date: string, routeName: string) {
  return series.races.find(
    (race) => race.date === date && race.route.toLowerCase() === routeName.trim().toLowerCase()
  )
}

export async function applyEventSeries(slug: string, date: string, routeName: string) {
  const iso = parseIsoDate(date)
  if (!iso) throw new SeriesError('Date must be YYYY-MM-DD')
  const series = await readStored(slug)
  if (!series) throw new SeriesError('Series not found', 404)
  const routes = await ensureCatalog(series.slug)
  const planned =
    series.kind === 'weekly'
      ? routeForDate(
          routes.map((route) => route.route),
          series.anchorDate,
          series.anchorIndex,
          series.overrides,
          iso
        )
      : routeName
  const chosen = routeName.trim() || planned
  if (!chosen) throw new SeriesError('Choose a route for this race')
  const course = await courseFor(series.slug, chosen)
  const race = raceOn(series, iso, chosen)
  const payload: { routeId: number; laps?: number; distanceMeters?: number } = { routeId: course.routeId }
  if ('laps' in course) payload.laps = course.laps
  else payload.distanceMeters = course.distanceMeters
  const typed = (race?.starts || []).filter((start) => /^\d+$/.test(start.eventId))
  let starts = typed
  if (!typed.length) {
    if (!series.zwiftName) throw new SeriesError('Add the words used to recognise the Zwift event, or type the event id')
    let events: ZwiftEventSummary[]
    try {
      events = await loadUpcomingDzrEvents()
    } catch {
      throw new SeriesError('The public event list is unavailable', 502)
    }
    const named = events.filter((event) => event.eventDate === iso && nameHas(event.name, series.zwiftName))
    const sameDay = series.races.filter((row) => row.date === iso)
    let hits = named
    if (race?.match) hits = named.filter((event) => nameHas(event.name, race.match))
    else if (sameDay.length > 1 && race?.label) hits = named.filter((event) => nameHas(event.name, race.label))
    else if (sameDay.length > 1) throw new SeriesError('Add words that identify this race in the Zwift event name')
    if (!hits.length) throw new SeriesError('Zwift has not created this event yet. Type the event id when it is not on the public calendar.', 409)
    for (const hit of hits) {
      const updated = await flaskData(`/api/zwift/events/${hit.id}/course`, { method: 'POST', body: payload })
      if (updated.status >= 400) {
        throw new SeriesError(String(updated.body?.error || 'Zwift update failed'), updated.status)
      }
    }
    starts = hits.map((hit) => ({
      time: hit.subgroups[0]?.startTime || '',
      eventId: String(hit.id),
    }))
  } else {
    for (const start of typed) {
      const updated = await flaskData(`/api/zwift/events/${start.eventId}/course`, { method: 'POST', body: payload })
      if (updated.status >= 400) {
        throw new SeriesError(String(updated.body?.error || 'Zwift update failed'), updated.status)
      }
    }
  }
  const nextRaces = series.races.filter((row) => !(row.date === iso && row.route.toLowerCase() === chosen.toLowerCase()))
  nextRaces.push({
    date: iso,
    route: course.route.route,
    label: race?.label || (series.kind === 'weekly' ? displayDate(iso) : ''),
    match: race?.match || '',
    starts,
  })
  await refFor(series.slug).update({ races: nextRaces })
  let discordError = ''
  try {
    await postEventDiscord(series, course.route, iso, starts)
  } catch (error) {
    discordError = error instanceof Error ? error.message : 'Discord post failed'
  }
  return { eventIds: starts.map((start) => start.eventId), route: course.route.route, discordError }
}

async function postEventDiscord(series: StoredSeries, route: CatalogRoute, date: string, starts: RaceStart[]) {
  if (!series.discordWebhook) throw new SeriesError('No Discord webhook is saved for this series')
  const passes = starts
    .filter((start) => start.eventId)
    .map((start) => `[${start.time || 'Zwift'}](https://www.zwift.com/eu/events/view/${start.eventId})`)
    .join(', ')
  const sprints = route.sprints.filter((sprint) => sprint.trim())
  const lines = [
    `**Race details for ${displayDate(date)}**`,
    `**World:** ${route.world}`,
    `**Route:** [${route.route}](${route.linkRoute.trim() || zwiftInsiderUrl(route.zwiftRouteName || route.route) || `https://www.dzrracingseries.com/series/${series.slug}`})`,
    `**Laps:** ${route.laps}`,
    `**Distance:** ${route.distance} km`,
    `**Elevation:** ${route.elevation} hm`,
  ]
  if (route.finish.trim()) lines.push(`**Finish:** ${route.finish}`)
  if (sprints.length) lines.push(`**Sprints:** ${sprints.join(', ')}`)
  const bonus = route.bonus.map((seconds) => seconds.trim()).filter(Boolean)
  if (bonus.length) lines.push(`**Bonus seconds:** ${bonus.map((seconds) => `${seconds}s`).join(', ')}`)
  if (passes) lines.push(`**Race pass:** ${passes}`)
  lines.push(`**More information:** https://www.dzrracingseries.com/series/${series.slug}`)
  const body: { content: string; embeds?: { image: { url: string } }[] } = { content: lines.join('\n') }
  const logo = series.logoUrl.startsWith('https://')
    ? series.logoUrl
    : series.logoUrl.startsWith('/')
      ? `https://www.dzrracingseries.com${series.logoUrl}`
      : ''
  if (logo) body.embeds = [{ image: { url: logo } }]
  await axios.post(series.discordWebhook, body)
}

export async function setWeeklyOverride(slug: string, date: string, routeName: string) {
  const series = await readStored(slug)
  if (!series || series.kind !== 'weekly') throw new SeriesError('This series does not rotate weekly')
  const iso = parseIsoDate(date)
  if (!iso) throw new SeriesError('Date must be YYYY-MM-DD')
  const routes = await ensureCatalog(series.slug)
  const names = routes.map((route) => route.route)
  const canonical = names.find((name) => name.toLowerCase() === routeName.trim().toLowerCase())
  if (!canonical) throw new SeriesError('Route is not in this series')
  const natural = routeForDate(names, series.anchorDate, series.anchorIndex, {}, iso)
  const overrides = { ...series.overrides }
  if (canonical === natural) delete overrides[iso]
  else overrides[iso] = canonical
  await refFor(series.slug).update({ overrides })
  await keepLegacySchedule(series.slug, { ...series, overrides })
  return readAdminSeries(series.slug)
}
