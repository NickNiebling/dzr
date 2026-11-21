'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Select,
  Stack,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
} from '@chakra-ui/react'
import { FiftyDetail, FiftyStatus, type FiftyPanel, type SavedEvent } from '@/app/admin/events/FiftyResults'
import GroupRide from '@/app/admin/events/GroupRide'

type SeriesDate = {
  date: string
  label: string
  route: string
  overridden: boolean
  eventId: string
  publishedRoute: string
  feedEventId: number | null
}

type SeriesView = {
  id: 'after-party' | 'zwifty-fifty'
  name: string
  routes: string[]
  dates: SeriesDate[]
  error: string
  feedUnavailable: boolean
  primeRoutes?: string[]
  automation?: string[]
}

const readableOutline = {
  variant: 'outline' as const,
  color: 'white',
  borderColor: 'whiteAlpha.600',
  _hover: { bg: 'whiteAlpha.200' },
}

async function errorMessage(res: Response) {
  const body = await res.json().catch(() => ({}))
  return String(body?.error || body?.message || `Request failed (${res.status})`)
}

type SeriesMessage = { error: string; notice: string }
type ScheduleRow = SeriesDate & {
  strong: boolean
  past: boolean
  resultsFix: SavedEvent['resultsFix']
  primesFix: SavedEvent['primesFix']
}

function scheduleRows(dates: SeriesDate[], saved: SavedEvent[]): ScheduleRow[] {
  const savedByDate = new Map(saved.map((event) => [event.date, event]))
  const pending = dates.filter((row) => !row.eventId).sort((a, b) => a.date.localeCompare(b.date))
  const nextDate = pending[0]?.date
  const upcoming = (nextDate ? dates.filter((row) => row.date >= nextDate) : dates).sort((a, b) =>
    a.date.localeCompare(b.date)
  )
  const earlier = nextDate ? dates.filter((row) => row.date < nextDate) : []
  const known = new Set(dates.map((row) => row.date))
  const older = saved.filter((event) => !known.has(event.date))
  const asRow = (row: SeriesDate, strong: boolean, past: boolean): ScheduleRow => {
    const match = savedByDate.get(row.date)
    return {
      ...row,
      strong,
      past,
      resultsFix: match?.resultsFix || null,
      primesFix: match?.primesFix || null,
    }
  }
  return [
    ...upcoming.map((row) => asRow(row, row.date === nextDate, false)),
    ...earlier
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((row) => asRow(row, false, true)),
    ...older
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((event) => ({
        date: event.date,
        label: event.label,
        route: event.route,
        overridden: false,
        eventId: event.eventId,
        publishedRoute: event.route,
        feedEventId: null,
        strong: false,
        past: true,
        resultsFix: event.resultsFix,
        primesFix: event.primesFix,
      })),
  ]
}

