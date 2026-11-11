'use client'

import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react'
import AdminShell from '@/components/admin/AdminShell'
import WeeklySeries from '@/app/admin/events/WeeklySeries'
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Input,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react'
import type { ZwiftEventSummary } from '@/packages/shared/zwiftEvents'

type KitPreset = { id: string; label: string; tag: string }

type Physics = {
  frameGrams: string | null
  frameCdaBias: string | null
  frontWheelGrams: string | null
  frontWheelCdaBias: string | null
  frontWheelCrr: string | null
  rearWheelGrams: string | null
  rearWheelCdaBias: string | null
  rearWheelCrr: string | null
}

type Unlock = { tag: string; name: string | null }

type Course = {
  routeId: number | null
  routeName: string | null
  routeMap: string | null
  routeWorld: string | null
  routeDistanceInMeters: number | null
  routeAscentInMeters: number | null
  leadInDistanceInMeters: number | null
  leadInAscentInMeters: number | null
  mapId: number | null
  worldId: number | null
  world: string | null
  laps: number | null
  distanceInMeters: number | null
  durationInSeconds: number | null
}

type Equipment = {
  bikeName: string | null
  frontWheelHash: string | null
  frontWheelName: string | null
  rearWheelHash: string | null
  rearWheelName: string | null
  upgradePhysicsDisabled: boolean
  physics: Physics
  steering: 'enabled' | 'disabled'
  brakingDisabled: boolean
}

type Subgroup = Course &
  Equipment & {
    id: number | null
    name: string | null
    label: string | null
    eventStart: string | null
    registrationStart: string | null
    registrationEnd: string | null
    lineUpStart: string | null
    lineUpEnd: string | null
    startLocation: number | null
    lateJoinInMinutes: number | null
    rangeAccessLabel: string | null
    rulesId: number | null
    rules: string[]
    signedUpCount: number | null
    joinedCount: number | null
    entrantCount: number | null
    jerseyHash: number | null
    bikeHash: number | null
    unlockTags: string[]
    unlocks: Unlock[]
    tags: string[]
  }

type InspectedEvent = Course &
  Equipment & {
    id: number
    name: string | null
    description: string
    type: string | null
    sport: string | null
    eventStart: string | null
    imageUrl: string | null
    rulesId: number | null
    rules: string[]
    cullingType: string | null
    lateJoinInMinutes: number | null
    visible: boolean | null
    privateEvent: boolean | null
    unlisted: boolean | null
    restricted: boolean | null
    invisibleToNonParticipants: boolean | null
    categoryEnforcement: boolean | null
    accessExpression: string | null
    rangeAccessLabel: string | null
    partnerClientId: string | null
    signedUpCount: number | null
    joinedCount: number | null
    entrantCount: number | null
    jerseyHash: number | null
    bikeHash: number | null
    unlockTags: string[]
    unlocks: Unlock[]
    tags: string[]
    kitPresets: KitPreset[]
    url: string
    subgroups: Subgroup[]
    raw: Record<string, unknown>
  }

type RouteHit = { routeId: number; name: string; world: string | null }

