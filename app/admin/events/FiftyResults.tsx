'use client'

import { useEffect, useState } from 'react'
import { Badge, Box, Button, Flex, Link, Stack, Text } from '@chakra-ui/react'

export type SavedEvent = {
  date: string
  label: string
  route: string
  eventId: string
  resultsFix: { at: string; updated: number; skipped: number } | null
  primesFix: { at: string; updated: number; skipped: number } | null
}

type CategoryChange = { name: string; zwid: string; from: string; to: string }
type SkippedRider = { name: string; zwid: string; reason: string }

type Preview = {
  eventId: number
  pending: boolean
  changes: CategoryChange[]
  skipped: SkippedRider[]
  updated?: CategoryChange[]
}

type SprintRow = { name: string; laps: string; segment: string; matched: boolean; points?: string }
type SprintPreview = {
  eventId: number
  route: string
  pending: boolean
  points: string
  sprints: SprintRow[]
  updated?: SprintRow[]
}

export type FiftyPanel = 'categories' | 'sprints'

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

export function FiftyStatus({ event }: { event: SavedEvent }) {
  return (
    <Flex gap={2} align="center" wrap="wrap">
      <Link color="orange.300" href={`https://zwiftpower.com/events.php?zid=${event.eventId}`} isExternal>
        ZwiftPower
      </Link>
      {event.resultsFix ? <Badge colorScheme="purple">Categories checked</Badge> : null}
      {event.primesFix ? <Badge colorScheme="blue">Sprints set</Badge> : null}
    </Flex>
  )
}

export function FiftyDetail({
  eventId,
  panel,
  onUpdated,
}: {
  eventId: string
  panel: FiftyPanel
  onUpdated: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [sprints, setSprints] = useState<SprintPreview | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setSprints(null)
    setError('')
    setNotice('')
    ;(async () => {
      setBusy('load')
      const path =
        panel === 'categories'
          ? `/api/admin/events/results/preview?eventId=${encodeURIComponent(eventId)}`
          : `/api/admin/events/results/sprints?eventId=${encodeURIComponent(eventId)}`
      const res = await fetch(path)
      if (cancelled) return
      setBusy('')
      if (!res.ok) {
        setError(await errorMessage(res))
        return
      }
      const body = await res.json()
      if (panel === 'categories') setPreview(body as Preview)
      else setSprints(body as SprintPreview)
    })()
    return () => {
      cancelled = true
    }
  }, [eventId, panel])

  async function updateCategories() {
    setBusy('update')
    setError('')
    setNotice('')
    const res = await fetch('/api/admin/events/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId }),
    })
    setBusy('')
    if (!res.ok) {
      setError(await errorMessage(res))
      return
    }
    const body = (await res.json()) as Preview
    setPreview(body)
    const count = body.updated?.length || 0
    setNotice(count ? `Moved ${count} rider${count === 1 ? '' : 's'} off WKG.` : 'No WKG riders to move.')
    onUpdated()
  }

  async function updateSprints() {
    setBusy('update')
    setError('')
    setNotice('')
    const res = await fetch('/api/admin/events/results/sprints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId }),
    })
    setBusy('')
    if (!res.ok) {
      setError(await errorMessage(res))
      return
    }
    const body = (await res.json()) as SprintPreview
    setSprints(body)
    const count = body.updated?.length || 0
    setNotice(count ? `Set ${count} sprint${count === 1 ? '' : 's'} on ZwiftPower.` : 'No sprints to set.')
    onUpdated()
  }

  return (
    <Box py={2}>
      {busy === 'load' ? <Text color="gray.400">Checking ZwiftPower…</Text> : null}
      {error ? <Text color="red.300">{error}</Text> : null}
      {notice ? <Text color="green.300">{notice}</Text> : null}
      {panel === 'sprints' && sprints ? (
        <Stack spacing={1}>
          {sprints.pending ? <Text color="orange.300">ZwiftPower does not have this event yet.</Text> : null}
          {!sprints.pending && !sprints.sprints.length ? <Text color="gray.400">This route has no sprints.</Text> : null}
          {sprints.sprints.map((sprint) => (
            <Text key={`${sprint.name}-${sprint.laps}`} color={sprint.matched ? 'white' : 'orange.300'}>
              {sprint.name}
              {sprint.matched
                ? `: ${sprint.laps} lap${sprint.laps === '1' ? '' : 's'}, ${sprint.points || sprints.points}`
                : ' is not a ZwiftPower segment'}
            </Text>
          ))}
          {sprints.sprints.length > 0 && sprints.sprints.every((sprint) => sprint.matched) ? (
            <Button colorScheme="red" size="sm" alignSelf="flex-start" isLoading={busy === 'update'} onClick={() => void updateSprints()}>
              Update sprints
            </Button>
          ) : null}
        </Stack>
      ) : null}
      {panel === 'categories' && preview ? (
        <Stack spacing={1}>
          {preview.pending ? <Text color="orange.300">ZwiftPower does not have results for this race yet.</Text> : null}
          {!preview.pending && !preview.changes.length && !preview.skipped.length ? (
            <Text color="gray.400">No WKG riders.</Text>
          ) : null}
          {preview.changes.map((change) => (
            <Text key={change.zwid}>
              {change.name}: {change.from} → {change.to}
            </Text>
          ))}
          {preview.skipped.map((rider) => (
            <Text key={rider.zwid || rider.name} color="orange.300">
              {rider.name}: {rider.reason}
            </Text>
          ))}
          {preview.changes.length ? (
            <Button colorScheme="red" size="sm" alignSelf="flex-start" isLoading={busy === 'update'} onClick={() => void updateCategories()}>
              Update ZwiftPower
            </Button>
          ) : null}
        </Stack>
      ) : null}
    </Box>
  )
}
