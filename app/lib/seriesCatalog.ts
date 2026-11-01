import { adminDb } from '@/app/utils/firebaseAdminConfig'
import { AfterPartyRacesData } from '@/app/dzr-after-party/AfterPartyRaces'
import { ZwiftyFiftyRacesData } from '@/app/the-zwifty-fifty/ZwiftyFiftyRaces'
import { asCatalogRoute, type CatalogRoute } from '@/app/lib/catalogRoute'
const COLLECTION = 'series_catalogs'

function refFor(seriesId: string) {
  return adminDb.collection(COLLECTION).doc(seriesId)
}

function seedRoutes(seriesId: string): CatalogRoute[] | null {
  if (seriesId === 'after-party') {
    return AfterPartyRacesData.map((race) => ({
      route: race.route,
      world: race.world,
      laps: race.laps,
      distance: race.distance,
      elevation: race.elevation,
      finish: race.finish,
      linkRoute: race.linkRoute,
      climbs: [],
      customClimbs: [],
      sprints: [],
      sprintLaps: [],
      award: 'seconds',
      bonus: [],
      finishPoints: [],
      zwiftRouteId: null,
      zwiftRouteName: '',
    }))
  }
  if (seriesId !== 'zwifty-fifty') return null
  return ZwiftyFiftyRacesData.map((race) => ({
    route: race.route,
    world: race.world,
    laps: race.laps,
    distance: race.length,
    elevation: race.hm,
    finish: '',
    linkRoute: race.linkRoute,
    climbs: race.climbs || [],
    customClimbs: [],
    sprints: race.sprints || [],
    sprintLaps: race.sprintLaps || [],
    award: 'seconds',
    bonus: race.bonus || [],
    finishPoints: [],
    zwiftRouteId: null,
    zwiftRouteName: '',
  }))
}

function readRoutes(data: Record<string, unknown> | undefined) {
  const rows = Array.isArray(data?.routes) ? data.routes : []
  return rows.map(asCatalogRoute).filter((row): row is CatalogRoute => Boolean(row))
}

export async function listCatalog(seriesId: string): Promise<CatalogRoute[]> {
  const snap = await refFor(seriesId).get()
  return snap.exists ? readRoutes(snap.data()) : []
}

export async function ensureCatalog(seriesId: string): Promise<CatalogRoute[]> {
  const ref = refFor(seriesId)
  const snap = await ref.get()
  const existing = snap.exists ? readRoutes(snap.data()) : []
  if (existing.length) return existing
  const seeded = seedRoutes(seriesId)
  if (!seeded) {
    if (!snap.exists) await ref.set({ routes: [] })
    return []
  }
  await adminDb.runTransaction(async (tx) => {
    const current = await tx.get(ref)
    const already = current.exists ? readRoutes(current.data()) : []
    if (!already.length) tx.set(ref, { routes: seeded })
  })
  const saved = await ref.get()
  return readRoutes(saved.data())
}

export async function catalogRouteByName(seriesId: string, routeName: string) {
  const routes = await ensureCatalog(seriesId)
  const wanted = routeName.trim().toLowerCase()
  return routes.find((route) => route.route.toLowerCase() === wanted) || null
}

function uniqueName(routes: CatalogRoute[], route: string, ignoreIndex: number) {
  const wanted = route.trim().toLowerCase()
  return routes.some((row, index) => index !== ignoreIndex && row.route.toLowerCase() === wanted)
}

async function renameGroupRideRoute(from: string, to: string) {
  const ref = adminDb.collection('group_ride_schedules').doc('always-a-race')
  const snap = await ref.get()
  if (!snap.exists) return
  const data = snap.data() || {}
  const overrides = { ...(data.overrides || {}) }
  const events = { ...(data.events || {}) }
  let changed = false
  for (const [date, route] of Object.entries(overrides)) {
    if (route === from) {
      overrides[date] = to
      changed = true
    }
  }
  for (const [date, event] of Object.entries(events)) {
    const row = event as { routeA?: string }
    if (row?.routeA === from) {
      events[date] = { ...row, routeA: to }
      changed = true
    }
  }
  if (changed) await ref.update({ overrides, events })
}

async function renameScheduleRoute(seriesId: string, from: string, to: string) {
  if (!from || from === to) return
  if (seriesId === 'always-a-race') {
    await renameGroupRideRoute(from, to)
    return
  }
  const ref = adminDb.collection('series_schedules').doc(seriesId)
  const snap = await ref.get()
  if (!snap.exists) {
    await renameEventSeriesRoute(seriesId, from, to)
    return
  }
  const data = snap.data() || {}
  const overrides = { ...(data.overrides || {}) }
  const events = { ...(data.events || {}) }
  let changed = false
  for (const [date, route] of Object.entries(overrides)) {
    if (route === from) {
      overrides[date] = to
      changed = true
    }
  }
  for (const [date, event] of Object.entries(events)) {
    const row = event as { id?: string; route?: string }
    if (row?.route === from) {
      events[date] = { ...row, route: to }
      changed = true
    }
  }
  if (changed) await ref.update({ overrides, events })
  await renameEventSeriesRoute(seriesId, from, to)
}

async function renameEventSeriesRoute(seriesId: string, from: string, to: string) {
  const ref = adminDb.collection('event_series').doc(seriesId)
  const snap = await ref.get()
  if (!snap.exists) return
  const data = snap.data() || {}
  const overrides = { ...(data.overrides || {}) }
  let changed = false
  for (const [date, route] of Object.entries(overrides)) {
    if (route === from) {
      overrides[date] = to
      changed = true
    }
  }
  const races = Array.isArray(data.races)
    ? data.races.map((race) => {
        const row = race as { route?: string }
        if (row?.route !== from) return race
        changed = true
        return { ...row, route: to }
      })
    : data.races
  if (changed) await ref.update({ overrides, races })
}

export async function saveCatalogRoute(seriesId: string, index: number, route: CatalogRoute) {
  const routes = await ensureCatalog(seriesId)
  if (!Number.isInteger(index) || index < 0 || index >= routes.length) {
    throw new Error('That route is no longer in the list')
  }
  if (uniqueName(routes, route.route, index)) throw new Error('That route name is already in this series')
  const previous = routes[index].route
  routes[index] = route
  await refFor(seriesId).update({ routes })
  await renameScheduleRoute(seriesId, previous, route.route)
  return routes
}

export async function addCatalogRoute(seriesId: string, route: CatalogRoute) {
  const routes = await ensureCatalog(seriesId)
  if (uniqueName(routes, route.route, -1)) throw new Error('That route name is already in this series')
  routes.push(route)
  await refFor(seriesId).update({ routes })
  return routes
}
