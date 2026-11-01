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

export function resolveDictionaryRoute(
  data: Dictionary,
  query: { routeId?: string; name?: string; world?: string },
): ResolvedProfileRoute | { error: string } {
  return resolveProfileRoute(dictionaryRouteRows(data), query)
}
