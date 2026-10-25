'use client'

import { memberSnapshotClock } from '@/app/lib/memberSnapshotClock'

import { useCallback, useEffect, useState } from 'react'
import AdminShell from '@/components/admin/AdminShell'
import ChartCard from '@/components/admin/stats/ChartCard'
import KpiCard from '@/components/admin/stats/KpiCard'
import PeriodToggle from '@/components/admin/stats/PeriodToggle'
import { StatsPeriod, getPeriodWindow, periodLabel } from '@/app/lib/statsPeriods'
import { buildChartTimeline, buildSnapshotTimeline } from '@/app/lib/statsTimeline'
import { buildMemberTimeline, findMissingMemberObservations } from '@/app/lib/statsMemberHistory'
import MissingObservations from '@/components/admin/stats/MissingObservations'
import RankingTable from '@/components/admin/stats/RankingTable'
import { ActivityChart, BreakdownDonut, GrowthChart, MembersChart, type GrowthChartPoint } from '@/components/admin/stats/charts'
import type { GrowthResponse, StatsResponse } from '@/app/lib/statsTypes'
import { Box, Button, Flex, HStack, SimpleGrid, Text, useToast } from '@chakra-ui/react'

function fmt(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—'
  return Number(n).toLocaleString()
}

function fmtDay(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function mergeGrowthSeries(
  zwift: { day: string; cumulative: number }[],
  zwiftpower: { day: string; cumulative: number }[],
): GrowthChartPoint[] {
  const zpByDay = new Map(zwiftpower.map((p) => [p.day, p.cumulative]))
  const days = [...new Set([...zwift.map((p) => p.day), ...zwiftpower.map((p) => p.day)])].sort()
  const zwiftByDay = new Map(zwift.map((p) => [p.day, p.cumulative]))
  let lastZp: number | null = null
  let lastZwift: number | null = null
  return days.map((day) => {
    if (zwiftByDay.has(day)) lastZwift = zwiftByDay.get(day) ?? null
    if (zpByDay.has(day)) lastZp = zpByDay.get(day) ?? null
    return { date: day, zwift: lastZwift, zwiftpower: lastZp }
  })
}

export default function StatsAdminPage() {
  const toast = useToast()
  const [growthPeriod, setGrowthPeriod] = useState<StatsPeriod>(StatsPeriod.All)
  const [memberPeriod, setMemberPeriod] = useState<StatsPeriod>(StatsPeriod.All)
  const [activityPeriod, setActivityPeriod] = useState<StatsPeriod>(StatsPeriod.Last30Days)
  const [growth, setGrowth] = useState<GrowthResponse | null>(null)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [growthError, setGrowthError] = useState<string | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [loadingGrowth, setLoadingGrowth] = useState(true)
  const [loadingStats, setLoadingStats] = useState(true)
  const [busy, setBusy] = useState(false)
  const [savingSnapshot, setSavingSnapshot] = useState(false)
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null)

  const loadGrowth = useCallback(async () => {
    setLoadingGrowth(true)
    setGrowthError(null)
    try {
      const res = await fetch('/api/admin/growth', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to load club growth')
      setGrowth(body)
    } catch (err: any) {
      setGrowthError(err?.message || 'Failed to load club growth')
    } finally {
      setLoadingGrowth(false)
    }
  }, [])

  const loadStats = useCallback(async (period: StatsPeriod) => {
    setLoadingStats(true)
    setStatsError(null)
    try {
      const res = await fetch(`/api/admin/stats?period=${period}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to load Discord stats')
      setStats(body)
    } catch (err: any) {
      setStatsError(err?.message || 'Failed to load Discord stats')
    } finally {
      setLoadingStats(false)
    }
  }, [])

  useEffect(() => { loadGrowth().catch(() => {}) }, [loadGrowth])
  useEffect(() => { loadStats(activityPeriod).catch(() => {}) }, [activityPeriod, loadStats])

  async function saveSnapshot() {
    setSavingSnapshot(true)
    setSnapshotMessage(null)
    try {
      const res = await fetch('/api/admin/stats/snapshot', { method: 'POST' })
      const body = await res.json()
      if (!res.ok || body.status !== 'saved') {
        throw new Error(`${body.error || 'Snapshot was not saved.'}${body.stage ? ` (${body.stage})` : ''}${body.runId ? ` · Reference: ${body.runId}` : ''}`)
      }
      setSnapshotMessage(`Saved ${body.dateKey} at ${body.timestamp}: Discord ${body.memberCount}, club member role ${body.clubMemberCount}.`)
    } catch (error) {
      setSnapshotMessage(error instanceof Error ? error.message : 'Snapshot request failed.')
    } finally {
      await loadStats(activityPeriod)
      setSavingSnapshot(false)
    }
  }

  async function refresh(kind: 'zwift' | 'zwiftpower') {
    setBusy(true)
    const res = await fetch(`/api/admin/growth?kind=${kind}`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    toast({ title: res.ok ? 'Refresh started' : (body.error || 'Failed'), status: res.ok ? 'success' : 'error' })
    if (res.ok) loadGrowth()
  }

  const totals = stats?.totals
  const hasActivity = (totals?.messages || 0) + (totals?.reactions || 0) + (totals?.voice || 0) + (totals?.interactions || 0) > 0
  const now = new Date()
  const memberNow = memberSnapshotClock(now)
  const memberTimeline = buildMemberTimeline(stats?.members.series || [], getPeriodWindow(memberPeriod, memberNow), memberNow)
  const missingObservations = !loadingStats && !statsError && !stats?.members.error
    ? findMissingMemberObservations(stats?.members.series || [], memberTimeline, memberNow)
    : []
  const activityTimeline = buildChartTimeline(stats?.activity || [], stats?.period || getPeriodWindow(activityPeriod, now))
  const latestMembers = stats?.members?.latest
  const growthTimeline = buildSnapshotTimeline(
    mergeGrowthSeries(growth?.series || [], growth?.zwiftpower?.series || []),
    getPeriodWindow(growthPeriod, now),
    now,
  )
  const zpTotal = growth?.zwiftpower?.total
  const clubRoleCount = latestMembers?.clubMembers

  return (
    <AdminShell title="Stats">
      {(growthError || statsError || stats?.members.error) && (
        <Text color="red.300" mb={4} fontSize="sm">
          {[growthError, statsError, stats?.members.error].filter(Boolean).join(' · ')}
        </Text>
      )}

      <SimpleGrid columns={{ base: 2, lg: 4 }} spacing={4} mb={4}>
        <KpiCard
          label="Club members"
          value={fmt(growth?.total)}
          helper={[
            zpTotal != null ? `ZwiftPower ${fmt(zpTotal)}${growth?.zwiftpower?.estimated ? ' (est.)' : ''}` : null,
            growth?.firstJoinDate ? `First join ${fmtDay(growth.firstJoinDate)}` : null,
          ].filter(Boolean).join(' · ') || 'Companion club roster'}
          loading={loadingGrowth && !growth}
        />
        <KpiCard
          label="Discord members"
          value={fmt(latestMembers?.members)}
          helper={[
            latestMembers?.members === null ? 'Discord total unavailable for this snapshot' : null,
            latestMembers?.presence != null ? `${fmt(latestMembers.presence)} online` : null,
            clubRoleCount != null ? `${fmt(clubRoleCount)} club member role` : null,
          ].filter(Boolean).join(' · ') || (latestMembers?.date ? `Snapshot ${fmtDay(latestMembers.date)}` : 'Server member count')}
          loading={loadingStats && !stats}
        />
        <KpiCard
          label="Messages"
          value={fmt(totals?.messages)}
          helper={`${fmt(totals?.avgDailyMessages)} / day · ${periodLabel(activityPeriod)}`}
          loading={loadingStats && !stats}
        />
        <KpiCard
          label="Active users"
          value={fmt(totals?.uniqueUsers)}
          helper={`${fmt(totals?.uniqueChannels)} channels · ${fmt(totals?.interactions)} commands`}
          loading={loadingStats && !stats}
        />
      </SimpleGrid>

      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4} mb={4}>
        <ChartCard
          title="Club growth"
          loading={loadingGrowth && !growth}
          isEmpty={!growthTimeline.points.length}
          empty="No companion club members yet. Refresh the Zwift roster to sync."
          actions={(
            <HStack spacing={2} flexWrap="wrap" justify="flex-end">
              <PeriodToggle value={growthPeriod} onChange={setGrowthPeriod} />
              <Button size="xs" colorScheme="red" onClick={() => refresh('zwift')} isLoading={busy}>Refresh Zwift</Button>
              <Button
                size="xs"
                colorScheme="red"
                variant="outline"
                borderColor="red.400"
                color="red.200"
                _hover={{ bg: 'whiteAlpha.100', borderColor: 'red.300', color: 'red.100' }}
                onClick={() => refresh('zwiftpower')}
                isLoading={busy}
              >
                Refresh ZwiftPower
              </Button>
            </HStack>
          )}
        >
          <GrowthChart timeline={growthTimeline} />
        </ChartCard>
        <ChartCard
          title="Discord members"
          loading={loadingStats && !stats}
          isEmpty={memberTimeline.points.length < 1}
          empty="No member snapshots yet. Use Save snapshot now or wait for the daily collection."
          actions={(
            <HStack flexWrap="wrap" justify="flex-end">
              <PeriodToggle value={memberPeriod} onChange={setMemberPeriod} />
              <Button size="xs" onClick={saveSnapshot} isLoading={savingSnapshot}>Save snapshot now</Button>
            </HStack>
          )}
        >
          <MembersChart timeline={memberTimeline} />
        </ChartCard>
      </SimpleGrid>

      <Box mb={4} fontSize="sm" color="gray.300" aria-live="polite">
        <Text>Member snapshots: daily at 23:45 Europe/Copenhagen. Retries continue until midnight.</Text>
        <Text>Last saved: {stats?.snapshotStatus?.lastSuccessAt || 'None recorded'} · Last automatic success: {stats?.snapshotStatus?.lastScheduledSuccessAt || 'None recorded'}</Text>
        {stats?.snapshotStatus?.missingScheduledDate && <Text color="orange.300">No successful automatic run recorded for {stats.snapshotStatus.missingScheduledDate}.</Text>}
        {stats?.snapshotStatus?.error && <Text color="red.300">{stats.snapshotStatus.error}</Text>}
        {stats?.snapshotStatus?.lastError && <Text color="red.300">Last collection error ({stats.snapshotStatus.lastError.stage}): {stats.snapshotStatus.lastError.message} · {stats.snapshotStatus.lastError.at} · Reference: {stats.snapshotStatus.lastError.runId}</Text>}
        {snapshotMessage && <Text>{snapshotMessage}</Text>}
      </Box>

      <Flex gap={4} direction={{ base: 'column', lg: 'row' }} mb={4}>
        <Box flex="2">
          <ChartCard
            title="Discord activity"
            loading={loadingStats && !stats}
            isEmpty={!hasActivity}
            empty="No activity in this window"
            actions={<PeriodToggle value={activityPeriod} onChange={setActivityPeriod} />}
          >
            <ActivityChart timeline={activityTimeline} />
          </ChartCard>
        </Box>
        <Box flex="1">
          <ChartCard
            title="Breakdown"
            loading={loadingStats && !stats}
            isEmpty={!hasActivity}
            empty="No activity in this window"
            actions={<PeriodToggle value={activityPeriod} onChange={setActivityPeriod} />}
          >
            <BreakdownDonut
              messages={totals?.messages || 0}
              reactions={totals?.reactions || 0}
              voice={totals?.voice || 0}
              interactions={totals?.interactions || 0}
            />
          </ChartCard>
        </Box>
      </Flex>

      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4}>
        <RankingTable
          title="Top users"
          loading={loadingStats && !stats}
          empty="No active users in this window"
          actions={<PeriodToggle value={activityPeriod} onChange={setActivityPeriod} />}
          rows={(stats?.topUsers || []).map((u) => ({
            id: u.user_id,
            name: u.username || u.user_id,
            total: u.total,
            detail: `${fmt(u.messages)} msg · ${fmt(u.reactions)} rxn`,
          }))}
        />
        <RankingTable
          title="Top channels"
          loading={loadingStats && !stats}
          empty="No channel activity in this window"
          actions={<PeriodToggle value={activityPeriod} onChange={setActivityPeriod} />}
          rows={(stats?.topChannels || []).map((c) => ({
            id: c.channel_id,
            name: c.channel_name ? `#${c.channel_name}` : c.channel_id,
            total: c.total,
            detail: `${fmt(c.messages)} msg · ${fmt(c.reactions)} rxn`,
          }))}
        />
      </SimpleGrid>
      <MissingObservations ranges={missingObservations} />
    </AdminShell>
  )
}
