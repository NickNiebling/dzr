'use client'

import { Fragment, useEffect, useState } from 'react'
import NextLink from 'next/link'
import AdminShell from '@/components/admin/AdminShell'
import TextTemplatesEditor from '@/components/admin/TextTemplatesEditor'
import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Input,
  SimpleGrid,
  Stat,
  StatHelpText,
  StatLabel,
  StatNumber,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
} from '@chakra-ui/react'

type Gap = { id: string; topic: string; category: string; count: number; lastAt: string | null; status: string }
type Recent = { discordId: string; username: string | null; turns: number; firstAt: string | null; lastAt: string | null; stage: string | null }
type OnboardingRegistration = { step: string; at: string; result: 'sent' | 'dm_closed' }
type OnboardingRecipient = { discordId: string; username: string | null; registrations: OnboardingRegistration[] }
type Data = {
  windowDays: number
  funnel: {
    members: number
    stepSent: Record<string, number>
    dmClosed: number
    replied: number
    askedToLink: number
    linkedWithin7: number
    joinedWithin7: number
  }
  usage: {
    turns: number
    outcomes: Record<string, number>
    tools: Array<{ tool: string; count: number }>
    daily: Array<{ day: string; turns: number; members: number }>
    weekly: Array<{ week: string; members: number }>
  }
  feedback: { up: number; down: number }
  gaps: Gap[]
  recent: Recent[]
  onboardingRecipients: OnboardingRecipient[]
}

const STEP_LABELS: Record<string, string> = {
  join: 'Join greeting',
  intro: 'Channel intro',
  link_zwift_id_channel: 'Link Zwift ID (Discord)',
  link_zwift_id_join: 'Link Zwift ID (/join)',
  meet_verification: 'Other verification criteria',
  become_club_member: 'Become club member',
  club_role_pending: 'Club role pending',
  connect_intervals: '⭐ Club welcome (Coach, intervals.icu, teams)',
}

function pct(part: number, whole: number) {
  return whole ? `${Math.round((100 * part) / whole)}%` : '—'
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

const onboardingTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Copenhagen',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
})

function OnboardingResult({ result }: { result: OnboardingRegistration['result'] }) {
  return <Badge colorScheme={result === 'sent' ? 'green' : 'orange'}>{result === 'sent' ? 'Sent' : 'DM rejected'}</Badge>
}

function OnboardingRecipients({ recipients }: { recipients: OnboardingRecipient[] }) {
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(25)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const query = search.trim().toLowerCase()
  const matching = recipients.filter((recipient) => recipient.discordId.includes(query) || recipient.username?.toLowerCase().includes(query))

  function toggleSteps(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Box as="section" aria-labelledby="onboarding-recipients-heading" mb={8}>
      <Heading id="onboarding-recipients-heading" size="md" mb={1}>Onboarding recipients</Heading>
      <Text color="gray.400" mb={3}>
        All recorded onboarding steps, including members who have not replied. Several steps may belong to the same DM.
        Only records still available are shown. Times are shown in Denmark time (CET/CEST).
      </Text>
      <Input
        type="search"
        aria-label="Search onboarding recipients by name or Discord ID"
        placeholder="Search name or Discord ID"
        value={search}
        onChange={(event) => { setSearch(event.target.value); setVisibleCount(25) }}
        size="sm"
        maxW="md"
        bg="gray.900"
        color="gray.100"
        borderColor="gray.600"
        _placeholder={{ color: 'gray.400' }}
        mb={3}
      />
      <Text color="gray.400" fontSize="sm" mb={2} role="status">
        Showing {Math.min(visibleCount, matching.length)} of {matching.length} members{query ? ' matching your search' : ''}
      </Text>
      <Box overflowX="auto">
        <Table size="sm" minW="52rem" aria-label="Onboarding recipients">
          <Thead>
            <Tr><Th color="gray.400">Member</Th><Th color="gray.400">Latest recorded</Th><Th color="gray.400">Purpose</Th><Th color="gray.400">Result</Th><Th color="gray.400">Details</Th></Tr>
          </Thead>
          <Tbody>
            {matching.slice(0, visibleCount).map((recipient) => {
              const latest = recipient.registrations[0]
              const latestRecords = recipient.registrations.filter((registration) => registration.at === latest.at)
              const purposes = [...new Set(latestRecords.map((registration) => registration.step))]
              const results = [...new Set(latestRecords.map((registration) => registration.result))]
              const expanded = expandedIds.has(recipient.discordId)
              const detailsId = `onboarding-steps-${recipient.discordId}`
              return (
                <Fragment key={recipient.discordId}>
                  <Tr>
                    <Td>
                      {recipient.username ? <Text>{recipient.username}</Text> : null}
                      <Text color={recipient.username ? 'gray.400' : undefined} fontSize="sm">{recipient.discordId}</Text>
                    </Td>
                    <Td whiteSpace="nowrap"><time dateTime={latest.at}>{onboardingTime.format(new Date(latest.at))}</time></Td>
                    <Td>{purposes.map((step) => STEP_LABELS[step] || step).join(' · ')}</Td>
                    <Td><HStack spacing={1} flexWrap="wrap">{results.map((result) => <OnboardingResult key={result} result={result} />)}</HStack></Td>
                    <Td>
                      <Button
                        size="xs"
                        variant="outline"
                        color="gray.200"
                        borderColor="gray.600"
                        _hover={{ bg: 'gray.800' }}
                        _active={{ bg: 'gray.700' }}
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        aria-label={`${expanded ? 'Hide' : 'Show'} steps for ${recipient.username || recipient.discordId}`}
                        onClick={() => toggleSteps(recipient.discordId)}
                      >
                        {expanded ? 'Hide steps' : 'Show steps'}
                      </Button>
                    </Td>
                  </Tr>
                  {expanded ? (
                    <Tr id={detailsId}>
                      <Td colSpan={5} bg="gray.900" py={3}>
                        <Table size="sm" aria-label={`Recorded steps for ${recipient.username || recipient.discordId}`}>
                          <Thead><Tr><Th color="gray.400">Recorded time</Th><Th color="gray.400">Step</Th><Th color="gray.400">Result</Th></Tr></Thead>
                          <Tbody>
                            {recipient.registrations.map((registration) => (
                              <Tr key={`${registration.step}-${registration.result}`}>
                                <Td whiteSpace="nowrap"><time dateTime={registration.at}>{onboardingTime.format(new Date(registration.at))}</time></Td>
                                <Td>{STEP_LABELS[registration.step] || registration.step}</Td>
                                <Td><OnboardingResult result={registration.result} /></Td>
                              </Tr>
                            ))}
                          </Tbody>
                        </Table>
                      </Td>
                    </Tr>
                  ) : null}
                </Fragment>
              )
            })}
            {!matching.length ? <Tr><Td colSpan={5} color="gray.500">{query ? 'No matching members' : 'No onboarding recipients recorded'}</Td></Tr> : null}
          </Tbody>
        </Table>
      </Box>
      {matching.length > visibleCount ? <Button size="sm" mt={3} onClick={() => setVisibleCount((count) => count + 25)}>Show more</Button> : null}
    </Box>
  )
}

