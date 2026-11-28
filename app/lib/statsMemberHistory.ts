import type { MemberPoint } from './statsTypes'
import { buildSnapshotTimeline, dateTimestamp, isDateKey, type ChartTimeline } from './statsTimeline'
import { shiftDay, weekStart, type PeriodWindow } from './statsPeriods'

const MEMBER_SERIES = ['members', 'clubMembers'] as const
type MemberSeries = typeof MEMBER_SERIES[number]

const memberDateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function memberChartDate(now: Date): Date {
  const { year, month, day } = Object.fromEntries(memberDateFormat.formatToParts(now).map(({ type, value }) => [type, value]))
  // Chart helpers use UTC for arithmetic on calendar dates.
  return new Date(`${year}-${month}-${day}T00:00:00Z`)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function normalizeMemberHistory(
  snapshots: { id: string; data: Record<string, unknown> }[],
  configuredRoleId = '',
): MemberPoint[] {
  let roleId = configuredRoleId.trim()
  // Older snapshots only have roleCounts. Resolve their role from the entire
  // history before normalizing rows; its explicit ID may be in a newer snapshot.
  if (!roleId) {
    let latestDate = ''
    for (const { id, data } of snapshots) {
      const date = [data.dateKey, id].find(isDateKey)
      const recordedRoleId = typeof data.clubMemberRoleId === 'string' ? data.clubMemberRoleId.trim() : ''
      if (date && date > latestDate && recordedRoleId) {
        roleId = recordedRoleId
        latestDate = date
      }
    }
  }

  return snapshots
    .map(({ id, data }) => normalizeMemberSnapshot(id, data, roleId))
    .filter((row): row is MemberPoint => row !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
}

function normalizeMemberSnapshot(
  id: string,
  data: Record<string, unknown>,
  roleId: string,
): MemberPoint | null {
  const date = [data.dateKey, id].find(isDateKey)
  const roleCounts = data.roleCounts as Record<string, unknown> | undefined
  const members = isCount(data.memberCount) ? data.memberCount : null
  const clubMembers = [data.clubMemberCount, roleCounts?.[roleId]].find(isCount) ?? null
  if (!date || (members === null && clubMembers === null)) return null

  return {
    date,
    members,
    clubMembers,
    presence: isCount(data.presenceCount) ? data.presenceCount : null,
    estimated: Boolean(data.estimated),
  }
}

// Weekly counts are independent: a missing role count must not erase its last
// known value when a newer Discord total is sampled (or vice versa).
export function buildMemberTimeline(rows: MemberPoint[], window: PeriodWindow, now = new Date()) {
  if (window.granularity === 'day') return buildSnapshotTimeline(rows, window, now)

  const latest: Record<MemberSeries, number | null> = { members: null, clubMembers: null }
  const sourceDates: Partial<Record<MemberSeries, string>> = {}
  let estimated = false
  const snapshots = rows
    .filter(row => isDateKey(row.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(row => {
      for (const series of MEMBER_SERIES) {
        if (isCount(row[series])) {
          latest[series] = row[series]
          sourceDates[series] = row.date
        }
      }
      if (isCount(row.members)) estimated = row.estimated
      return { ...row, ...latest, estimated, sourceDates: { ...sourceDates } }
    })
  return withCurrentMemberSnapshot(buildSnapshotTimeline(snapshots, window, now), snapshots, window, now)
}

// Completed weeks stay Sunday samples. The newest snapshot this week is added
// on its own date so the line reaches the same counts as the member cards.
function withCurrentMemberSnapshot<T extends MemberPoint>(
  timeline: ChartTimeline<T>,
  snapshots: T[],
  window: PeriodWindow,
  now: Date,
): ChartTimeline<T> {
  const today = now.toISOString().slice(0, 10)
  const current = snapshots.filter(row => row.date > window.end && row.date <= today).at(-1)
  if (!current) return timeline

  const domainEnd = dateTimestamp(current.date)
  return {
    ...timeline,
    points: [...timeline.points, {
      ...current,
      weekStart: weekStart(current.date),
      weekEnd: current.date,
      timestamp: domainEnd,
      openWeek: true,
    }],
    end: current.date,
    domain: [timeline.domain[0], Math.max(timeline.domain[1], domainEnd)] as [number, number],
  }
}

export type MissingObservationRange = {
  series: MemberSeries
  start: string
  end: string
  days: number
}

// Inspect raw observations, never the weekly samples or carried-forward values.
export function findMissingMemberObservations(
  rows: MemberPoint[],
  displayed: { start: string; end: string },
  now = new Date(),
): MissingObservationRange[] {
  const yesterday = shiftDay(now.toISOString().slice(0, 10), -1)
  const end = displayed.end < yesterday ? displayed.end : yesterday
  const gaps: MissingObservationRange[] = []
  for (const series of MEMBER_SERIES) {
    const dates = rows.filter(row => isDateKey(row.date) && isCount(row[series])).map(row => row.date).sort()
    const first = dates[0]
    if (!first) continue
    const start = displayed.start > first ? displayed.start : first
    const observed = new Set(dates)
    let gap: MissingObservationRange | undefined
    for (let date = start; date <= end; date = shiftDay(date, 1)) {
      if (observed.has(date)) {
        gap = undefined
      } else if (gap) {
        gap.end = date
        gap.days += 1
      } else {
        gap = { series, start: date, end: date, days: 1 }
        gaps.push(gap)
      }
    }
  }
  return gaps
}
