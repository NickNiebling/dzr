import { routes as zwiftRoutes, segments as zwiftSegments, worlds as zwiftWorlds } from 'zwift-data'

type CatalogRoute = {
  id?: number
  world: string
  name: string
}

const routes = zwiftRoutes as unknown as CatalogRoute[]

export type ListedRoute = { routeId: number; name: string; world: string }

export function listWorldRoutes(): { world: string; routes: ListedRoute[] }[] {
  const worlds = new Map<string, ListedRoute[]>()
  for (const route of routes) {
    const routeId = Number(route.id)
    const world = String(route.world || '').trim()
    const name = String(route.name || '').trim()
    if (!world || !name || !Number.isInteger(routeId) || routeId <= 0) continue
    const list = worlds.get(world) || []
    list.push({ routeId, name, world })
    worlds.set(world, list)
  }
  return [...worlds.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([world, listed]) => ({
      world,
      routes: listed.sort((left, right) => left.name.localeCompare(right.name)),
    }))
}

type CatalogWorld = { slug: string; name: string }

type CatalogSourceRoute = {
  id?: number
  name: string
  slug: string
  world: string
  distance: number
  elevation: number
  leadInDistance?: number
  leadInElevation?: number
  leadInDistanceFreeRide?: number
  eventOnly?: boolean
  sports?: readonly string[]
  lap?: boolean
  levelLocked?: boolean
  supportsTT?: boolean
  experience?: number
  segments?: readonly string[]
  segmentsOnRoute?: ReadonlyArray<{ from: number; to: number; segment: string }>
  zwiftInsiderUrl?: string
  whatsOnZwiftUrl?: string
  stravaSegmentUrl?: string
  stravaSegmentId?: number
}

type CatalogSourceSegment = {
  slug: string
  name: string
  world: string
  type: string
  distance?: number
  elevation?: number
  avgIncline?: number
}

/** The route, segment and world facts the bot used to read from its own zwift-data install. */
export function zwiftCatalogPayload() {
  const sourceRoutes = zwiftRoutes as unknown as CatalogSourceRoute[]
  const sourceSegments = zwiftSegments as unknown as CatalogSourceSegment[]
  const sourceWorlds = zwiftWorlds as unknown as CatalogWorld[]
  return {
    worlds: sourceWorlds.map((world) => ({ slug: world.slug, name: world.name })),
    routes: sourceRoutes.map((route) => ({
      id: route.id,
      name: route.name,
      slug: route.slug,
      world: route.world,
      distance: route.distance,
      elevation: route.elevation,
      leadInDistance: route.leadInDistance,
      leadInElevation: route.leadInElevation,
      leadInDistanceFreeRide: route.leadInDistanceFreeRide,
      eventOnly: route.eventOnly === true,
      sports: route.sports,
      lap: route.lap === true,
      levelLocked: route.levelLocked === true,
      supportsTT: route.supportsTT === true,
      experience: route.experience,
      segments: route.segments || [],
      segmentsOnRoute: route.segmentsOnRoute || [],
      zwiftInsiderUrl: route.zwiftInsiderUrl,
      whatsOnZwiftUrl: route.whatsOnZwiftUrl,
      stravaSegmentUrl: route.stravaSegmentUrl,
      stravaSegmentId: route.stravaSegmentId,
    })),
    segments: sourceSegments.map((segment) => ({
      slug: segment.slug,
      name: segment.name,
      world: segment.world,
      type: segment.type,
      distance: segment.distance,
      elevation: segment.elevation,
      avgIncline: segment.avgIncline,
    })),
  }
}