export default function WeeklySeries() {
  const [series, setSeries] = useState<SeriesView[]>([])
  const [savedBySeries, setSavedBySeries] = useState<Record<string, SavedEvent[]>>({})
  const [loadError, setLoadError] = useState('')
  const [messages, setMessages] = useState<Record<string, SeriesMessage>>({})
  const [busy, setBusy] = useState('')
  const [fiftyOpen, setFiftyOpen] = useState<{ id: string; panel: FiftyPanel } | null>(null)

  function setMessage(seriesId: string, message: SeriesMessage) {
    setMessages((current) => ({ ...current, [seriesId]: message }))
  }

  async function loadSaved() {
    const ids = ['after-party', 'zwifty-fifty'] as const
    const loaded = await Promise.all(
      ids.map(async (seriesId) => {
        const res = await fetch(`/api/admin/events/results?series=${seriesId}`, { cache: 'no-store' })
        if (!res.ok) return [seriesId, []] as const
        const body = await res.json()
        return [seriesId, Array.isArray(body.events) ? body.events : []] as const
      })
    )
    setSavedBySeries(Object.fromEntries(loaded))
  }

  async function load() {
    const res = await fetch('/api/admin/events/series', { cache: 'no-store' })
    if (!res.ok) {
      setLoadError(await errorMessage(res))
      return
    }
    const body = await res.json()
    setSeries(Array.isArray(body.series) ? body.series : [])
    await loadSaved()
  }

  useEffect(() => {
    void load()
  }, [])

  async function saveOverride(seriesId: string, date: string, route: string) {
    setBusy(`${seriesId}:${date}`)
    setMessage(seriesId, { error: '', notice: '' })
    const res = await fetch('/api/admin/events/series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ series: seriesId, date, route }),
    })
    setBusy('')
    if (!res.ok) {
      setMessage(seriesId, { error: await errorMessage(res), notice: '' })
      return
    }
    const body = await res.json()
    setSeries(Array.isArray(body.series) ? body.series : [])
  }

  async function apply(item: SeriesView, row: SeriesDate) {
    const changed =
      row.eventId && row.publishedRoute && row.publishedRoute !== row.route
        ? ` The site still shows ${row.publishedRoute} until this is applied.`
        : ''
    if (
      !window.confirm(
        `Update the ${row.label} ${item.name} to ${row.route}? This sets the Zwift event, the site, and the Discord post.${changed}`
      )
    ) {
      return
    }
    setBusy(`apply:${item.id}:${row.date}`)
    setMessage(item.id, { error: '', notice: '' })
    const res = await fetch('/api/admin/events/series/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ series: item.id, date: row.date }),
    })
    setBusy('')
    if (!res.ok) {
      setMessage(item.id, { error: await errorMessage(res), notice: '' })
      return
    }
    const body = await res.json()
    setSeries(Array.isArray(body.series) ? body.series : [])
    setMessage(item.id, {
      error: '',
      notice: body.discordError
        ? `Saved ${row.label}. Discord post failed: ${body.discordError}`
        : `Saved ${row.label}. Discord post sent.`,
    })
    await loadSaved()
  }

  return (
    <Stack spacing={6} mb={10}>
      <Flex justify="space-between" align="center" gap={3} wrap="wrap">
        <Heading size="md">Weekly series</Heading>
        <Flex gap={2}>
          <Button as={Link} href="/admin/events/series" {...readableOutline} size="sm">
            Event series
          </Button>
          <Button as={Link} href="/admin/events/routes" {...readableOutline} size="sm">
            Route setup
          </Button>
        </Flex>
      </Flex>
      {loadError ? <Text color="red.300">{loadError}</Text> : null}
      {series.map((item) => {
        const message = messages[item.id]
        const primeRoutes = item.primeRoutes || []
        const showZwiftPower = item.id === 'zwifty-fifty' || primeRoutes.length > 0
        const rows = scheduleRows(item.dates, savedBySeries[item.id] || [])
        const columns = showZwiftPower ? 5 : 4
        return (
          <Box key={item.id} borderWidth="1px" borderColor="gray.700" rounded="md" p={4}>
            <Heading size="sm" mb={3}>
              {item.name}
            </Heading>
            {item.automation?.length ? (
              <Stack spacing={1} mb={3}>
                {item.automation.map((line, index) => (
                  <Text key={`${item.id}-${index}`} color="gray.300" fontSize="sm">
                    {line}
                  </Text>
                ))}
              </Stack>
            ) : null}
            {item.error ? (
              <Text color="red.300" mb={3}>
                {item.error}
              </Text>
            ) : null}
            {message?.error ? (
              <Text color="red.300" mb={3}>
                {message.error}
              </Text>
            ) : null}
            {message?.notice ? (
              <Text color="green.300" mb={3}>
                {message.notice}
              </Text>
            ) : null}
            {item.feedUnavailable ? (
              <Text color="orange.300" mb={3}>
                The public event list is unavailable, so Apply cannot see a new event yet.
              </Text>
            ) : null}
            <Box overflowX="auto">
              <Table size="sm" variant="unstyled">
                <Thead>
                  <Tr>
                    <Th color="gray.500">Date</Th>
                    <Th color="gray.500">Route</Th>
                    <Th color="gray.500">Status</Th>
                    <Th color="gray.500" />
                    {showZwiftPower ? <Th color="gray.500">ZwiftPower</Th> : null}
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((row) => {
                    const open = row.eventId && fiftyOpen?.id === row.eventId ? fiftyOpen.panel : null
                    return (
                      <Fragment key={row.date}>
                        <Tr bg={row.strong ? 'whiteAlpha.100' : undefined}>
                          <Td color={row.strong ? 'white' : 'gray.400'} fontWeight={row.strong ? 'semibold' : 'normal'}>
                            {row.label}
                          </Td>
                          <Td>
                            {row.past && !item.dates.some((date) => date.date === row.date) ? (
                              <Text color="gray.300">{row.route}</Text>
                            ) : (
                              <Select
                                value={row.route}
                                bg="gray.900"
                                borderColor="gray.700"
                                maxW="320px"
                                isDisabled={busy === `${item.id}:${row.date}`}
                                onChange={(e) => void saveOverride(item.id, row.date, e.target.value)}
                              >
                                {row.route && !item.routes.includes(row.route) ? (
                                  <option value={row.route}>{row.route}</option>
                                ) : null}
                                {item.routes.map((route) => (
                                  <option key={route} value={route}>
                                    {route}
                                  </option>
                                ))}
                              </Select>
                            )}
                            {row.eventId && row.publishedRoute && row.publishedRoute !== row.route ? (
                              <Text color="gray.500" fontSize="xs" mt={1}>
                                Site still shows {row.publishedRoute}
                              </Text>
                            ) : null}
                          </Td>
                          <Td>
                            <Flex gap={2} wrap="wrap">
                              {row.overridden ? <Badge colorScheme="orange">Changed</Badge> : null}
                              {row.eventId ? <Badge colorScheme="green">Event {row.eventId}</Badge> : null}
                              {!row.eventId && row.feedEventId ? <Badge colorScheme="blue">Ready to apply</Badge> : null}
                            </Flex>
                          </Td>
                          <Td>
                            {row.past && !item.dates.some((date) => date.date === row.date) ? null : (
                              <Button
                                colorScheme="red"
                                size="sm"
                                isLoading={busy === `apply:${item.id}:${row.date}`}
                                onClick={() => void apply(item, row)}
                              >
                                Apply
                              </Button>
                            )}
                          </Td>
                          {showZwiftPower ? (
                            <Td>
                              {row.eventId && (item.id === 'zwifty-fifty' || primeRoutes.includes(row.route)) ? (
                                <Stack spacing={2}>
                                  <FiftyStatus
                                    event={{
                                      date: row.date,
                                      label: row.label,
                                      route: row.route,
                                      eventId: row.eventId,
                                      resultsFix: row.resultsFix,
                                      primesFix: row.primesFix,
                                    }}
                                  />
                                  <Flex gap={2} wrap="wrap">
                                    {item.id === 'zwifty-fifty' ? (
                                      <Button
                                        {...readableOutline}
                                        size="sm"
                                        onClick={() =>
                                          setFiftyOpen(open === 'categories' ? null : { id: row.eventId, panel: 'categories' })
                                        }
                                      >
                                        Check categories
                                      </Button>
                                    ) : null}
                                    <Button
                                      {...readableOutline}
                                      size="sm"
                                      onClick={() =>
                                        setFiftyOpen(open === 'sprints' ? null : { id: row.eventId, panel: 'sprints' })
                                      }
                                    >
                                      Check sprints
                                    </Button>
                                  </Flex>
                                </Stack>
                              ) : null}
                            </Td>
                          ) : null}
                        </Tr>
                        {showZwiftPower && open ? (
                          <Tr>
                            <Td colSpan={columns} borderTopWidth="0">
                              <FiftyDetail
                                eventId={row.eventId}
                                panel={open}
                                onUpdated={() => void loadSaved()}
                              />
                            </Td>
                          </Tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </Tbody>
              </Table>
            </Box>
          </Box>
        )
      })}
      <GroupRide />
    </Stack>
  )
}
