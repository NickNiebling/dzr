export type ProfileSegment = {
  name: string
  type: "sprint" | "climb" | "segment"
  fromKm: number
  toKm: number
  direction: "forward" | "reverse"
  archId?: number
}

export type ProfileZoom = {
  title: string
  fromKm: number
  toKm: number
  matched: boolean
  climb?: boolean
}

export type SprintSuggestion = {
  name: string
  laps: string
}

export type CustomClimbRange = {
  name: string
  fromKm: number
  toKm: number
}

export type RaceProfile = {
  lapKm: number
  lapGainM: number
  leadInKm: number
  raceKm: number
  distanceKm: number[]
  altitudeM: number[]
  segments: ProfileSegment[]
  finish: ProfileZoom | null
  climbs: ProfileZoom[]
  sprints: SprintSuggestion[]
}

export function foldName(value: unknown): string

export function bonusNamesMatch(segmentName: unknown, query: unknown): boolean

export function slugifyZwiftName(value: unknown): string

export function zwiftInsiderUrl(name: unknown): string

export function parseFinish(value: unknown): { pass: number; name: string } | null

export function prepareLap(
  distance: number[],
  altitude: number[],
  leadInKm: number,
  lapKm: number,
  latlng?: number[][]
): { distance: number[]; altitude: number[]; latlng: number[][]; leadInKm: number }

export function shiftProfileSegments(segments: ProfileSegment[], leadInKm: number): ProfileSegment[]

export function mergePositionedSegments(
  existing: ProfileSegment[],
  extra: ProfileSegment[]
): ProfileSegment[]

export function placeOnRoute(
  routeLatLng: number[][],
  routeDistanceM: number[],
  segmentLatLng: number[][]
): { fromM: number; toM: number } | null

export function raceDistanceKm(lapKm: number, lapsText: unknown, distanceText: unknown, leadInKm?: number): number

export function buildRaceProfile(input: {
  distanceM: number[]
  altitudeM: number[]
  segments: ProfileSegment[]
  raceKm: number
  finishText?: string
  climbNames?: string[]
  customClimbs?: CustomClimbRange[]
  leadInKm?: number
  leadDistanceM?: number[]
  leadAltitudeM?: number[]
}): RaceProfile

export function profileImageSrc(series: string, routeName: string): string
