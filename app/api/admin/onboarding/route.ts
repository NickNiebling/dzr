import { NextResponse } from 'next/server'
import { FieldPath } from 'firebase-admin/firestore'
import { requireAdmin } from '@/app/api/admin/_lib/auth'
import { adminDb } from '@/app/utils/firebaseAdminConfig'
import { COLLECTIONS } from '@/app/lib/sharedConstants'
import { toIso } from '@/app/lib/intervalsAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 30
const STEP_KEYS = [
  'join',
  'intro',
  'link_zwift_id_channel',
  'link_zwift_id_join',
  'meet_verification',
  'become_club_member',
  'club_role_pending',
  'connect_intervals',
] as const

type OnboardingRegistration = { step: string; at: string; result: 'sent' | 'dm_closed' }

function ms(value: unknown): number | null {
  try {
    const iso = toIso(value)
    if (!iso) return null
    const t = new Date(iso).getTime()
    return Number.isNaN(t) ? null : t
  } catch {
    return null
  }
}

function within7Days(from: number | null, to: number | null) {
  return from != null && to != null && to >= from && to - from <= 7 * DAY_MS
}

/** ISO week label (e.g. 2026-W44) for a YYYY-MM-DD day. */
function isoWeek(day: string) {
  const date = new Date(`${day}T00:00:00Z`)
  const weekday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - weekday + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * Onboarding DMs and club-bot DM usage. Everything here is metadata the bot recorded: no message
 * or reply text exists in these collections. Members marked test (via /onboarding_reset) are left out.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.error) return auth.error

  const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS)
  const sinceDay = since.toISOString().slice(0, 10)
  const [onboardingSnap, eventsSnap, dailySnap, usageSnap, feedbackSnap, gapsSnap] = await Promise.all([
    adminDb.collection(COLLECTIONS.onboardingDms).get(),
    adminDb.collection(COLLECTIONS.assistantDmEvents).where('at', '>=', since).get(),
    adminDb.collection(COLLECTIONS.assistantDmDaily).where(FieldPath.documentId(), '>=', sinceDay).get(),
    adminDb.collection(COLLECTIONS.assistantDmUsage).orderBy('lastAt', 'desc').limit(60).get(),
    adminDb.collection(COLLECTIONS.assistantDmFeedback).where('at', '>=', since).get(),
    adminDb.collection(COLLECTIONS.assistantKnowledgeGaps).get(),
  ])

  // Funnel: sent -> replied -> Zwift ID linked / club joined within 7 days of the DM that asked for it.
  const testIds = new Set<string>()
  const stepSent: Record<string, number> = Object.fromEntries(STEP_KEYS.map((k) => [k, 0]))
  const stageById = new Map<string, string>()
  const onboardingRows: Array<{ discordId: string; registrations: OnboardingRegistration[] }> = []
  let members = 0
  let dmClosed = 0
  let replied = 0
  let askedToLink = 0
  let linkedWithin7 = 0
  let joinedWithin7 = 0
  onboardingSnap.forEach((doc) => {
    const d = doc.data() || {}
    if (d.test) {
      testIds.add(doc.id)
      return
    }
    const steps = (d.steps || {}) as Record<string, any>
    const sentAt = (key: string) => ms(steps[key]?.sentAt)
    if (!Object.values(steps).some((s: any) => s?.sentAt || s?.dmFailedAt)) return
    members++
    let latest: { key: string; at: number } | null = null
    let firstDm: number | null = null
    const registrations: OnboardingRegistration[] = []
    for (const key of STEP_KEYS) {
      const at = sentAt(key)
      if (at != null) {
        registrations.push({ step: key, at: new Date(at).toISOString(), result: 'sent' })
        stepSent[key]++
        if (!latest || at > latest.at) latest = { key, at }
        if (firstDm == null || at < firstDm) firstDm = at
      }
      const failedAt = ms(steps[key]?.dmFailedAt)
      if (failedAt != null) {
        registrations.push({ step: key, at: new Date(failedAt).toISOString(), result: 'dm_closed' })
      }
    }
    if (registrations.length) {
      registrations.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      onboardingRows.push({ discordId: doc.id, registrations })
    }
    // Per member, not per step: one member with closed DMs can fail several steps.
    if (STEP_KEYS.some((key) => steps[key]?.dmFailedAt)) dmClosed++
    if (latest) stageById.set(doc.id, latest.key)
    if (d.firstReplyAt) replied++
    const linkAsked = [sentAt('link_zwift_id_channel'), sentAt('link_zwift_id_join')].filter((t): t is number => t != null)
    if (linkAsked.length) {
      askedToLink++
      if (within7Days(Math.min(...linkAsked), ms(d.zwiftLinkedAt))) linkedWithin7++
    }
    // From the first DM, not from the "become a club member" DM: on /join members pay before they
    // ever need that DM, and they are the ones the onboarding should count.
    if (within7Days(firstDm, ms(d.clubJoinedAt))) joinedWithin7++
  })

  // DM turns: tools, outcomes, per-day counts (last 30 days).
  const toolCounts: Record<string, number> = {}
  const outcomes: Record<string, number> = {}
  let turns = 0
  eventsSnap.forEach((doc) => {
    const e = doc.data() || {}
    if (e.test || testIds.has(String(e.discordId))) return
    turns++
    outcomes[e.outcome || 'unknown'] = (outcomes[e.outcome || 'unknown'] || 0) + 1
    for (const tool of (e.toolsUsed || []) as string[]) toolCounts[tool] = (toolCounts[tool] || 0) + 1
  })

  const daily: Array<{ day: string; turns: number; members: number }> = []
  const weekMembers = new Map<string, Set<string>>()
  dailySnap.forEach((doc) => {
    const d = doc.data() || {}
    const ids = ((d.members || []) as string[]).filter((id) => !testIds.has(id))
    daily.push({ day: doc.id, turns: Number(d.turns || 0), members: ids.length })
    const week = isoWeek(doc.id)
    const set = weekMembers.get(week) || new Set<string>()
    ids.forEach((id) => set.add(id))
    weekMembers.set(week, set)
  })
  daily.sort((a, b) => a.day.localeCompare(b.day))

  let up = 0
  let down = 0
  feedbackSnap.forEach((doc) => {
    const f = doc.data() || {}
    if (testIds.has(String(f.discordId))) return
    if (f.rating > 0) up++
    else if (f.rating < 0) down++
  })

  const gaps: Array<{ id: string; topic: string; category: string; count: number; lastAt: string | null; status: string }> = []
  gapsSnap.forEach((doc) => {
    const g = doc.data() || {}
    gaps.push({ id: doc.id, topic: g.topic || '', category: g.category || 'other', count: Number(g.count || 0), lastAt: toIso(g.lastAt), status: g.status || 'open' })
  })
  gaps.sort((a, b) => (a.status === b.status ? b.count - a.count : a.status === 'open' ? -1 : 1))

  // Recipient records include members who never replied and are not limited to the usage window.
  onboardingRows.sort((a, b) => Date.parse(b.registrations[0].at) - Date.parse(a.registrations[0].at) || a.discordId.localeCompare(b.discordId))

  // Share batched name lookups between onboarding recipients and recent DM users.
  const recentRows = usageSnap.docs.filter((doc) => !doc.data()?.test && !testIds.has(doc.id)).slice(0, 30)
  const userIds = [...new Set([...onboardingRows.map((row) => row.discordId), ...recentRows.map((doc) => doc.id)])]
  const nameById = new Map<string, string>()
  try {
    for (let offset = 0; offset < userIds.length; offset += 100) {
      const refs = userIds.slice(offset, offset + 100).map((id) => adminDb.collection(COLLECTIONS.users).doc(id))
      const userDocs = await adminDb.getAll(...refs, { fieldMask: ['username'] })
      for (const doc of userDocs) {
        const username = doc.data()?.username
        if (typeof username === 'string' && username.trim()) nameById.set(doc.id, username)
      }
    }
  } catch {
    // Names only enrich the report. A lookup failure must not hide recipient records.
    console.warn('admin/onboarding: could not load member names')
  }
  const onboardingRecipients = onboardingRows.map((row) => ({ ...row, username: nameById.get(row.discordId) || null }))
  const recent = recentRows.map((doc) => {
    const u = doc.data() || {}
    return {
      discordId: doc.id,
      username: nameById.get(doc.id) || null,
      turns: Number(u.turns || 0),
      firstAt: toIso(u.firstAt),
      lastAt: toIso(u.lastAt),
      stage: stageById.get(doc.id) || null,
    }
  })

  return NextResponse.json({
    windowDays: WINDOW_DAYS,
    funnel: { members, stepSent, dmClosed, replied, askedToLink, linkedWithin7, joinedWithin7 },
    usage: {
      turns,
      outcomes,
      tools: Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).map(([tool, count]) => ({ tool, count })),
      daily,
      weekly: [...weekMembers].sort((a, b) => a[0].localeCompare(b[0])).map(([week, set]) => ({ week, members: set.size })),
    },
    feedback: { up, down },
    gaps,
    recent,
    onboardingRecipients,
  })
}

/** Mark a knowledge gap solved (an article now covers it) or open again. */
export async function PATCH(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.error) return auth.error
  const body = await req.json().catch(() => ({}))
  const id = String(body?.id || '')
  const status = body?.status === 'solved' ? 'solved' : body?.status === 'open' ? 'open' : null
  if (!id || !status || id.includes('/')) return NextResponse.json({ error: 'id and status (open|solved) required' }, { status: 400 })
  const ref = adminDb.collection(COLLECTIONS.assistantKnowledgeGaps).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await ref.set({ status, statusAt: new Date() }, { merge: true })
  return NextResponse.json({ ok: true })
}
