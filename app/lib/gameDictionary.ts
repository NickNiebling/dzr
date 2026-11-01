import { resolveProfileRoute, type ResolvedProfileRoute } from '@/packages/shared/sauceProfile'

const DICTIONARY_URL = 'https://www.zwift.com/zwift-web-pages/gamedictionaryextended'
const TTL_MS = 24 * 60 * 60 * 1000

type Dictionary = {
  ROUTES?: { ROUTE?: unknown }
  SEGMENTS?: { SEGMENT?: unknown }
}

let cache: { at: number; data: Dictionary } | null = null

function asRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === 'object') as Record<string, unknown>[]
  if (value && typeof value === 'object') return [value as Record<string, unknown>]
  return []
}

/** Live Zwift game dictionary, kept in memory for a day. A failed refresh keeps the last copy. */
export async function gameDictionary(): Promise<Dictionary> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data
  let response: Response
  try {
    response = await fetch(DICTIONARY_URL, {
      headers: { Accept: 'application/json', Source: 'zwift-web' },
      cache: 'no-store',
    })
  } catch {
    if (cache) return cache.data
    throw new Error('The Zwift game dictionary is unavailable right now.')
  }
  if (!response.ok) {
    if (cache) return cache.data
    throw new Error('The Zwift game dictionary is unavailable right now.')
  }
  const data = (await response.json()) as Dictionary
  if (!data?.ROUTES || !data?.SEGMENTS) {
    if (cache) return cache.data
    throw new Error('The Zwift game dictionary is unavailable right now.')
  }
  cache = { at: Date.now(), data }
  return data
}

export function dictionaryRouteRows(data: Dictionary) {
  return asRows(data.ROUTES?.ROUTE)
}

export function dictionarySegmentRows(data: Dictionary) {
  const raw = data.SEGMENTS
  const rows = raw && typeof raw === 'object' && 'SEGMENT' in raw ? raw.SEGMENT : raw
  return asRows(rows)
}

const WORLD_SLUGS: Record<string, string> = {
  WATOPIA: 'watopia',
  RICHMOND: 'richmond',
  LONDON: 'london',
  NEWYORK: 'new-york',
  INNSBRUCK: 'innsbruck',
  BOLOGNA: 'bologna',
  BOLOGNATT: 'bologna',
  YORKSHIRE: 'yorkshire',
  CRITCITY: 'crit-city',
  CRIT_CITY: 'crit-city',
  MAKURIISLANDS: 'makuri-islands',
  MAKURI_ISLANDS: 'makuri-islands',
  FRANCE: 'france',
  PARIS: 'paris',
  SCOTLAND: 'scotland',
  'GRAVEL MOUNTAIN': 'gravel-mountain',
}

export type DictionaryRouteHit = { routeId: number; name: string; world: string }

function worldSlug(map: unknown) {
  const key = String(map || '').trim().toUpperCase()
  if (!key) return ''
  return WORLD_SLUGS[key] || key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function rideableRoute(row: Record<string, unknown>): DictionaryRouteHit | null {
  if (String(row.sports ?? '') === '2') return null
  const routeId = Number(row.signature ?? row.routeSignature)
  const name = String(row.name || '').trim()
  const world = worldSlug(row.map)
  if (!world || !name || !Number.isInteger(routeId) || routeId <= 0) return null
  return { routeId, name, world }
}

function rideableRoutes(data: Dictionary) {
  const seen = new Set<number>()
  const routes: DictionaryRouteHit[] = []
  for (const row of dictionaryRouteRows(data)) {
    const route = rideableRoute(row)
    if (!route || seen.has(route.routeId)) continue
    seen.add(route.routeId)
    routes.push(route)
  }
  return routes
}

/** Cycling routes from the live game dictionary, grouped for the route picker. */
export async function listDictionaryWorldRoutes(): Promise<{ world: string; routes: DictionaryRouteHit[] }[]> {
  const worlds = new Map<string, DictionaryRouteHit[]>()
  for (const route of rideableRoutes(await gameDictionary())) {
    const list = worlds.get(route.world) || []
    list.push(route)
    worlds.set(route.world, list)
  }
  return [...worlds.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([world, listed]) => ({
      world,
      routes: listed.sort((left, right) => left.name.localeCompare(right.name)),
    }))
}

function foldRouteQuery(value: string) {
  return value.toLowerCase().replace(/['’‘`]/g, '')
}

/** Match dictionary routes by name, or by an exact route id. */
export async function searchDictionaryRoutes(query: string, limit = 20): Promise<DictionaryRouteHit[]> {
  const text = String(query || '').trim()
  const folded = foldRouteQuery(text)
  if (folded.length < 2 && !/^\d+$/.test(text)) return []
  const matches: DictionaryRouteHit[] = []
  for (const route of rideableRoutes(await gameDictionary())) {
    const idMatch = /^\d+$/.test(text) && String(route.routeId) === text
    if (!idMatch && !foldRouteQuery(route.name).includes(folded)) continue
    matches.push(route)
    if (matches.length >= limit) break
  }
  return matches
}

export function resolveDictionaryRoute(
  data: Dictionary,
  query: { routeId?: string; name?: string; world?: string },
): ResolvedProfileRoute | { error: string } {
  return resolveProfileRoute(dictionaryRouteRows(data), query)
}
