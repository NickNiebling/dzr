export interface ZwiftEventSubgroup {
  id: number
  /** Category letter, e.g. "A". "—" when the feed gives none. */
  label: string
  /** Europe/Copenhagen date, "YYYY-MM-DD". */
  eventDate: string
  /** Europe/Copenhagen wall clock, "HH:MM". This subgroup's own start, not the parent event's. */
  startTime: string
  /** Zwift Racing Score band, e.g. "350-520". Null when categories are not enforced. */
  scoreRange: string | null
  paceRange: string | null
}

export interface ZwiftEventSummary {
  id: number
  name: string
  /** RACE | GROUP_RIDE | GROUP_WORKOUT | … as the feed reports it. */
  eventType: string
  url: string
  eventDate: string
  durationMinutes: number | null
  distanceKm: number | null
  categoryEnforcement: boolean
  subgroups: ZwiftEventSubgroup[]
}

/** Soonest first. Events with no readable subgroup are dropped rather than half-rendered. */
export function compactZwiftEvents(feed: unknown): ZwiftEventSummary[]

/** The category label a Zwift Racing Score falls into, or null. A hint only — never a selection. */
export function suggestedSubgroup(
  event: ZwiftEventSummary | null | undefined,
  racingScore: number | null | undefined
): string | null

export function localParts(iso: unknown): { eventDate: string; startTime: string } | null

/** Digits from a typed id or a Zwift event URL. "" when empty, null when the text is not an id. */
export function eventIdFromInput(value: unknown): string | null
/** Remove only /eu from pasted Zwift event links, preserving all other content. */
export function normalizeZwiftEventUrl(value: string): string
export const TZ: string
/** Public upcoming feed for events tagged dzr. About the next week, not a season. */
export const DZR_UPCOMING_EVENTS_URL: string
