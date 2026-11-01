export type CustomClimb = {
  name: string
  fromKm: number
  toKm: number
}

export type CatalogRoute = {
  route: string
  world: string
  laps: string
  distance: string
  elevation: string
  finish: string
  linkRoute: string
  climbs: string[]
  customClimbs: CustomClimb[]
  sprints: string[]
  sprintLaps: string[]
  /** Seconds or points. Missing values are seconds, which is how older routes were saved. */
  award: 'seconds' | 'points'
  bonus: string[]
  /** Points for the ZwiftPower finish segment, ** Event Finish Banner. */
  finishPoints: string[]
  zwiftRouteId: number | null
  zwiftRouteName: string
}

export function emptyCatalogRoute(): CatalogRoute {
  return {
    route: '',
    world: '',
    laps: '',
    distance: '',
    elevation: '',
    finish: '',
    linkRoute: '',
    climbs: [],
    customClimbs: [],
    sprints: [],
    sprintLaps: [],
    award: 'seconds',
    bonus: [],
    finishPoints: [],
    zwiftRouteId: null,
    zwiftRouteName: '',
  }
}

export function listToText(values: string[]) {
  return (values || []).join(', ')
}

export function textToList(value: string) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function readCustomClimbs(value: unknown): CustomClimb[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as { name?: unknown; fromKm?: unknown; toKm?: unknown }
    const name = String(row.name || '').trim()
    const fromKm = Number(row.fromKm)
    const toKm = Number(row.toKm)
    if (!name || !Number.isFinite(fromKm) || !Number.isFinite(toKm) || !(toKm > fromKm)) return []
    return [{ name, fromKm, toKm }]
  })
}

export function asCatalogRoute(value: unknown): CatalogRoute | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<CatalogRoute>
  const route = String(row.route || '').trim()
  if (!route) return null
  const zwiftRouteId = Number(row.zwiftRouteId)
  return {
    route,
    world: String(row.world || ''),
    laps: String(row.laps || ''),
    distance: String(row.distance || ''),
    elevation: String(row.elevation || ''),
    finish: String(row.finish || ''),
    linkRoute: String(row.linkRoute || ''),
    climbs: Array.isArray(row.climbs)
      ? row.climbs.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
      : [],
    customClimbs: readCustomClimbs(row.customClimbs),
    sprints: Array.isArray(row.sprints) ? row.sprints.map(String) : [],
    sprintLaps: Array.isArray(row.sprintLaps) ? row.sprintLaps.map(String) : [],
    award: row.award === 'points' ? 'points' : 'seconds',
    bonus: Array.isArray(row.bonus) ? row.bonus.map(String) : [],
    finishPoints: Array.isArray(row.finishPoints) ? row.finishPoints.map(String) : [],
    zwiftRouteId: Number.isInteger(zwiftRouteId) && zwiftRouteId > 0 ? zwiftRouteId : null,
    zwiftRouteName: String(row.zwiftRouteName || ''),
  }
}
