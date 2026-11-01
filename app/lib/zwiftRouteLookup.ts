import { searchDictionaryRoutes } from '@/app/lib/gameDictionary'
import { chooseZwiftRoute, foldRouteName } from '@/packages/shared/zwiftRouteMatch'

export type ZwiftRouteHit = { routeId: number; name: string; world: string | null }

async function searchRoutes(query: string): Promise<ZwiftRouteHit[]> {
  return searchDictionaryRoutes(query)
}

function asHit(hit: ZwiftRouteHit): ZwiftRouteHit | null {
  const routeId = Number(hit?.routeId)
  if (!routeId) return null
  return {
    routeId,
    name: String(hit.name || ''),
    world: hit.world ? String(hit.world) : null,
  }
}

function dedupe(hits: ZwiftRouteHit[]) {
  const seen = new Set<number>()
  const rows: ZwiftRouteHit[] = []
  for (const hit of hits) {
    const row = asHit(hit)
    if (!row || seen.has(row.routeId)) continue
    seen.add(row.routeId)
    rows.push(row)
  }
  return rows
}

async function gatherZwiftRoutes(routeName: string) {
  let hits = dedupe(await searchRoutes(routeName))
  if (chooseZwiftRoute(hits, routeName)) return hits
  const words = routeName
    .split(/\s+/)
    .map((word) => word.replace(/['’‘`+]/g, ''))
    .filter((word) => word.length >= 4)
    .sort((a, b) => b.length - a.length)
  for (const word of words) {
    hits = dedupe([...hits, ...(await searchRoutes(word))])
    if (chooseZwiftRoute(hits, routeName)) break
  }
  return hits
}

export async function suggestZwiftRoutes(routeName: string) {
  const options = await gatherZwiftRoutes(routeName)
  const chosen = chooseZwiftRoute(options, routeName)
  const match = chosen ? asHit(chosen) : null
  return {
    match,
    sameName: Boolean(match && foldRouteName(match.name) === foldRouteName(routeName)),
    options: options.slice(0, 15),
  }
}

export async function findZwiftRoute(routeName: string): Promise<ZwiftRouteHit> {
  const { match } = await suggestZwiftRoutes(routeName)
  if (!match?.routeId) throw new Error(`Could not match a single Zwift route for ${routeName}`)
  return match
}