function formatStart(value: string | number | null | undefined) {
  if (value == null || value === '') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatDistance(meters: number | null | undefined) {
  if (meters == null || Number.isNaN(meters)) return null
  return `${(meters / 1000).toFixed(2)} km`
}

function dash(value: unknown) {
  if (value == null || value === '') return '—'
  return String(value)
}

async function errorMessage(res: Response) {
  const body = await res.json().catch(() => ({}))
  return String(body?.error || body?.message || `Request failed (${res.status})`)
}

const readableOutline = {
  variant: 'outline' as const,
  color: 'white',
  borderColor: 'whiteAlpha.600',
  _hover: { bg: 'whiteAlpha.200' },
}

function TagList({ tags, scheme }: { tags: string[]; scheme: string }) {
  if (!tags.length) return <Text color="gray.500">None</Text>
  return (
    <Flex gap={2} wrap="wrap">
      {tags.map((tag) => (
        <Badge key={tag} colorScheme={scheme}>
          {tag}
        </Badge>
      ))}
    </Flex>
  )
}

function lengthLabel(laps: number | null, distanceInMeters: number | null) {
  if (laps) return `${laps} lap${laps === 1 ? '' : 's'}`
  if (distanceInMeters) return formatDistance(distanceInMeters) || '—'
  return '—'
}

function formatClimb(meters: number | null | undefined) {
  if (meters == null || Number.isNaN(meters)) return null
  return `${Math.round(meters)} m`
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return null
  const minutes = Math.round(seconds / 60)
  return `${minutes} min`
}

function yesNo(value: boolean | null | undefined) {
  if (value == null) return '—'
  return value ? 'Yes' : 'No'
}

const WORLD_LABELS: Record<string, string> = {
  WATOPIA: 'Watopia',
  RICHMOND: 'Richmond',
  LONDON: 'London',
  NEWYORK: 'New York',
  INNSBRUCK: 'Innsbruck',
  BOLOGNA: 'Bologna',
  YORKSHIRE: 'Yorkshire',
  CRITCITY: 'Crit City',
  MAKURIISLANDS: 'Makuri Islands',
  FRANCE: 'France',
  PARIS: 'Paris',
  SCOTLAND: 'Scotland',
}

function worldLabel(value: string | null | undefined) {
  if (!value) return null
  const folded = value.toUpperCase().replace(/[^A-Z]/g, '')
  return WORLD_LABELS[folded] || value
}

const RULE_LABELS: Record<string, string> = {
  ENFORCE_HRM: 'Heart-rate monitor required',
  ENFORCE_NO_ZPOWER: 'No zPower',
  NO_POWERUPS: 'No powerups',
  SHOW_RACE_RESULTS: 'Results shown',
  NO_TT_BIKES: 'No TT bikes',
}

function ruleLabel(rule: string) {
  return RULE_LABELS[rule] || rule
}

function cullingLabel(value: string | null | undefined) {
  if (!value) return '—'
  if (value === 'CULLING_SUBGROUP_ONLY') return 'Own category only'
  return value
}

function steeringOf(tags: string[] | undefined, reported?: string | null) {
  if (reported === 'disabled' || reported === 'enabled') return reported
  const disabled = (tags || []).some((tag) => tag.trim().toLowerCase() === 'steering_disabled')
  return disabled ? 'disabled' : 'enabled'
}

function steeringLabel(value: string | null | undefined) {
  if (value === 'disabled') return 'Disabled'
  return 'Enabled'
}

function namedThing(name: string | null | undefined, hash: string | number | null | undefined) {
  if (name && hash != null && hash !== '') return `${name} (${hash})`
  if (name) return name
  if (hash != null && hash !== '') return String(hash)
  return '—'
}

function physicsLines(physics: Physics | null | undefined, upgradesDisabled: boolean) {
  const lines: string[] = []
  if (physics?.frameGrams || physics?.frameCdaBias) {
    lines.push(`Frame ${physics.frameGrams ?? '—'} g, CdA bias ${physics.frameCdaBias ?? '—'}`)
  }
  if (physics?.frontWheelGrams || physics?.frontWheelCdaBias || physics?.frontWheelCrr) {
    lines.push(
      `Front wheel ${physics.frontWheelGrams ?? '—'} g, CdA bias ${physics.frontWheelCdaBias ?? '—'}, Crr ${physics.frontWheelCrr ?? '—'}`
    )
  }
  if (physics?.rearWheelGrams || physics?.rearWheelCdaBias || physics?.rearWheelCrr) {
    lines.push(
      `Rear wheel ${physics.rearWheelGrams ?? '—'} g, CdA bias ${physics.rearWheelCdaBias ?? '—'}, Crr ${physics.rearWheelCrr ?? '—'}`
    )
  }
  if (upgradesDisabled) lines.push('Upgrade physics disabled')
  return lines
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Text fontSize="xs" color="gray.500" mb={1}>
        {label}
      </Text>
      <Box color="gray.100">{children}</Box>
    </Box>
  )
}

