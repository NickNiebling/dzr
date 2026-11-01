'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AdminShell from '@/components/admin/AdminShell'
import {
  emptyCatalogRoute,
  listToText,
  textToList,
  type CatalogRoute,
} from '@/app/lib/catalogRoute'
import { Box, Button, Flex, Heading, Input, Select, Stack, Switch, Text } from '@chakra-ui/react'
import { RouteProfilePreview } from '@/components/route-profile/RouteProfilePreview'
import { foldName, slugifyZwiftName, zwiftInsiderUrl, type ProfileSegment, type RaceProfile } from '@/packages/shared/routeProfile'
import { usesLapCount } from '@/packages/shared/seriesRotation'

type SeriesId = string
type RouteHit = { routeId: number; name: string; world: string | null }
type SegmentHit = { id: string; name: string; world: string }
type Suggestion = { match: RouteHit | null; sameName: boolean; options: RouteHit[] }
type WorldList = { world: string; routes: RouteHit[] }
type LengthMode = 'laps' | 'distance'

const readableOutline = {
  variant: 'outline' as const,
  color: 'white',
  borderColor: 'whiteAlpha.600',
  _hover: { bg: 'whiteAlpha.200' },
}

const field = { bg: 'gray.900', borderColor: 'gray.700' }

function coreName(value: string) {
  return foldName(value)
    .replace(/\b(forward|reverse|rev)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function segmentChoices(segments: ProfileSegment[]) {
  const seen = new Set<string>()
  return segments.filter((segment) => {
    const key = `${segment.name}|${segment.direction}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function choiceValue(segment: ProfileSegment) {
  return `${segment.name}|${segment.direction}`
}

function confirmedSegment(name: string, segments: ProfileSegment[]) {
  const key = coreName(name)
  if (!key) return null
  const matches = segments.filter((segment) => coreName(segment.name) === key)
  if (!matches.length) return null
  const wantReverse = /\b(reverse|rev\.?)\b/i.test(name)
  const directed = matches.filter(
    (segment) => (segment.direction === 'reverse' || /\b(reverse|rev\.?)\b/i.test(segment.name)) === wantReverse
  )
  return directed[0] || matches[0]
}

function savedSegmentName(segment: ProfileSegment, segments: ProfileSegment[]) {
  const directions = new Set(segments.filter((item) => item.name === segment.name).map((item) => item.direction))
  if (directions.size > 1 && segment.direction === 'reverse' && !/\b(reverse|rev\.?)\b/i.test(segment.name)) {
    return `${segment.name} Rev.`
  }
  return segment.name
}

function worldLabel(world: string | null | undefined) {
  return String(world || '')
    .trim()
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ')
}

function hasKomProfiles(route: CatalogRoute) {
  return route.climbs.some((climb) => climb.trim()) || route.customClimbs.length > 0
}

function hasSegmentPoints(route: CatalogRoute) {
  return route.sprints.some((sprint) => sprint.trim()) || route.bonus.some((seconds) => seconds.trim())
}

function lapCourse(count: number, stats: RaceProfile) {
  return {
    distance: String(Math.round(stats.lapKm * count * 10) / 10),
    elevation: String(Math.round((stats.lapGainM || 0) * count)),
  }
}

function segmentKind(segment: ProfileSegment) {
  if (segment.type === 'climb') return 'Climb'
  if (segment.type === 'sprint') return 'Sprint'
  return 'Segment'
}

async function errorMessage(res: Response) {
  const body = await res.json().catch(() => ({}))
  return String(body?.error || `Request failed (${res.status})`)
}

export default function RouteSetupPage() {
  const [series, setSeries] = useState<SeriesId>('after-party')
  const [extraSeries, setExtraSeries] = useState<{ slug: string; name: string }[]>([])
  const [routes, setRoutes] = useState<CatalogRoute[]>([])
  const [index, setIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState<CatalogRoute>(emptyCatalogRoute())
  const [options, setOptions] = useState<RouteHit[]>([])
  const [sprintHits, setSprintHits] = useState<Record<number, SegmentHit[]>>({})
  const [namedSearch, setNamedSearch] = useState<Record<number, boolean>>({})
  const [routeNameSearch, setRouteNameSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [profile, setProfile] = useState<RaceProfile | null>(null)
  const [lengthMode, setLengthMode] = useState<LengthMode>('distance')
  const [worlds, setWorlds] = useState<WorldList[]>([])
  const [komProfiles, setKomProfiles] = useState(false)
  const [segmentPoints, setSegmentPoints] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const fillLaps = useRef(false)
  const catalogRequest = useRef(0)

  const worldSlug = slugifyZwiftName(draft.world)
  const worldRoutes = worlds.find((item) => item.world === worldSlug)?.routes || []

  async function load(nextSeries = series) {
    const ticket = ++catalogRequest.current
    const res = await fetch(`/api/admin/events/catalog?series=${nextSeries}`, { cache: 'no-store' })
    if (ticket !== catalogRequest.current) return
    if (!res.ok) {
      setError(await errorMessage(res))
      return
    }
    const body = await res.json()
    setRoutes(Array.isArray(body.routes) ? body.routes : [])
  }

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('series')
    if (requested) setSeries(requested)
    void fetch('/api/admin/events/event-series', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return
        const body = await res.json()
        const rows = Array.isArray(body.series) ? body.series : []
        setExtraSeries(rows.filter((item: { slug?: string }) => item.slug !== 'after-party' && item.slug !== 'zwifty-fifty'))
      })
      .catch(() => setExtraSeries([]))
  }, [])

  useEffect(() => {
    void fetch('/api/admin/events/world-routes', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return
        const body = await res.json()
        setWorlds(Array.isArray(body.worlds) ? body.worlds : [])
      })
      .catch(() => setWorlds([]))
  }, [])

  useEffect(() => {
    if (!fillLaps.current || lengthMode !== 'laps' || !profile?.lapKm) return
    const count = Number(draft.laps)
    if (!Number.isInteger(count) || count <= 0) return
    fillLaps.current = false
    setDraft((current) => ({ ...current, ...lapCourse(count, profile) }))
  }, [profile, draft.laps, lengthMode])

  useEffect(() => {
    setIndex(null)
    setDraft(emptyCatalogRoute())
    setLengthMode('distance')
    setKomProfiles(false)
    setSegmentPoints(false)
    fillLaps.current = false
    setOptions([])
    setSprintHits({})
    setNamedSearch({})
    setRouteNameSearch(false)
    void load(series)
    // The series button is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series])

  function openRoute(routeIndex: number) {
    const route = routes[routeIndex]
    if (!route) return
    setIndex(routeIndex)
    setDraft(route)
    setLengthMode(usesLapCount(route.laps) ? 'laps' : 'distance')
    setKomProfiles(hasKomProfiles(route))
    setSegmentPoints(hasSegmentPoints(route))
    fillLaps.current = false
    setCustomName('')
    setCustomFrom('')
    setCustomTo('')
    setOptions([])
    setSprintHits({})
    setNamedSearch({})
    setRouteNameSearch(false)
    setQuery(route.zwiftRouteName || route.route)
    setProfile(null)
    setError('')
    setNotice('')
  }

  function startAdd() {
    setIndex(null)
    setDraft(emptyCatalogRoute())
    setLengthMode('distance')
    setKomProfiles(false)
    setSegmentPoints(false)
    fillLaps.current = false
    setCustomName('')
    setCustomFrom('')
    setCustomTo('')
    setOptions([])
    setSprintHits({})
    setNamedSearch({})
    setRouteNameSearch(false)
    setQuery('')
    setProfile(null)
    setError('')
    setNotice('')
  }

  function setField(patch: Partial<CatalogRoute>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  async function findZwift(name: string) {
    const q = name.trim()
    if (q.length < 2) {
      setError('Enter a route name to search Zwift')
      return
    }
    setBusy('find')
    setError('')
    const res = await fetch(`/api/admin/events/route-match?name=${encodeURIComponent(q)}`)
    setBusy('')
    if (!res.ok) {
      setOptions([])
      setError(await errorMessage(res))
      return
    }
    const body = (await res.json()) as Suggestion
    const found = Array.isArray(body.options) ? body.options : []
    setOptions(found)
    if (body.match) {
      applyZwiftRoute(body.match, { keepSearching: !body.sameName })
      if (!body.sameName) setNotice(`Zwift calls this ${body.match.name}. Pick another result if that is wrong.`)
    } else {
      setRouteNameSearch(true)
      setNotice('No single Zwift route matched. Choose one from the list, or search again.')
    }
  }

  function queueLapFill(lapsText: string, wait: boolean) {
    const count = Number(lapsText)
    const laps = Number.isInteger(count) && count > 0 ? String(count) : lapsText
    if (!wait && profile?.lapKm && Number.isInteger(count) && count > 0) {
      fillLaps.current = false
      setDraft((current) => ({ ...current, laps, ...lapCourse(count, profile) }))
      return
    }
    fillLaps.current = true
    setDraft((current) => ({ ...current, laps }))
  }

  function chooseLength(mode: LengthMode) {
    setLengthMode(mode)
    if (mode === 'distance') {
      fillLaps.current = false
      setDraft((current) => (usesLapCount(current.laps) ? { ...current, laps: '1+' } : current))
      return
    }
    queueLapFill(usesLapCount(draft.laps) ? draft.laps.trim() : '1', false)
  }

  function applyZwiftRoute(hit: RouteHit, options?: { keepSearching?: boolean; world?: string }) {
    setRouteNameSearch(Boolean(options?.keepSearching))
    setQuery(hit.name)
    setDraft((current) => {
      const link = current.linkRoute.trim()
      const guessedAlready = !link || link === zwiftInsiderUrl(current.zwiftRouteName) || link === zwiftInsiderUrl(current.route)
      return {
        ...current,
        zwiftRouteId: hit.routeId,
        zwiftRouteName: hit.name,
        world: options?.world ? worldLabel(options.world) : current.world.trim() ? current.world : worldLabel(hit.world),
        route: current.route.trim() ? current.route : hit.name,
        linkRoute: guessedAlready ? zwiftInsiderUrl(hit.name) : current.linkRoute,
      }
    })
    if (lengthMode === 'laps') {
      fillLaps.current = true
      setProfile(null)
    }
  }

  function addClimb(name: string) {
    const cleaned = name.trim()
    if (!cleaned || draft.climbs.some((climb) => climb.toLowerCase() === cleaned.toLowerCase())) return
    setField({ climbs: [...draft.climbs, cleaned] })
  }

  function addCustomClimb() {
    const name = customName.trim()
    const fromKm = Number(customFrom)
    const toKm = Number(customTo)
    if (!name || !(toKm > fromKm)) {
      setError('A custom KOM needs a name, a start km, and a later end km')
      return
    }
    setError('')
    setField({ customClimbs: [...draft.customClimbs, { name, fromKm, toKm }] })
    setCustomName('')
    setCustomFrom('')
    setCustomTo('')
  }

  function setSprint(sprintIndex: number, name: string) {
    const sprints = draft.sprints.slice()
    sprints[sprintIndex] = name
    setField({ sprints })
  }

  function setSprintLap(sprintIndex: number, laps: string) {
    const sprintLaps = draft.sprintLaps.slice()
    while (sprintLaps.length <= sprintIndex) sprintLaps.push('')
    sprintLaps[sprintIndex] = laps
    setField({ sprintLaps })
  }

  function addSprint() {
    setField({ sprints: [...draft.sprints, ''], sprintLaps: [...draft.sprintLaps, ''] })
  }

  function selectRouteSegment(sprintIndex: number, value: string) {
    if (!profile) return
    const segment = segmentChoices(profile.segments).find((item) => choiceValue(item) === value)
    if (!segment) return
    setSprint(sprintIndex, savedSegmentName(segment, profile.segments))
    setNamedSearch((current) => ({ ...current, [sprintIndex]: false }))
    setSprintHits((current) => ({ ...current, [sprintIndex]: [] }))
  }

  function removeSprint(sprintIndex: number) {
    setSprintHits({})
    setNamedSearch({})
    setField({
      sprints: draft.sprints.filter((_, index) => index !== sprintIndex),
      sprintLaps: draft.sprintLaps.filter((_, index) => index !== sprintIndex),
    })
  }

  async function findSprint(sprintIndex: number) {
    const name = (draft.sprints[sprintIndex] || '').trim()
    if (name.length < 2) {
      setError('Enter a sprint name to search ZwiftPower')
      return
    }
    setBusy(`sprint:${sprintIndex}`)
    setError('')
    const res = await fetch(`/api/admin/events/segments?q=${encodeURIComponent(name)}`)
    setBusy('')
    if (!res.ok) {
      setError(await errorMessage(res))
      return
    }
    const body = await res.json()
    const hits = Array.isArray(body) ? (body as SegmentHit[]) : []
    setSprintHits((current) => ({ ...current, [sprintIndex]: hits }))
    const exact = hits.find((hit) => hit.name.toLowerCase() === name.toLowerCase())
    if (exact) setSprint(sprintIndex, exact.name)
    else if (!hits.length) setNotice(`ZwiftPower has no segment matching ${name}.`)
    else setNotice('Pick the ZwiftPower segment. The saved name has to match it exactly.')
  }

  async function searchZwift() {
    const q = query.trim()
    if (q.length < 2 && !/^\d+$/.test(q)) {
      setError('Enter a Zwift route name, or a route id')
      return
    }
    setBusy('search')
    setError('')
    const res = await fetch(`/api/admin/events/routes?q=${encodeURIComponent(q)}`)
    setBusy('')
    if (!res.ok) {
      setError(await errorMessage(res))
      return
    }
    const body = await res.json()
    setOptions(Array.isArray(body) ? body : [])
  }

  async function save() {
    const lapCount = Number(draft.laps)
    const route: CatalogRoute = {
      ...draft,
      route: draft.route.trim(),
      laps:
        lengthMode === 'laps' && Number.isInteger(lapCount) && lapCount > 0
          ? String(lapCount)
          : usesLapCount(draft.laps)
            ? '1+'
            : draft.laps.trim(),
      climbs: komProfiles ? draft.climbs : [],
      customClimbs: komProfiles ? draft.customClimbs : [],
      sprints: segmentPoints ? draft.sprints : [],
      sprintLaps: segmentPoints ? draft.sprintLaps : [],
      bonus: segmentPoints ? draft.bonus : [],
    }
    if (!route.route) {
      setError('A route name is required')
      return
    }
    setBusy('save')
    setError('')
    setNotice('')
    const res = await fetch('/api/admin/events/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        series,
        action: index == null ? 'add' : 'update',
        index,
        route,
      }),
    })
    setBusy('')
    if (!res.ok) {
      setError(await errorMessage(res))
      return
    }
    const body = await res.json()
    setRoutes(Array.isArray(body.routes) ? body.routes : [])
    setNotice(index == null ? 'Route added.' : 'Route saved.')
    if (index == null) startAdd()
  }

  return (
    <AdminShell title="Route setup">
      <Text color="gray.400" mb={4}>
        {series === 'after-party' || series === 'zwifty-fifty'
          ? 'These routes live in Firebase and drive the weekly rotation. The files in the site were copied in as the starting list. Profile images still come from the site files, named from the route.'
          : series === 'always-a-race'
            ? 'Add the category A routes in the order the ride should rotate. Category B stays the route of the week. Match each route to its Zwift course.'
            : 'Add the routes for this series in the order a weekly series should rotate. The public page draws the course from the route you pick here.'}{' '}
        <Link href="/admin/events" style={{ color: '#F6AD55' }}>Back to events</Link>
        {series !== 'after-party' && series !== 'zwifty-fifty' && series !== 'always-a-race' ? (
          <>
            {' · '}
            <Link href="/admin/events/series" style={{ color: '#F6AD55' }}>Back to series</Link>
          </>
        ) : null}
      </Text>
      <Flex gap={2} mb={6}>
        <Button
          {...(series === 'after-party' ? { colorScheme: 'red' as const } : readableOutline)}
          onClick={() => setSeries('after-party')}
        >
          DZR After Party
        </Button>
        <Button
          {...(series === 'zwifty-fifty' ? { colorScheme: 'red' as const } : readableOutline)}
          onClick={() => setSeries('zwifty-fifty')}
        >
          The Zwifty Fifty
        </Button>
        <Button
          {...(series === 'always-a-race' ? { colorScheme: 'red' as const } : readableOutline)}
          onClick={() => setSeries('always-a-race')}
        >
          It&apos;s always a race
        </Button>
        {extraSeries.map((item) => (
          <Button
            key={item.slug}
            {...(series === item.slug ? { colorScheme: 'red' as const } : readableOutline)}
            onClick={() => setSeries(item.slug)}
          >
            {item.name}
          </Button>
        ))}
      </Flex>
      {error ? (
        <Text color="red.300" mb={3}>
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text color="green.300" mb={3}>
          {notice}
        </Text>
      ) : null}
      <Flex gap={8} align="flex-start" wrap="wrap">
        <Stack spacing={2} flex="1" minW="260px" maxW="360px" overflow="hidden">
          {routes.map((route, routeIndex) => (
            <Button
              key={`${route.route}-${routeIndex}`}
              {...readableOutline}
              w="100%"
              h="auto"
              whiteSpace="normal"
              overflow="hidden"
              justifyContent="space-between"
              borderColor={index === routeIndex ? 'red.400' : 'whiteAlpha.600'}
              onClick={() => openRoute(routeIndex)}
            >
              <Text as="span" noOfLines={1} textAlign="left">
                {route.route}
              </Text>
              <Text as="span" noOfLines={1} color="gray.400" fontWeight="normal" textAlign="right">
                {route.zwiftRouteName || 'No Zwift route'}
              </Text>
            </Button>
          ))}
          <Button colorScheme="red" onClick={startAdd}>
            Add route
          </Button>
        </Stack>
        <Box flex="2" minW="320px" borderWidth="1px" borderColor="gray.700" rounded="md" p={4}>
          <Flex justify="space-between" align="center" gap={3} mb={4}>
            <Heading size="sm">{index == null ? 'New route' : draft.route || 'Edit route'}</Heading>
            <Button colorScheme="red" flexShrink={0} isLoading={busy === 'save'} onClick={() => void save()}>
              {index == null ? 'Add route' : 'Save route'}
            </Button>
          </Flex>
          <Stack spacing={3}>
            {draft.zwiftRouteId && draft.zwiftRouteName && !routeNameSearch ? (
              <Flex gap={2} wrap="wrap" align="center">
                <Box flex="1" minW="180px" borderWidth="1px" borderColor="green.400" rounded="md" px={3} py={2}>
                  <Text color="white" fontWeight="semibold">
                    {draft.zwiftRouteName}
                  </Text>
                  <Text color="green.200" fontSize="sm">
                    {worldLabel(draft.world) || 'Zwift route'} · {draft.zwiftRouteId}
                  </Text>
                  {draft.route.trim() && foldName(draft.route) !== foldName(draft.zwiftRouteName) ? (
                    <Text color="gray.400" fontSize="sm">
                      Shown on the site as {draft.route}
                    </Text>
                  ) : null}
                </Box>
                <Button {...readableOutline} onClick={() => setRouteNameSearch(true)}>
                  Type a name
                </Button>
              </Flex>
            ) : (
              <Box>
                <Input
                  placeholder="Route name"
                  value={draft.route}
                  onChange={(e) => {
                    setRouteNameSearch(true)
                    setField({ route: e.target.value })
                  }}
                  {...field}
                />
                <Text fontSize="sm" color="gray.400" mt={2} mb={2}>
                  Find matches the typed name. Choose a result to select the Zwift route.
                </Text>
                <Flex gap={2} mb={2} wrap="wrap">
                  <Button {...readableOutline} isLoading={busy === 'find'} onClick={() => void findZwift(draft.route || query)}>
                    Find from route name
                  </Button>
                </Flex>
                <Flex gap={2} mb={2} wrap="wrap">
                  <Input
                    placeholder="Search Zwift by name or id"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    {...field}
                  />
                  <Button {...readableOutline} isLoading={busy === 'search'} onClick={() => void searchZwift()}>
                    Search
                  </Button>
                </Flex>
                {options.length ? (
                  <Select
                    value=""
                    placeholder="Choose the Zwift route"
                    bg="gray.900"
                    borderColor="gray.700"
                    onChange={(e) => {
                      const hit = options.find((option) => String(option.routeId) === e.target.value)
                      if (hit) applyZwiftRoute(hit)
                    }}
                  >
                    {options.map((option) => (
                      <option key={option.routeId} value={option.routeId}>
                        {option.name}
                        {option.world ? ` · ${worldLabel(option.world)}` : ''} · {option.routeId}
                      </option>
                    ))}
                  </Select>
                ) : null}
              </Box>
            )}
            <Select
              placeholder="Choose a Zwift world"
              bg="gray.900"
              borderColor="gray.700"
              value={worlds.some((item) => item.world === worldSlug) ? worldSlug : ''}
              onChange={(e) => setField({ world: e.target.value ? worldLabel(e.target.value) : '' })}
            >
              {worlds.map((item) => (
                <option key={item.world} value={item.world}>
                  {worldLabel(item.world)}
                </option>
              ))}
            </Select>
            <Select
              placeholder={worldRoutes.length ? 'Choose a route in this world' : 'Choose a world first'}
              bg="gray.900"
              borderColor="gray.700"
              value={worldRoutes.some((route) => route.routeId === draft.zwiftRouteId) ? String(draft.zwiftRouteId) : ''}
              onChange={(e) => {
                const hit = worldRoutes.find((route) => String(route.routeId) === e.target.value)
                if (hit) applyZwiftRoute(hit, { world: worldSlug })
              }}
            >
              {worldRoutes.map((route) => (
                <option key={route.routeId} value={route.routeId}>
                  {route.name}
                </option>
              ))}
            </Select>
            <Flex gap={2}>
              <Button
                {...(lengthMode === 'laps' ? { colorScheme: 'red' as const } : readableOutline)}
                onClick={() => chooseLength('laps')}
              >
                Laps
              </Button>
              <Button
                {...(lengthMode === 'distance' ? { colorScheme: 'red' as const } : readableOutline)}
                onClick={() => chooseLength('distance')}
              >
                Distance
              </Button>
            </Flex>
            <Flex gap={2}>
              {lengthMode === 'laps' ? (
                <Input
                  placeholder="Laps"
                  value={draft.laps}
                  onChange={(e) => {
                    const laps = e.target.value
                    if (usesLapCount(laps)) queueLapFill(laps, false)
                    else {
                      fillLaps.current = false
                      setField({ laps })
                    }
                  }}
                  {...field}
                />
              ) : (
                <Input
                  placeholder="1+ or <1"
                  value={draft.laps}
                  onChange={(e) => setField({ laps: e.target.value })}
                  {...field}
                />
              )}
              <Input
                placeholder="Distance (km)"
                value={draft.distance}
                isReadOnly={lengthMode === 'laps'}
                onChange={(e) => setField({ distance: e.target.value })}
                {...field}
              />
              <Input
                placeholder="Elevation (hm)"
                value={draft.elevation}
                isReadOnly={lengthMode === 'laps'}
                onChange={(e) => setField({ elevation: e.target.value })}
                {...field}
              />
            </Flex>
            <Input placeholder="Finish" value={draft.finish} onChange={(e) => setField({ finish: e.target.value })} {...field} />
            <Input
              placeholder="Zwift Insider link"
              value={draft.linkRoute}
              onChange={(e) => setField({ linkRoute: e.target.value })}
              {...field}
            />
            <Text fontSize="sm" color="gray.400" mt={-2}>
              Filled in from the route name. Change it when the article uses a different address.
            </Text>
            <Box borderWidth="1px" borderColor="gray.700" rounded="md" p={3}>
              <Flex justify="space-between" align="center" gap={3}>
                <Box>
                  <Text color="white" fontWeight="semibold">
                    Extra KOM profiles
                  </Text>
                  <Text fontSize="sm" color="gray.400">
                    Draw a close-up for each climb you add. The route profile is always shown. Kilometre marks start at the lead-in.
                  </Text>
                </Box>
                <Switch colorScheme="red" isChecked={komProfiles} onChange={(e) => setKomProfiles(e.target.checked)} />
              </Flex>
              {komProfiles ? (
              <Stack spacing={2} mt={3}>
                {draft.climbs.map((climb, climbIndex) => (
                  <Flex key={`${climb}-${climbIndex}`} gap={2} align="center">
                    <Text color="white" flex="1">
                      {climb}
                    </Text>
                    <Button
                      {...readableOutline}
                      onClick={() => setField({ climbs: draft.climbs.filter((_, index) => index !== climbIndex) })}
                    >
                      Remove
                    </Button>
                  </Flex>
                ))}
                {draft.customClimbs.map((climb, climbIndex) => (
                  <Flex key={`${climb.name}-${climb.fromKm}-${climbIndex}`} gap={2} align="center">
                    <Text color="white" flex="1">
                      {climb.name} · {climb.fromKm}–{climb.toKm} km
                    </Text>
                    <Button
                      {...readableOutline}
                      onClick={() =>
                        setField({ customClimbs: draft.customClimbs.filter((_, index) => index !== climbIndex) })
                      }
                    >
                      Remove
                    </Button>
                  </Flex>
                ))}
              <Select
                placeholder={profile ? 'Add a climb on this route' : 'Load the route profile first'}
                bg="gray.900"
                borderColor="gray.700"
                value=""
                mb={2}
                onChange={(e) => {
                  const segment = segmentChoices(profile?.segments || []).find((item) => choiceValue(item) === e.target.value)
                  if (segment) addClimb(savedSegmentName(segment, profile?.segments || []))
                }}
              >
                {segmentChoices(profile?.segments || []).map((segment) => (
                  <option key={choiceValue(segment)} value={choiceValue(segment)}>
                    {segment.name} · {segmentKind(segment)} · {segment.direction === 'reverse' ? 'Reverse' : 'Forward'} ·{' '}
                    {segment.fromKm.toFixed(1)} km
                  </option>
                ))}
              </Select>
              <Flex gap={2} wrap="wrap">
                <Input
                  placeholder="Custom KOM name"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  flex="1"
                  minW="160px"
                  {...field}
                />
                <Input
                  placeholder="Start km"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  maxW="120px"
                  {...field}
                />
                <Input
                  placeholder="End km"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  maxW="120px"
                  {...field}
                />
                <Button {...readableOutline} onClick={addCustomClimb}>
                  Add climb
                </Button>
              </Flex>
              </Stack>
              ) : null}
            </Box>
            <Box borderWidth="1px" borderColor="gray.700" rounded="md" p={3}>
              <Flex justify="space-between" align="center" gap={3}>
                <Box>
                  <Text color="white" fontWeight="semibold">
                    Segment points
                  </Text>
                  <Text fontSize="sm" color="gray.400">
                    Timed segments that award bonus seconds in the race and on ZwiftPower.
                  </Text>
                </Box>
                <Switch colorScheme="red" isChecked={segmentPoints} onChange={(e) => setSegmentPoints(e.target.checked)} />
              </Flex>
              {segmentPoints ? (
              <Box mt={3}>
                  <Text fontSize="sm" color="gray.400" mb={2}>
                    Pick a timed segment on this route. A typed name is for an older row: Find still searches ZwiftPower.
                  </Text>
                  <Button
                    {...readableOutline}
                    size="sm"
                    mb={2}
                    isDisabled={!profile?.sprints.length}
                    onClick={() => {
                      if (!profile?.sprints.length) return
                      const filled = draft.sprints.some((sprint) => sprint.trim())
                      if (filled && !window.confirm('Replace the sprint list with the sprints on this route?')) return
                      setNamedSearch({})
                      setField({
                        sprints: profile.sprints.map((sprint) => sprint.name),
                        sprintLaps: profile.sprints.map((sprint) => sprint.laps),
                      })
                    }}
                  >
                    Suggest sprints
                  </Button>
                  <Stack spacing={2}>
                    {draft.sprints.map((sprint, sprintIndex) => {
                      const choices = segmentChoices(profile?.segments || [])
                      const selected = confirmedSegment(sprint, profile?.segments || [])
                      const showTyped = Boolean(namedSearch[sprintIndex]) || (Boolean(sprint.trim()) && !selected)
                      return (
                        <Box key={sprintIndex}>
                          {selected && !showTyped ? (
                            <Flex gap={2} wrap="wrap" align="center">
                              <Box flex="1" minW="180px" borderWidth="1px" borderColor="green.400" rounded="md" px={3} py={2}>
                                <Text color="white" fontWeight="semibold">
                                  {selected.name}
                                </Text>
                                <Text color="green.200" fontSize="sm">
                                  {segmentKind(selected)} · {selected.direction === 'reverse' ? 'Reverse' : 'Forward'} ·{' '}
                                  {selected.fromKm.toFixed(1)} km
                                </Text>
                              </Box>
                              <Input
                                placeholder="Laps"
                                value={draft.sprintLaps[sprintIndex] || ''}
                                onChange={(e) => setSprintLap(sprintIndex, e.target.value)}
                                maxW="120px"
                                {...field}
                              />
                              <Button
                                {...readableOutline}
                                onClick={() => setNamedSearch((current) => ({ ...current, [sprintIndex]: true }))}
                              >
                                Type a name
                              </Button>
                              <Button {...readableOutline} onClick={() => removeSprint(sprintIndex)}>
                                Remove
                              </Button>
                            </Flex>
                          ) : showTyped ? (
                            <>
                              <Flex gap={2} wrap="wrap">
                                <Input
                                  placeholder="ZwiftPower segment name"
                                  value={sprint}
                                  flex="1"
                                  minW="180px"
                                  onChange={(e) => {
                                    setNamedSearch((current) => ({ ...current, [sprintIndex]: true }))
                                    setSprint(sprintIndex, e.target.value)
                                  }}
                                  {...field}
                                />
                                <Input
                                  placeholder="Laps"
                                  value={draft.sprintLaps[sprintIndex] || ''}
                                  onChange={(e) => setSprintLap(sprintIndex, e.target.value)}
                                  maxW="120px"
                                  {...field}
                                />
                                <Button
                                  {...readableOutline}
                                  isLoading={busy === `sprint:${sprintIndex}`}
                                  onClick={() => void findSprint(sprintIndex)}
                                >
                                  Find
                                </Button>
                                <Button {...readableOutline} onClick={() => removeSprint(sprintIndex)}>
                                  Remove
                                </Button>
                              </Flex>
                              {sprintHits[sprintIndex]?.length ? (
                                <Select
                                  mt={2}
                                  placeholder="Choose the ZwiftPower segment"
                                  bg="gray.900"
                                  borderColor="gray.700"
                                  value={sprintHits[sprintIndex].some((hit) => hit.name === sprint) ? sprint : ''}
                                  onChange={(e) => {
                                    const hit = sprintHits[sprintIndex].find((option) => option.name === e.target.value)
                                    if (hit) setSprint(sprintIndex, hit.name)
                                  }}
                                >
                                  {sprintHits[sprintIndex].map((hit) => (
                                    <option key={hit.id} value={hit.name}>
                                      {hit.name}
                                      {hit.world ? ` · ${hit.world}` : ''}
                                    </option>
                                  ))}
                                </Select>
                              ) : null}
                              {choices.length ? (
                                <Select
                                  mt={2}
                                  placeholder="Replace with a segment on this route"
                                  bg="gray.900"
                                  borderColor="gray.700"
                                  value=""
                                  onChange={(e) => selectRouteSegment(sprintIndex, e.target.value)}
                                >
                                  {choices.map((segment) => (
                                    <option key={choiceValue(segment)} value={choiceValue(segment)}>
                                      {segment.name} · {segmentKind(segment)} · {segment.direction === 'reverse' ? 'Reverse' : 'Forward'} ·{' '}
                                      {segment.fromKm.toFixed(1)} km
                                    </option>
                                  ))}
                                </Select>
                              ) : null}
                            </>
                          ) : (
                            <Flex gap={2} wrap="wrap" align="center">
                              <Select
                                flex="1"
                                minW="220px"
                                placeholder={choices.length ? 'Choose a segment on this route' : 'Load the route profile first'}
                                bg="gray.900"
                                borderColor="gray.700"
                                value=""
                                onChange={(e) => selectRouteSegment(sprintIndex, e.target.value)}
                              >
                                {choices.map((segment) => (
                                  <option key={choiceValue(segment)} value={choiceValue(segment)}>
                                    {segment.name} · {segmentKind(segment)} · {segment.direction === 'reverse' ? 'Reverse' : 'Forward'} ·{' '}
                                    {segment.fromKm.toFixed(1)} km
                                  </option>
                                ))}
                              </Select>
                              <Input
                                placeholder="Laps"
                                value={draft.sprintLaps[sprintIndex] || ''}
                                onChange={(e) => setSprintLap(sprintIndex, e.target.value)}
                                maxW="120px"
                                {...field}
                              />
                              <Button
                                {...readableOutline}
                                onClick={() => setNamedSearch((current) => ({ ...current, [sprintIndex]: true }))}
                              >
                                Type a name
                              </Button>
                              <Button {...readableOutline} onClick={() => removeSprint(sprintIndex)}>
                                Remove
                              </Button>
                            </Flex>
                          )}
                        </Box>
                      )
                    })}
                    <Button {...readableOutline} alignSelf="flex-start" onClick={addSprint}>
                      Add segment
                    </Button>
                  </Stack>
                <Input
                  placeholder="Bonus seconds for each segment, separated by commas"
                  value={listToText(draft.bonus)}
                  onChange={(e) => setField({ bonus: textToList(e.target.value) })}
                  {...field}
                />
              </Box>
              ) : null}
            </Box>
            <Button colorScheme="red" alignSelf="flex-start" isLoading={busy === 'save'} onClick={() => void save()}>
              {index == null ? 'Add route' : 'Save route'}
            </Button>
            {draft.zwiftRouteName ? (
              <RouteProfilePreview
                request={{
                  world: draft.world,
                  route: draft.zwiftRouteName,
                  laps: draft.laps,
                  distance: draft.distance,
                  finish: draft.finish,
                  climbs: komProfiles ? draft.climbs : [],
                  customClimbs: komProfiles ? draft.customClimbs : [],
                }}
                showClimbs={komProfiles && draft.climbs.length + draft.customClimbs.length > 0}
                bonusSprints={
                  segmentPoints
                    ? draft.sprints
                        .map((name, sprintIndex) => ({ name: name.trim(), laps: (draft.sprintLaps[sprintIndex] || '').trim() }))
                        .filter((row) => row.name)
                    : []
                }
                onProfile={setProfile}
              />
            ) : (
              <Text color="gray.500">Choose the Zwift route to preview the profile.</Text>
            )}
          </Stack>
        </Box>
      </Flex>
    </AdminShell>
  )
}
