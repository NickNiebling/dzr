import { memberSnapshotClock } from '@/app/lib/memberSnapshotClock'
import { normalizeMemberHistory } from '@/app/lib/statsMemberHistory'
import { getHistoryStart, getPeriodWindow, parseStatsPeriod } from '@/app/lib/statsPeriods'
import { buildActivitySeries, type ActivityPoint } from '@/app/lib/statsSeries'
import type { MemberPoint, StatsResponse } from '@/app/lib/statsTypes'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/app/api/admin/_lib/auth'
import { adminDb } from '@/app/utils/firebaseAdminConfig'
import { COLLECTIONS } from '@/app/lib/sharedConstants'

type ActivityDoc = {
  dateKey?: string
  timestamp?: string
  totalActivities?: number
  rawData?: {
    messageCount?: number
    reactionCount?: number
    voiceActivityCount?: number
    interactionCount?: number
  }
  summary?: {
    userActivity?: Record<string, {
      username?: string
      messages?: number
      reactions?: number
      voiceActivity?: number
      interactions?: number
    }>
    channelActivity?: Record<string, {
      channelName?: string
      messages?: number
      reactions?: number
    }>
  }
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function nextUtcDateKey(day: string): string {
  const dt = new Date(`${day}T00:00:00.000Z`)
  dt.setUTCDate(dt.getUTCDate() + 1)
  return utcDateKey(dt)
}

function eachDayInclusive(start: string, end: string): string[] {
  const days: string[] = []
  for (let day = start; day <= end; day = nextUtcDateKey(day)) days.push(day)
  return days
}

function n(value: unknown): number {
  const x = Number(value)
  return Number.isFinite(x) ? x : 0
}

async function loadActivities(startKey: string | null, endKey: string): Promise<ActivityDoc[]> {
  const col = adminDb.collection(COLLECTIONS.serverActivity)
  if (!startKey) {
    try {
      const snap = await col.get()
      return snap.docs
        .map((d) => d.data() as ActivityDoc)
        .filter((a) => {
          const key = a.dateKey || String(a.timestamp || '').slice(0, 10)
          return Boolean(key) && key <= endKey
        })
    } catch {
      const snap = await col.limit(20000).get()
      return snap.docs.map((d) => d.data() as ActivityDoc)
    }
  }
  try {
    const snap = await col
      .where('dateKey', '>=', startKey)
      .where('dateKey', '<=', endKey)
      .get()
    return snap.docs.map((d) => d.data() as ActivityDoc)
  } catch {
    try {
      const startIso = `${startKey}T00:00:00.000Z`
      const endIso = `${endKey}T23:59:59.999Z`
      const snap = await col
        .where('timestamp', '>=', startIso)
        .where('timestamp', '<=', endIso)
        .get()
      return snap.docs.map((d) => d.data() as ActivityDoc)
    } catch {
      const snap = await col.limit(5000).get()
      return snap.docs
        .map((d) => d.data() as ActivityDoc)
        .filter((a) => {
          const key = a.dateKey || String(a.timestamp || '').slice(0, 10)
          return key >= startKey && key <= endKey
        })
    }
  }
}

async function clubMemberRoleId() {
  const doc = await adminDb.collection(COLLECTIONS.systemSettings).doc('global').get()
  return String(doc.data()?.membership?.clubMemberRoleId || '').trim()
}

async function loadSnapshotStatus() {
  try {
    const doc = await adminDb.collection('bot_state').doc('member_counts_daily').get()
    const state = doc.data() || {}
    const today = memberSnapshotClock().toISOString().slice(0, 10)
    const yesterday = new Date(`${today}T00:00:00Z`)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const expectedDate = yesterday.toISOString().slice(0, 10)
    return {
      lastSuccessAt: state.lastSuccessAt || null,
      lastScheduledSuccessAt: state.lastScheduledSuccessAt || null,
      lastScheduledSuccessDate: state.lastScheduledSuccessDate || null,
      lastError: state.lastError || null,
      missingScheduledDate: state.lastScheduledSuccessDate >= expectedDate ? null : expectedDate,
    }
  } catch {
    return { error: 'Could not load snapshot job status.' }
  }
}

async function loadMemberCounts() {
  try {
    const [snap, roleId] = await Promise.all([
      adminDb.collection(COLLECTIONS.serverMemberCounts).get(),
      clubMemberRoleId().catch(() => ''),
    ])
    const snapshots = snap.docs.map(d => ({ id: d.id, data: d.data() }))
    const series = normalizeMemberHistory(snapshots, roleId)
    const latest = series.length ? series[series.length - 1] : null
    return { series, latest }
  } catch {
    return { series: [] as MemberPoint[], latest: null, error: 'Failed to load member history' }
  }
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.error) return auth.error

  const url = new URL(req.url)
  const selection = parseStatsPeriod(url.searchParams.get('period'))
  const window = getPeriodWindow(selection)
  const { start: rangedStartKey, end: endKey } = window

  const [activities, memberCounts, snapshotStatus] = await Promise.all([
    loadActivities(rangedStartKey, endKey),
    loadMemberCounts(),
    loadSnapshotStatus(),
  ])

  const activityDates = activities
    .map((a) => a.dateKey || String(a.timestamp || '').slice(0, 10))
    .filter(Boolean)
    .sort()
  const firstDay = activityDates[0]
  const startKey = rangedStartKey ?? getHistoryStart(window, firstDay)

  const dates = startKey ? eachDayInclusive(startKey, endKey) : []
  const byDay: Record<string, ActivityPoint> = {}
  for (const day of dates) {
    byDay[day] = { date: day, messages: 0, reactions: 0, voice: 0, interactions: 0, total: 0 }
  }

  const users = new Set<string>()
  const channels = new Set<string>()
  const userTotals: Record<string, {
    user_id: string
    username: string
    messages: number
    reactions: number
    voice: number
    interactions: number
    total: number
  }> = {}
  const channelTotals: Record<string, {
    channel_id: string
    channel_name: string
    messages: number
    reactions: number
    total: number
  }> = {}

  for (const activity of activities) {
    const date = activity.dateKey || String(activity.timestamp || '').slice(0, 10)
    if (!date || !byDay[date]) continue
    const messages = n(activity.rawData?.messageCount)
    const reactions = n(activity.rawData?.reactionCount)
    const voice = n(activity.rawData?.voiceActivityCount)
    const interactions = n(activity.rawData?.interactionCount)
    byDay[date].messages += messages
    byDay[date].reactions += reactions
    byDay[date].voice += voice
    byDay[date].interactions += interactions
    byDay[date].total += n(activity.totalActivities) || messages + reactions + voice + interactions

    const userActivity = activity.summary?.userActivity || {}
    for (const [userId, user] of Object.entries(userActivity)) {
      users.add(userId)
      if (!userTotals[userId]) {
        userTotals[userId] = {
          user_id: userId,
          username: user?.username || 'Unknown',
          messages: 0,
          reactions: 0,
          voice: 0,
          interactions: 0,
          total: 0,
        }
      }
      const row = userTotals[userId]
      if (user?.username && row.username === 'Unknown') row.username = user.username
      row.messages += n(user?.messages)
      row.reactions += n(user?.reactions)
      row.voice += n(user?.voiceActivity)
      row.interactions += n(user?.interactions)
      row.total = row.messages + row.reactions + row.voice + row.interactions
    }

    const channelActivity = activity.summary?.channelActivity || {}
    for (const [channelId, channel] of Object.entries(channelActivity)) {
      channels.add(channelId)
      if (!channelTotals[channelId]) {
        channelTotals[channelId] = {
          channel_id: channelId,
          channel_name: channel?.channelName || 'Unknown',
          messages: 0,
          reactions: 0,
          total: 0,
        }
      }
      const row = channelTotals[channelId]
      if (channel?.channelName && row.channel_name === 'Unknown') row.channel_name = channel.channelName
      row.messages += n(channel?.messages)
      row.reactions += n(channel?.reactions)
      row.total = row.messages + row.reactions
    }
  }

  const daily = dates.map((day) => byDay[day])
  const totalMessages = daily.reduce((s, d) => s + d.messages, 0)
  const totalReactions = daily.reduce((s, d) => s + d.reactions, 0)
  const totalVoice = daily.reduce((s, d) => s + d.voice, 0)
  const totalInteractions = daily.reduce((s, d) => s + d.interactions, 0)
  const daysWithActivity = daily.filter((d) => d.total > 0).length

  const topUsers = Object.values(userTotals)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
  const topChannels = Object.values(channelTotals)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  return NextResponse.json({
    period: { ...window, start: startKey },
    totals: {
      messages: totalMessages,
      reactions: totalReactions,
      voice: totalVoice,
      interactions: totalInteractions,
      uniqueUsers: users.size,
      uniqueChannels: channels.size,
      daysWithActivity,
      avgDailyMessages: Math.round((totalMessages / Math.max(daysWithActivity, 1)) * 10) / 10,
    },
    activity: buildActivitySeries(daily, { ...window, start: startKey }),
    topUsers,
    topChannels,
    members: memberCounts,
    snapshotStatus,
  } satisfies StatsResponse)
}
