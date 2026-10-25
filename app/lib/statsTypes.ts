import type { PeriodWindow } from './statsPeriods'
import type { ActivityPoint } from './statsSeries'

export type GrowthSeriesPoint = {
  day: string
  added: number
  cumulative: number
}

export type GrowthResponse = {
  total: number
  estimatedJoinDates: number
  firstJoinDate: string | null
  series: GrowthSeriesPoint[]
  zwiftpower: {
    total: number
    estimated?: boolean
    series: { day: string; cumulative: number }[]
  }
}

export type TopUser = {
  user_id: string
  username: string
  messages: number
  reactions: number
  voice: number
  interactions: number
  total: number
}

export type TopChannel = {
  channel_id: string
  channel_name: string
  messages: number
  reactions: number
  total: number
}

export type MemberPoint = {
  date: string
  members: number | null
  clubMembers: number | null
  presence: number | null
  estimated: boolean
}

export type SnapshotStatus = {
  lastSuccessAt?: string | null
  lastScheduledSuccessAt?: string | null
  lastScheduledSuccessDate?: string | null
  missingScheduledDate?: string | null
  lastError?: { stage: string; message: string; runId: string; at: string; source: string } | null
  error?: string
}

export type StatsResponse = {
  snapshotStatus?: SnapshotStatus
  period: PeriodWindow
  totals: {
    messages: number
    reactions: number
    voice: number
    interactions: number
    uniqueUsers: number
    uniqueChannels: number
    daysWithActivity: number
    avgDailyMessages: number
  }
  activity: ActivityPoint[]
  topUsers: TopUser[]
  topChannels: TopChannel[]
  members: {
    series: MemberPoint[]
    latest: MemberPoint | null
    error?: string
  }
}