function StatBox({ label, value, help }: { label: string; value: string | number; help?: string }) {
  return (
    <Stat borderWidth="1px" borderColor="gray.700" rounded="md" p={4}>
      <StatLabel color="gray.400">{label}</StatLabel>
      <StatNumber>{value}</StatNumber>
      {help ? <StatHelpText color="gray.500">{help}</StatHelpText> : null}
    </Stat>
  )
}

export default function OnboardingAdminPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/onboarding', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to load')
      setData(body)
    } catch (err: any) {
      setError(err?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function setGapStatus(id: string, status: 'open' | 'solved') {
    const res = await fetch('/api/admin/onboarding', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    if (res.ok) await load()
  }

  useEffect(() => {
    load().catch(() => {})
  }, [])

  const f = data?.funnel
  const u = data?.usage
  const openGaps = (data?.gaps || []).filter((g) => g.status === 'open')
  const solvedGaps = (data?.gaps || []).filter((g) => g.status !== 'open')

  return (
    <AdminShell title="Onboarding & bot DMs">
      <HStack justify="space-between" mb={4}>
        <Text color="gray.400">
          Onboarding DMs from the club bot, and how members use and rate the bot in DMs. Metadata only: no message text is stored.
          Test users (reset with /onboarding_reset) are left out.
        </Text>
        <Button size="sm" onClick={() => load()} isLoading={loading}>Refresh</Button>
      </HStack>
      {error ? <Text color="red.300" mb={4}>{error}</Text> : null}

      {f ? (
        <>
          <Heading size="md" mb={3}>Onboarding funnel</Heading>
          <SimpleGrid columns={{ base: 1, md: 3, lg: 5 }} spacing={4} mb={4}>
            <StatBox label="Members who got DMs" value={f.members} help={f.dmClosed ? `${f.dmClosed} with DMs closed` : undefined} />
            <StatBox label="Replied to the bot" value={f.replied} help={pct(f.replied, f.members)} />
            <StatBox label="Linked Zwift ID ≤ 7 days" value={`${f.linkedWithin7} / ${f.askedToLink}`} help={pct(f.linkedWithin7, f.askedToLink)} />
            <StatBox label="Club member ≤ 7 days of first DM" value={`${f.joinedWithin7} / ${f.members}`} help={pct(f.joinedWithin7, f.members)} />
            <StatBox label="👍 / 👎 (last 30 days)" value={`${data?.feedback.up ?? 0} / ${data?.feedback.down ?? 0}`} />
          </SimpleGrid>
          <Box overflowX="auto" mb={8}>
            <Table size="sm">
              <Thead><Tr><Th color="gray.400">Step DM</Th><Th color="gray.400" isNumeric>Sent</Th></Tr></Thead>
              <Tbody>
                {Object.entries(STEP_LABELS).map(([key, label]) => (
                  <Tr key={key}><Td>{label}</Td><Td isNumeric>{f.stepSent[key] || 0}</Td></Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        </>
      ) : null}

      {data ? <OnboardingRecipients recipients={data.onboardingRecipients || []} /> : null}

      <TextTemplatesEditor
        apiPath="/api/admin/onboarding/texts"
        title="Onboarding DM texts"
        description="The DMs the bot sends new members, one per onboarding step. Preview one in Discord with /onboarding_preview."
      />
      <TextTemplatesEditor
        apiPath="/api/admin/announcer/reminders"
        title="DM reminder texts"
        description="The reminders the bot sends members who are stuck on a step, when they are active on the server. Preview one in Discord with /announcer_preview_dm."
        disabledNote="DM reminders are currently switched off (Announcer page)."
      />

      {u ? (
        <>
          <Heading size="md" mb={3}>Bot DM usage (last {data?.windowDays} days)</Heading>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6} mb={8}>
            <Box>
              <Text color="gray.400" mb={2}>{u.turns} DM turns · outcomes: {Object.entries(u.outcomes).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}</Text>
              <Table size="sm">
                <Thead><Tr><Th color="gray.400">Week</Th><Th color="gray.400" isNumeric>Members using DMs</Th></Tr></Thead>
                <Tbody>
                  {u.weekly.map((w) => <Tr key={w.week}><Td>{w.week}</Td><Td isNumeric>{w.members}</Td></Tr>)}
                </Tbody>
              </Table>
            </Box>
            <Box>
              <Table size="sm">
                <Thead><Tr><Th color="gray.400">Tool used</Th><Th color="gray.400" isNumeric>Turns</Th></Tr></Thead>
                <Tbody>
                  {u.tools.slice(0, 15).map((t) => <Tr key={t.tool}><Td>{t.tool}</Td><Td isNumeric>{t.count}</Td></Tr>)}
                  {!u.tools.length ? <Tr><Td colSpan={2} color="gray.500">No tools used yet</Td></Tr> : null}
                </Tbody>
              </Table>
            </Box>
          </SimpleGrid>
        </>
      ) : null}

      {data ? (
        <>
          <Heading size="md" mb={1}>Knowledge gaps</Heading>
          <Text color="gray.400" mb={3}>
            Questions the assistant could not answer, summarised by the assistant (never quoted). Write an article, then mark the gap solved.
          </Text>
          <Box overflowX="auto" mb={8}>
            <Table size="sm">
              <Thead>
                <Tr><Th color="gray.400">Topic</Th><Th color="gray.400">Category</Th><Th color="gray.400" isNumeric>Asked</Th><Th color="gray.400">Last</Th><Th /></Tr>
              </Thead>
              <Tbody>
                {[...openGaps, ...solvedGaps].map((g) => (
                  <Tr key={g.id} opacity={g.status === 'open' ? 1 : 0.5}>
                    <Td>{g.topic}</Td>
                    <Td><Badge>{g.category}</Badge></Td>
                    <Td isNumeric>{g.count}</Td>
                    <Td>{fmtTime(g.lastAt)}</Td>
                    <Td>
                      <HStack spacing={2} justify="flex-end">
                        {g.status === 'open' ? (
                          <>
                            <Button as={NextLink} href={`/admin/knowledge?title=${encodeURIComponent(g.topic)}`} size="xs" colorScheme="red">Create article</Button>
                            <Button size="xs" onClick={() => setGapStatus(g.id, 'solved')}>Mark solved</Button>
                          </>
                        ) : (
                          <Button size="xs" variant="ghost" onClick={() => setGapStatus(g.id, 'open')}>Reopen</Button>
                        )}
                      </HStack>
                    </Td>
                  </Tr>
                ))}
                {!data.gaps.length ? <Tr><Td colSpan={5} color="gray.500">No gaps reported</Td></Tr> : null}
              </Tbody>
            </Table>
          </Box>

          <Heading size="md" mb={3}>Recent DM users</Heading>
          <Box overflowX="auto">
            <Table size="sm">
              <Thead>
                <Tr><Th color="gray.400">Member</Th><Th color="gray.400">Onboarding stage</Th><Th color="gray.400" isNumeric>Turns</Th><Th color="gray.400">First</Th><Th color="gray.400">Last</Th></Tr>
              </Thead>
              <Tbody>
                {data.recent.map((r) => (
                  <Tr key={r.discordId}>
                    <Td>{r.username || r.discordId}</Td>
                    <Td>{r.stage ? STEP_LABELS[r.stage] || r.stage : '—'}</Td>
                    <Td isNumeric>{r.turns}</Td>
                    <Td>{fmtTime(r.firstAt)}</Td>
                    <Td>{fmtTime(r.lastAt)}</Td>
                  </Tr>
                ))}
                {!data.recent.length ? <Tr><Td colSpan={5} color="gray.500">No DM conversations yet</Td></Tr> : null}
              </Tbody>
            </Table>
          </Box>
        </>
      ) : null}
    </AdminShell>
  )
}