export default function AdminEventsPage() {
  const [upcoming, setUpcoming] = useState<ZwiftEventSummary[]>([])
  const [feedDown, setFeedDown] = useState(false)
  const [eventId, setEventId] = useState('')
  const [event, setEvent] = useState<InspectedEvent | null>(null)
  const [listError, setListError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [extraTags, setExtraTags] = useState('')
  const [routeQuery, setRouteQuery] = useState('')
  const [routes, setRoutes] = useState<RouteHit[]>([])
  const [pickedRoute, setPickedRoute] = useState<RouteHit | null>(null)
  const [lengthMode, setLengthMode] = useState<'laps' | 'distance' | ''>('')
  const [laps, setLaps] = useState('')
  const [distanceKm, setDistanceKm] = useState('')
  const [notice, setNotice] = useState('')
  const [dumpCopied, setDumpCopied] = useState(false)
  const detailsRef = useRef<HTMLDivElement>(null)

  async function reloadDetails(id: number) {
    const res = await fetch(`/api/admin/events/${id}`)
    if (!res.ok) {
      setError(await errorMessage(res))
      return
    }
    setEvent(await res.json())
    setNotice('Saved. Details reloaded.')
    detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch('/api/admin/events')
      if (cancelled) return
      if (!res.ok) {
        setListError(await errorMessage(res))
        return
      }
      const body = await res.json()
      setUpcoming(body.events || [])
      setFeedDown(Boolean(body.unavailable))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function inspect(id: string) {
    const trimmed = id.trim()
    if (!/^\d+$/.test(trimmed)) {
      setError('Event id must be a number')
      return
    }
    setBusy('inspect')
    setError('')
    setNotice('')
    setDumpCopied(false)
    setEventId(trimmed)
    const res = await fetch(`/api/admin/events/${trimmed}`)
    setBusy('')
    if (!res.ok) {
      setEvent(null)
      setError(await errorMessage(res))
      return
    }
    setEvent(await res.json())
    setPickedRoute(null)
    setLengthMode('')
    setLaps('')
    setDistanceKm('')
    setRoutes([])
    setRouteQuery('')
  }

  function onInspectSubmit(e: FormEvent) {
    e.preventDefault()
    void inspect(eventId)
  }

  async function addTags(tags: string[]) {
    if (!event) return
    const name = event.name || `event ${event.id}`
    if (!window.confirm(`Add ${tags.join(', ')} to ${name}? This updates the event and every category.`)) return
    setBusy('tags')
    setError('')
    setNotice('')
    const res = await fetch(`/api/admin/events/${event.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tags', tags }),
    })
    if (!res.ok) {
      setBusy('')
      setError(await errorMessage(res))
      return
    }
    setExtraTags('')
    await reloadDetails(event.id)
    setBusy('')
  }

  function onAddExtraTags(e: FormEvent) {
    e.preventDefault()
    const tags = extraTags
      .split(/[\s,]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
    if (!tags.length) {
      setError('Enter at least one tag')
      return
    }
    void addTags(tags)
  }

  async function searchRoutes(e: FormEvent) {
    e.preventDefault()
    const q = routeQuery.trim()
    if (q.length < 2 && !/^\d+$/.test(q)) {
      setError('Enter a route name, or a route id')
      return
    }
    setBusy('routes')
    setError('')
    const res = await fetch(`/api/admin/events/routes?q=${encodeURIComponent(q)}`)
    setBusy('')
    if (!res.ok) {
      setRoutes([])
      setError(await errorMessage(res))
      return
    }
    const body = await res.json()
    setRoutes(Array.isArray(body) ? body : [])
  }

  async function saveCourse() {
    if (!event) return
    const body: { action: 'course'; routeId?: number; laps?: number; distanceMeters?: number } = {
      action: 'course',
    }
    if (pickedRoute) body.routeId = pickedRoute.routeId
    if (lengthMode === 'laps') {
      const n = Number(laps)
      if (!Number.isInteger(n) || n <= 0) {
        setError('Laps must be a whole number greater than 0')
        return
      }
      body.laps = n
    } else if (lengthMode === 'distance') {
      const km = Number(distanceKm)
      if (!(km > 0)) {
        setError('Distance must be greater than 0')
        return
      }
      body.distanceMeters = Math.round(km * 1000)
    }
    if (body.routeId == null && body.laps == null && body.distanceMeters == null) {
      setError('Choose a route, laps, or distance')
      return
    }
    const name = event.name || `event ${event.id}`
    const parts = [
      body.routeId != null ? `route ${pickedRoute?.name || body.routeId}` : '',
      body.laps != null ? `${body.laps} laps` : '',
      body.distanceMeters != null ? `${distanceKm} km` : '',
    ].filter(Boolean)
    if (!window.confirm(`Update ${name} to ${parts.join(', ')}? This updates the event and every category.`)) return
    setBusy('course')
    setError('')
    setNotice('')
    const res = await fetch(`/api/admin/events/${event.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      setBusy('')
      setError(await errorMessage(res))
      return
    }
    setPickedRoute(null)
    setLengthMode('')
    setLaps('')
    setDistanceKm('')
    setRoutes([])
    setRouteQuery('')
    await reloadDetails(event.id)
    setBusy('')
  }

  return (
    <AdminShell title="Zwift events">
      <Text color="gray.400" mb={6}>
        Upcoming DZR events, plus any event id the organizer account can read. Edits are saved on Zwift.
      </Text>

      <WeeklySeries />

      <Heading size="md" mb={1}>
        Inspect an event
      </Heading>
      <Text color="gray.400" mb={4}>
        A one-off event. Pick it from the list, or enter an event id.
      </Text>

      <Flex as="form" onSubmit={onInspectSubmit} gap={2} mb={6} wrap="wrap">
        <Input
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          placeholder="Event id"
          maxW="240px"
          bg="gray.900"
          borderColor="gray.700"
        />
        <Button type="submit" colorScheme="red" isLoading={busy === 'inspect'}>
          Inspect
        </Button>
      </Flex>

      {listError ? (
        <Text color="red.300" mb={4}>
          {listError}
        </Text>
      ) : null}
      {feedDown ? (
        <Text color="orange.300" mb={4}>
          The public event list is unavailable right now. An event id still works.
        </Text>
      ) : null}

      <Stack spacing={2} mb={8}>
        {upcoming.map((item) => (
          <Button
            key={item.id}
            w="full"
            {...readableOutline}
            justifyContent="space-between"
            borderColor={event?.id === item.id ? 'red.400' : 'whiteAlpha.600'}
            onClick={() => void inspect(String(item.id))}
          >
            <Text as="span">{item.name}</Text>
            <Text as="span" color="gray.400" fontWeight="normal">
              {item.eventDate} {item.subgroups[0]?.startTime || ''} · {item.id}
            </Text>
          </Button>
        ))}
        {!listError && !feedDown && upcoming.length === 0 ? (
          <Text color="gray.500">No upcoming DZR events in the public feed.</Text>
        ) : null}
      </Stack>

      {error ? (
        <Text color="red.300" mb={4}>
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text color="green.300" mb={4}>
          {notice}
        </Text>
      ) : null}

      {event ? (
        <Stack spacing={6} ref={detailsRef}>
          <Box>
            <Heading size="sm" mb={2}>
              Summary
            </Heading>
            <Text fontWeight="semibold">{event.name || 'Untitled event'}</Text>
            <Text color="gray.300">{formatStart(event.eventStart)}</Text>
            <Text color="gray.300" mb={2}>
              {[event.sport, event.type].filter(Boolean).join(' · ') || '—'}
              {event.partnerClientId ? ` · ${event.partnerClientId}` : ''}
            </Text>
            {event.description ? (
              <Text color="gray.200" mb={2}>
                {event.description}
              </Text>
            ) : null}
            <Text mb={2}>
              <a href={event.url} target="_blank" rel="noreferrer">
                Zwift
              </a>
              {event.imageUrl ? (
                <>
                  {' · '}
                  <a href={event.imageUrl} target="_blank" rel="noreferrer">
                    Header image
                  </a>
                </>
              ) : null}
            </Text>
            <Text color="gray.300">
              {event.routeName || 'No route'}
              {event.routeWorld ? `, ${worldLabel(event.routeWorld)}` : ''} · {lengthLabel(event.laps, event.distanceInMeters)}
            </Text>
            <Text color="gray.300">
              {event.signedUpCount ?? '—'} signed up · {event.joinedCount ?? '—'} joined
            </Text>
          </Box>

          <Box borderWidth="1px" borderColor="gray.700" rounded="md" p={4}>
            <Heading size="sm" mb={4}>
              What Zwift has stored
            </Heading>
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
              <Detail label="Steering">
                <Text fontWeight="semibold">{steeringLabel(steeringOf(event.tags, event.steering))}</Text>
                <Text fontSize="sm" color="gray.400" mt={1}>
                  Zwift writes steering_disabled only when steering is turned off. When that tag is missing, steering is
                  enabled.
                </Text>
              </Detail>
              <Detail label="Braking">{event.brakingDisabled ? 'Disabled' : 'No nobraking tag'}</Detail>
              <Detail label="Route">
                {event.routeName || 'No route'}
                {event.routeId != null ? ` · ${event.routeId}` : ''}
              </Detail>
              <Detail label="Route length">
                {[formatDistance(event.routeDistanceInMeters), formatClimb(event.routeAscentInMeters)]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </Detail>
              <Detail label="Lead-in">
                {[formatDistance(event.leadInDistanceInMeters), formatClimb(event.leadInAscentInMeters)]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </Detail>
              <Detail label="Event length">
                {[
                  lengthLabel(event.laps, event.distanceInMeters),
                  formatDuration(event.durationInSeconds),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Detail>
              <Detail label="Route world">
                {worldLabel(event.routeWorld) || '—'}
                {event.mapId != null ? ` · map ${event.mapId}` : ''}
              </Detail>
              <Detail label="Event world">
                {worldLabel(event.world) || '—'}
                {event.worldId != null ? ` · worldId ${event.worldId}` : ''}
                {worldLabel(event.routeWorld) &&
                worldLabel(event.world) &&
                worldLabel(event.routeWorld) !== worldLabel(event.world) ? (
                  <Text fontSize="sm" color="orange.300" mt={1}>
                    The route is on {worldLabel(event.routeWorld)}. The stored world is still {worldLabel(event.world)}.
                  </Text>
                ) : null}
              </Detail>
              <Detail label="Who you see">{cullingLabel(event.cullingType)}</Detail>
              <Detail label="Late join">
                {event.lateJoinInMinutes != null ? `${event.lateJoinInMinutes} min` : '—'}
              </Detail>
              <Detail label="Rules">
                {event.rules?.length ? (
                  <Stack spacing={0}>
                    {event.rules.map((rule) => (
                      <Text key={rule}>{ruleLabel(rule)}</Text>
                    ))}
                    {event.rulesId != null ? (
                      <Text fontSize="sm" color="gray.500">
                        Rules id {event.rulesId}
                      </Text>
                    ) : null}
                  </Stack>
                ) : (
                  dash(event.rulesId)
                )}
              </Detail>
              <Detail label="Bike">{namedThing(event.bikeName, event.bikeHash)}</Detail>
              <Detail label="Front wheel">{namedThing(event.frontWheelName, event.frontWheelHash)}</Detail>
              <Detail label="Rear wheel">{namedThing(event.rearWheelName, event.rearWheelHash)}</Detail>
              <Detail label="Bike physics">
                {physicsLines(event.physics, event.upgradePhysicsDisabled).length ? (
                  <Stack spacing={0}>
                    {physicsLines(event.physics, event.upgradePhysicsDisabled).map((line) => (
                      <Text key={line}>{line}</Text>
                    ))}
                  </Stack>
                ) : (
                  '—'
                )}
              </Detail>
              <Detail label="Visible in game">{yesNo(event.visible)}</Detail>
              <Detail label="Unlisted">{yesNo(event.unlisted)}</Detail>
              <Detail label="Restricted">{yesNo(event.restricted)}</Detail>
              <Detail label="Private">{yesNo(event.privateEvent)}</Detail>
              <Detail label="Hidden from non-participants">{yesNo(event.invisibleToNonParticipants)}</Detail>
              <Detail label="Category enforcement">{yesNo(event.categoryEnforcement)}</Detail>
              <Detail label="Score range">{dash(event.rangeAccessLabel)}</Detail>
              <Detail label="Signed up">{dash(event.signedUpCount)}</Detail>
              <Detail label="Joined">{dash(event.joinedCount)}</Detail>
            </SimpleGrid>
            {event.accessExpression ? (
              <Box mt={4}>
                <Text fontSize="xs" color="gray.500" mb={1}>
                  Who can enter
                </Text>
                <Box as="pre" whiteSpace="pre-wrap" fontSize="sm" color="gray.200">
                  {event.accessExpression}
                </Box>
              </Box>
            ) : null}
          </Box>

          <Box borderWidth="1px" borderColor="gray.700" rounded="md" p={4}>
            <Heading size="sm" mb={3}>
              Tags
            </Heading>
            <Text fontSize="sm" color="gray.400" mb={2}>
              Unlocks
            </Text>
            <Box mb={4}>
              <TagList
                tags={(event.unlocks || []).map((unlock) => (unlock.name ? `${unlock.name} · ${unlock.tag}` : unlock.tag))}
                scheme="green"
              />
            </Box>
            <Text fontSize="sm" color="gray.400" mb={2}>
              On the event
            </Text>
            <Box mb={4}>
              <TagList tags={event.tags || []} scheme="gray" />
            </Box>
            <Flex gap={2} wrap="wrap" mb={4}>
              {event.kitPresets.map((kit) => (
                <Button
                  key={kit.id}
                  size="sm"
                  {...readableOutline}
                  isLoading={busy === 'tags'}
                  onClick={() => void addTags([kit.tag])}
                >
                  {kit.label}
                </Button>
              ))}
            </Flex>
            <Flex as="form" onSubmit={onAddExtraTags} gap={2} wrap="wrap">
              <Input
                value={extraTags}
                onChange={(e) => setExtraTags(e.target.value)}
                placeholder="Tags, separated by spaces or commas"
                bg="gray.900"
                borderColor="gray.700"
              />
              <Button type="submit" colorScheme="red" isLoading={busy === 'tags'}>
                Add tags
              </Button>
            </Flex>
          </Box>

          <Box borderWidth="1px" borderColor="gray.700" rounded="md" p={4}>
            <Heading size="sm" mb={3}>
              Course
            </Heading>
            <Flex as="form" onSubmit={searchRoutes} gap={2} mb={3} wrap="wrap">
              <Input
                value={routeQuery}
                onChange={(e) => setRouteQuery(e.target.value)}
                placeholder="Route name or id"
                bg="gray.900"
                borderColor="gray.700"
              />
              <Button type="submit" {...readableOutline} isLoading={busy === 'routes'}>
                Search
              </Button>
            </Flex>
            {pickedRoute ? (
              <Text mb={3}>
                Selected route: {pickedRoute.name} ({pickedRoute.routeId}
                {pickedRoute.world ? `, ${pickedRoute.world}` : ''})
              </Text>
            ) : null}
            <Stack spacing={1} mb={4}>
              {routes.map((route) => (
                <Button
                  key={route.routeId}
                  size="sm"
                  justifyContent="flex-start"
                  color="white"
                  variant={pickedRoute?.routeId === route.routeId ? 'solid' : 'ghost'}
                  colorScheme={pickedRoute?.routeId === route.routeId ? 'red' : undefined}
                  _hover={{ bg: 'whiteAlpha.200' }}
                  onClick={() => setPickedRoute(route)}
                >
                  {route.name} · {route.routeId}
                  {route.world ? ` · ${route.world}` : ''}
                </Button>
              ))}
            </Stack>
            <Flex gap={2} mb={3}>
              <Button
                size="sm"
                type="button"
                {...(lengthMode === 'laps' ? { variant: 'solid' as const, colorScheme: 'red' } : readableOutline)}
                onClick={() => setLengthMode(lengthMode === 'laps' ? '' : 'laps')}
              >
                Laps
              </Button>
              <Button
                size="sm"
                type="button"
                {...(lengthMode === 'distance' ? { variant: 'solid' as const, colorScheme: 'red' } : readableOutline)}
                onClick={() => setLengthMode(lengthMode === 'distance' ? '' : 'distance')}
              >
                Distance
              </Button>
            </Flex>
            {lengthMode === 'laps' ? (
              <Input
                mb={3}
                maxW="200px"
                value={laps}
                onChange={(e) => setLaps(e.target.value)}
                placeholder="Laps"
                bg="gray.900"
                borderColor="gray.700"
              />
            ) : null}
            {lengthMode === 'distance' ? (
              <Input
                mb={3}
                maxW="200px"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
                placeholder="Distance (km)"
                bg="gray.900"
                borderColor="gray.700"
              />
            ) : null}
            <Button type="button" colorScheme="red" isLoading={busy === 'course'} onClick={() => void saveCourse()}>
              Save course
            </Button>
          </Box>

          <Box>
            <Heading size="sm" mb={3}>
              Categories
            </Heading>
            <Stack spacing={3}>
              {(event.subgroups || []).map((subgroup) => (
                <Box key={subgroup.id ?? subgroup.label} borderWidth="1px" borderColor="gray.700" rounded="md" p={4}>
                  <Text fontWeight="semibold" mb={3}>
                    {subgroup.label || 'Category'}
                    {subgroup.name && subgroup.name !== event.name ? ` · ${subgroup.name}` : ''}
                    {subgroup.id != null ? ` · ${subgroup.id}` : ''}
                  </Text>
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                    <Detail label="Start">{formatStart(subgroup.eventStart)}</Detail>
                    <Detail label="Sign-up">
                      {formatStart(subgroup.registrationStart)} – {formatStart(subgroup.registrationEnd)}
                    </Detail>
                    <Detail label="Lineup">
                      {formatStart(subgroup.lineUpStart)} – {formatStart(subgroup.lineUpEnd)}
                    </Detail>
                    <Detail label="Start pen">{dash(subgroup.startLocation)}</Detail>
                    <Detail label="Route">
                      {subgroup.routeName || dash(subgroup.routeId)}
                      {subgroup.routeId != null && subgroup.routeName ? ` · ${subgroup.routeId}` : ''}
                    </Detail>
                    <Detail label="Length">{lengthLabel(subgroup.laps, subgroup.distanceInMeters)}</Detail>
                    <Detail label="Steering">
                      {steeringLabel(steeringOf(subgroup.tags, subgroup.steering))}
                      {steeringOf(subgroup.tags, subgroup.steering) !== steeringOf(event.tags, event.steering)
                        ? ' · differs from the event'
                        : ''}
                    </Detail>
                    <Detail label="Score range">{dash(subgroup.rangeAccessLabel)}</Detail>
                    <Detail label="Signed up">{dash(subgroup.signedUpCount)}</Detail>
                    <Detail label="Joined">{dash(subgroup.joinedCount)}</Detail>
                    <Detail label="Late join">
                      {subgroup.lateJoinInMinutes != null ? `${subgroup.lateJoinInMinutes} min` : '—'}
                    </Detail>
                    <Detail label="Rules">
                      {subgroup.rules?.length ? subgroup.rules.map(ruleLabel).join(' · ') : '—'}
                    </Detail>
                  </SimpleGrid>
                  <Text fontSize="xs" color="gray.500" mt={3} mb={1}>
                    Tags
                  </Text>
                  <TagList tags={subgroup.tags || []} scheme="gray" />
                </Box>
              ))}
              {!event.subgroups?.length ? <Text color="gray.500">No categories.</Text> : null}
            </Stack>
          </Box>

          <Box as="details" borderWidth="1px" borderColor="gray.700" rounded="md" p={4}>
            <Box as="summary" cursor="pointer" fontWeight="semibold" color="white">
              Full event
            </Box>
              <Text fontSize="sm" color="gray.400" mt={3} mb={3}>
                Zwift&apos;s event document. The join secret is left out.
              </Text>
              <Button
                size="sm"
                mb={3}
                {...readableOutline}
                onClick={() => {
                  void navigator.clipboard.writeText(JSON.stringify(event.raw, null, 2)).then(() => {
                    setDumpCopied(true)
                  })
                }}
              >
                {dumpCopied ? 'Copied' : 'Copy'}
              </Button>
              <Box
                as="pre"
                overflowX="auto"
                whiteSpace="pre"
                fontSize="xs"
                color="gray.300"
                bg="gray.900"
                rounded="md"
                p={3}
              >
                {JSON.stringify(event.raw, null, 2)}
              </Box>
          </Box>
        </Stack>
      ) : null}
    </AdminShell>
  )
}
