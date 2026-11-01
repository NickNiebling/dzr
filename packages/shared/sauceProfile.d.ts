export type SauceLine = {
  distance: number[]
  altitude: number[]
}

export type SauceProfileSegment = {
  name: string
  type: "sprint" | "climb" | "segment"
  fromKm: number
  toKm: number
  direction: "forward" | "reverse"
  archId?: number
}

export function routeElevation(routeId: number | string): SauceLine

export function routeLeadinProfile(routeId: number | string): SauceLine

export function measuredProfileSegments(routeId: number | string, rows: unknown[]): SauceProfileSegment[]

export function jerseyMarker(iconPath: string | null | undefined): "sprint" | "climb" | "segment"

export function dictionarySegmentName(row: {
  direction?: string
  archFriendlyName?: string
  archFriendlyNameR?: string
  name?: string
}): string

export function sauceRoute(routeId: number | string): { id?: number | string; worldId?: number; distanceInMeters?: number } | null

export function sauceWorldName(worldId: number | string): string

export function worldKey(value: unknown): string

export type ResolvedProfileRoute = {
  id: string
  name: string
  world: string
  leadInKm: number
  drawable: boolean
}

export function resolveProfileRoute(
  rows: unknown[],
  query?: { routeId?: string; name?: string; world?: string },
): ResolvedProfileRoute | { error: string }
