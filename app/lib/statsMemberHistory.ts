import type { MemberPoint } from './statsTypes'
import { buildChartTimeline, buildSnapshotTimeline, isDateKey } from './statsTimeline'
import { shiftDay, weekStart, type PeriodWindow } from './statsPeriods'

const MEMBER_SERIES = ['members', 'clubMembers'] as const
type MemberSeries = typeof MEMBER_SERIES[number]

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

// Weekly peaks are independent for each series. Missing weeks carry the last
// actual observation, not a peak from an earlier week.
export function buildMemberTimeline(rows: MemberPoint[], window: PeriodWindow, now = new Date()) {
  if (window.granularity === 'day') return buildSnapshotTimeline(rows, window, now)

  const today = now.toISOString().slice(0, 10)
  const snapshots = rows
    .filter(row => isDateKey(row.date) && row.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date))
  const first = snapshots[0]
  if (!first) return buildChartTimeline<MemberPoint>([], window)

  const start = window.start && window.start > weekStart(first.date) ? window.start : weekStart(first.date)
  const latest: Partial<Record<MemberSeries, MemberPoint>> = {}
  const points: (MemberPoint & {
    weekStart: string
    weekEnd: string
    sourceDates: Partial<Record<MemberSeries, string>>
    openWeek?: boolean
  })[] = []
  let index = 0
  for (let monday = start; monday <= today; monday = shiftDay(monday, 7)) {
    const sunday = shiftDay(monday, 6)
    const openWeek = sunday > window.end
    if (openWeek && monday !== weekStart(today)) continue
    const end = openWeek ? today : sunday
    const peaks: Partial<Record<MemberSeries, MemberPoint>> = {}
    let lastDate: string | undefined
    while (index < snapshots.length && snapshots[index].date <= end) {
      const row = snapshots[index++]
      for (const series of MEMBER_SERIES) {
        const value = row[series]
        if (!isCount(value)) continue
        latest[series] = row
        const peak = peaks[series]?.[series]
        // Equal peaks use the most recent observation's date.
        if (row.date >= monday && (!isCount(peak) || value >= peak)) peaks[series] = row
      }
      if (row.date >= monday) lastDate = row.date
    }
    if (openWeek && !lastDate) continue
    const members = peaks.members ?? latest.members
    const clubMembers = peaks.clubMembers ?? latest.clubMembers
    if (!members && !clubMembers) continue
    const sourceDates: Partial<Record<MemberSeries, string>> = {}
    if (members) sourceDates.members = members.date
    if (clubMembers) sourceDates.clubMembers = clubMembers.date
    points.push({
      date: openWeek ? lastDate! : sunday,
      weekStart: monday,
      weekEnd: openWeek ? lastDate! : sunday,
      members: members?.members ?? null,
      clubMembers: clubMembers?.clubMembers ?? null,
      presence: members?.presence ?? null,
      estimated: members?.estimated ?? false,
      sourceDates,
      ...(openWeek ? { openWeek: true } : {}),
    })
  }
  const end = points.at(-1)?.openWeek ? points.at(-1)!.date : window.end
  return buildChartTimeline(points, { ...window, end })
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

