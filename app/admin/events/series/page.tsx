'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import AdminShell from '@/components/admin/AdminShell'
import { Box, Button, Checkbox, Flex, Heading, Icon, Image, Input, Popover, PopoverBody, PopoverContent, PopoverTrigger, Select, Stack, Switch, Text, Textarea } from '@chakra-ui/react'
import { SERIES_RULES, orderedRules, ruleOption } from '@/components/series/SeriesRules'
import { SeriesIconChoices } from '@/components/series/SeriesMenuIcons'
import { seriesMenuIconId } from '@/app/lib/seriesMenuIcons'
import { eventIdFromInput } from '@/packages/shared/zwiftEvents'

type Kind = 'weekly' | 'limited'
type PointsRow = { label: string; points: string }
type RaceStart = { time: string; eventId: string }
type SeriesRace = { date: string; route: string; label: string; match: string; starts: RaceStart[] }
type CatalogRoute = { route: string }
type PlannedRace = { date: string; label: string; routeName: string; starts: RaceStart[] }

type SeriesDraft = {
  slug: string
  name: string
  intro: string
  cardText: string
  timeLabel: string
  kind: Kind
  zwiftName: string
  published: boolean
  logoUrl: string
  rules: string[]
  carousel: boolean
  icon: string
  pointsNote: string
  pointsRows: PointsRow[]
  leagueUrl: string
  anchorDate: string
  anchorIndex: number
  overrides: Record<string, string>
  races: SeriesRace[]
  discordWebhookSet: boolean
}

const emptyDraft = (): SeriesDraft => ({
  slug: '',
  name: '',
  intro: '',
  cardText: '',
  timeLabel: '',
  kind: 'weekly',
  zwiftName: '',
  published: false,
  logoUrl: '',
  rules: [],
  carousel: false,
  icon: 'mountain',
  pointsNote: '',
  pointsRows: [],
  leagueUrl: '',
  anchorDate: '',
  anchorIndex: 0,
  overrides: {},
  races: [],
  discordWebhookSet: false,
})

const field = {
  bg: 'gray.900',
  borderColor: 'gray.700',
  color: 'white',
  sx: {
    option: { color: 'black' },
  },
}

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function toIsoDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function DateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = parseIsoDate(value)
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(() => selected ?? new Date())
  const year = visible.getFullYear()
  const month = visible.getMonth()
  const lead = (new Date(year, month, 1).getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const cells: Array<Date | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, index) => new Date(year, month, index + 1)),
  ]
  const label = selected
    ? selected.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Choose a date'

  return (
    <Popover
      isOpen={open}
      onOpen={() => {
        setVisible(selected ?? new Date())
        setOpen(true)
      }}
      onClose={() => setOpen(false)}
      placement="bottom-start"
      isLazy
    >
      <PopoverTrigger>
        <Button
          w="full"
          minW="11rem"
          justifyContent="flex-start"
          fontWeight="normal"
          bg="gray.900"
          borderWidth="1px"
          borderColor="gray.700"
          color={selected ? 'white' : 'gray.400'}
          _hover={{ bg: 'gray.800' }}
          _active={{ bg: 'gray.800' }}
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent bg="gray.900" borderColor="gray.700" color="white" w="280px" zIndex={20}>
        <PopoverBody>
          <Flex align="center" justify="space-between" mb={2}>
            <Button size="sm" variant="ghost" color="white" fontSize="xl" lineHeight="1" aria-label="Previous month" _hover={{ bg: 'gray.700' }} onClick={() => setVisible(new Date(year, month - 1, 1))}>‹</Button>
            <Text fontSize="sm">{visible.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
            <Button size="sm" variant="ghost" color="white" fontSize="xl" lineHeight="1" aria-label="Next month" _hover={{ bg: 'gray.700' }} onClick={() => setVisible(new Date(year, month + 1, 1))}>›</Button>
          </Flex>
          <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" gap={1}>
            {Array.from({ length: 7 }, (_, index) => (
              <Text key={index} fontSize="xs" color="gray.500" textAlign="center">
                {new Date(2024, 0, index + 1).toLocaleDateString(undefined, { weekday: 'narrow' })}
              </Text>
            ))}
            {cells.map((date, index) => date ? (
              <Button
                key={toIsoDate(date)}
                size="sm"
                h="32px"
                minW="0"
                px={0}
                color="white"
                variant={value === toIsoDate(date) ? 'solid' : 'ghost'}
                colorScheme={value === toIsoDate(date) ? 'red' : undefined}
                _hover={{ bg: value === toIsoDate(date) ? 'red.600' : 'gray.700' }}
                onClick={() => {
                  onChange(toIsoDate(date))
                  setOpen(false)
                }}
              >
                {date.getDate()}
              </Button>
            ) : <Box key={`empty-${index}`} />)}
          </Box>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  )
}

function pageAddress(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function fromApi(series: Record<string, unknown>): SeriesDraft {
  const rules = Array.isArray(series.rules) ? series.rules.map(String) : []
  return {
    slug: String(series.slug || ''),
    name: String(series.name || ''),
    intro: String(series.intro || ''),
    cardText: String(series.cardText || ''),
    timeLabel: String(series.timeLabel || ''),
    kind: series.kind === 'limited' ? 'limited' : 'weekly',
    zwiftName: String(series.zwiftName || ''),
    published: Boolean(series.published),
    logoUrl: String(series.logoUrl || ''),
    rules: orderedRules(rules),
    carousel: Boolean(series.carousel),
    icon: seriesMenuIconId(series.icon),
    pointsNote: String(series.pointsNote || ''),
    pointsRows: Array.isArray(series.pointsRows) ? (series.pointsRows as PointsRow[]) : [],
    leagueUrl: String(series.leagueUrl || ''),
    anchorDate: String(series.anchorDate || ''),
    anchorIndex: Number(series.anchorIndex) || 0,
    overrides: (series.overrides || {}) as Record<string, string>,
    races: Array.isArray(series.races)
      ? (series.races as SeriesRace[]).map((race) => ({ ...race, starts: Array.isArray(race.starts) ? race.starts : [] }))
      : [],
    discordWebhookSet: Boolean(series.discordWebhookSet),
  }
}

async function errorMessage(res: Response) {
  const body = await res.json().catch(() => ({}))
  const raw = body?.error
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const message = JSON.parse(raw)?.error?.message
      if (typeof message === 'string' && message) return message
    } catch {
      return raw
    }
  }
  return typeof raw === 'string' && raw ? raw : `Request failed (${res.status})`
}

function EventIds({ starts, onChange }: { starts: RaceStart[]; onChange: (starts: RaceStart[]) => void }) {
  const rows = starts.length ? starts : [{ time: '', eventId: '' }]
  function edit(index: number, next: Partial<RaceStart>) {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...next } : row)))
  }
  return (
    <Stack spacing={2}>
      {rows.map((start, index) => (
        <Flex key={index} gap={2} wrap="wrap">
          <Input
            placeholder="Zwift event id"
            value={start.eventId}
            {...field}
            onChange={(e) => {
              const parsed = eventIdFromInput(e.target.value)
              edit(index, { eventId: parsed === null ? e.target.value : parsed })
            }}
          />
          <Input
            placeholder="Time"
            value={start.time}
            maxW="140px"
            onChange={(e) => edit(index, { time: e.target.value })}
            {...field}
          />
          {rows.length > 1 ? (
            <Button onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>Remove</Button>
          ) : null}
        </Flex>
      ))}
      <Button alignSelf="flex-start" size="sm" onClick={() => onChange([...rows, { time: '', eventId: '' }])}>
        Add event
      </Button>
    </Stack>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <Box>
      <Text color="gray.300" fontSize="sm" mb={1}>{label}</Text>
      {children}
      {hint ? <Text color="gray.500" fontSize="sm" mt={1}>{hint}</Text> : null}
    </Box>
  )
}

export default function EventSeriesAdminPage() {
  const [list, setList] = useState<{ slug: string; name: string }[]>([])
  const [draft, setDraft] = useState<SeriesDraft>(emptyDraft())
  const [routes, setRoutes] = useState<CatalogRoute[]>([])
  const [schedule, setSchedule] = useState<PlannedRace[]>([])
  const [webhook, setWebhook] = useState('')
  const [clearWebhook, setClearWebhook] = useState(false)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [slugTouched, setSlugTouched] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')

  const saved = list.some((item) => item.slug === draft.slug)

  function patch(next: Partial<SeriesDraft>) {
    setDraft((current) => ({ ...current, ...next }))
  }

  function startNew() {
    setDraft(emptyDraft())
    setRoutes([])
    setSchedule([])
    setWebhook('')
    setClearWebhook(false)
    setLogoFile(null)
    setSlugTouched(false)
    setError('')
    setNotice('')
  }

  async function loadList() {
    const res = await fetch('/api/admin/events/event-series', { cache: 'no-store' })
    if (!res.ok) {
      setError(await errorMessage(res))
      return
    }
    const body = await res.json()
    setList(Array.isArray(body.series) ? body.series : [])
  }

  async function openSeries(slug: string) {
    setBusy('load')
    setError('')
    setWebhook('')
    setClearWebhook(false)
    setLogoFile(null)
    setSlugTouched(true)
    const res = await fetch(`/api/admin/events/event-series?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
    setBusy('')
    if (!res.ok) {
      setError(await errorMessage(res))
      return
    }
    const body = await res.json()
    setDraft(fromApi(body.series))
    setRoutes(Array.isArray(body.routes) ? body.routes : [])
    setSchedule(Array.isArray(body.schedule) ? body.schedule : [])
  }

  useEffect(() => {
    void loadList()
  }, [])

  async function save(options?: { quiet?: boolean }) {
    setBusy('save')
    setError('')
    if (!options?.quiet) setNotice('')
    if (!draft.name.trim()) {
      setBusy('')
      setError('A series name is required.')
      return false
    }
    if (draft.kind === 'weekly' && draft.published && !draft.anchorDate) {
      setBusy('')
      setError('Choose the date of the first race before showing a weekly series on the site.')
      return false
    }
    if (draft.kind === 'limited' && draft.races.some((race) => !race.date || !race.route)) {
      setBusy('')
      setError('Every race needs a date and a route. Add the routes first, or remove the unfinished race.')
      return false
    }
    if (draft.races.some((race) => (race.starts || []).some((start) => eventIdFromInput(start.eventId) === null))) {
      setBusy('')
      setError('Event id must be the number from the Zwift event, or the event page address.')
      return false
    }
    const res = await fetch('/api/admin/events/event-series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhook,
        clearWebhook,
        series: {
          ...draft,
          rules: orderedRules(draft.rules),
          races: draft.races.map((race) => ({
            ...race,
            starts: (race.starts || []).flatMap((start) => {
              const eventId = eventIdFromInput(start.eventId)
              return eventId ? [{ time: start.time.trim(), eventId }] : []
            }),
          })),
        },
      }),
    })
    if (!res.ok) {
      setBusy('')
      setError(await errorMessage(res))
      return false
    }
    const body = await res.json()
    const savedSeries = fromApi(body.series)
    setDraft(savedSeries)
    setSlugTouched(true)
    setWebhook('')
    setClearWebhook(false)
    if (logoFile) {
      const form = new FormData()
      form.set('slug', savedSeries.slug)
      form.set('logo', logoFile)
      const uploaded = await fetch('/api/admin/events/event-series/logo', { method: 'POST', body: form })
      if (!uploaded.ok) {
        const logoError = `The series was saved. The logo was not stored. ${await errorMessage(uploaded)}`
        setBusy('')
        await loadList()
        await openSeries(savedSeries.slug)
        setError(logoError)
        return false
      }
      const logo = await uploaded.json()
      setDraft((current) => ({ ...current, logoUrl: String(logo.logoUrl || '') }))
      setLogoFile(null)
    }
    if (!options?.quiet) setNotice('Series saved.')
    setBusy('')
    await loadList()
    if (savedSeries.slug) await openSeries(savedSeries.slug)
    return true
  }

  async function removeSeries() {
    if (!saved || !draft.slug) return
    if (!window.confirm(`Delete ${draft.name}? This removes the series, its route list, and its logo.`)) return
    setBusy('delete')
    setError('')
    setNotice('')
    const res = await fetch(`/api/admin/events/event-series?slug=${encodeURIComponent(draft.slug)}`, { method: 'DELETE' })
    setBusy('')
    if (!res.ok) {
      setError(await errorMessage(res))
      return
    }
    startNew()
    setNotice('Series deleted.')
    await loadList()
  }

  async function changeWeek(date: string, route: string) {
    setBusy(date)
    setError('')
    const res = await fetch('/api/admin/events/event-series/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'override', slug: draft.slug, date, route }),
    })
    setBusy('')
    if (!res.ok) {
      setError(await errorMessage(res))
      return
    }
    const detail = await fetch(`/api/admin/events/event-series?slug=${encodeURIComponent(draft.slug)}`, { cache: 'no-store' })
    if (!detail.ok) {
      setError(await errorMessage(detail))
      return
    }
    const body = await detail.json()
    const fresh = fromApi(body.series)
    setDraft((current) => ({ ...current, overrides: fresh.overrides, races: fresh.races }))
    setRoutes(Array.isArray(body.routes) ? body.routes : [])
    setSchedule(Array.isArray(body.schedule) ? body.schedule : [])
  }

  async function apply(date: string, route: string) {
    if (!window.confirm(`Update the Zwift event on ${date} to ${route}? This also posts to Discord when a webhook is saved.`)) return
    setNotice('')
    const savedOk = await save({ quiet: true })
    if (!savedOk) return
    setBusy(`apply:${date}:${route}`)
    setError('')
    const res = await fetch('/api/admin/events/event-series/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: draft.slug, date, route }),
    })
    setBusy('')
    if (!res.ok) {
      setError(await errorMessage(res))
      return
    }
    const body = await res.json()
    setNotice(body.discordError ? `Zwift updated. Discord: ${body.discordError}` : 'Zwift updated and posted to Discord.')
    await openSeries(draft.slug)
  }

  function updateRace(index: number, patchRace: Partial<SeriesRace>) {
    const races = draft.races.map((race, raceIndex) => (raceIndex === index ? { ...race, ...patchRace } : race))
    patch({ races })
  }

  function startsFor(date: string, route: string) {
    return draft.races.find((race) => race.date === date && race.route.toLowerCase() === route.toLowerCase())?.starts || []
  }

  function setWeekStarts(date: string, route: string, starts: RaceStart[]) {
    const index = draft.races.findIndex((race) => race.date === date && race.route.toLowerCase() === route.toLowerCase())
    const meaningful = starts.some((start) => start.eventId.trim() || start.time.trim())
    if (index < 0) {
      if (!meaningful) return
      patch({ races: [...draft.races, { date, route, label: '', match: '', starts }] })
      return
    }
    updateRace(index, { starts: meaningful ? starts : [] })
  }

  function routeChoices(current: string) {
    const names = routes.map((route) => route.route)
    if (current && !names.includes(current)) return [current, ...names]
    return names
  }

  return (
    <AdminShell title="Event series">
      <Text color="gray.400" mb={4}>
        Save the series, add its routes, then put those routes on the calendar. Apply updates the Zwift event and posts the race to Discord.
        DZR After Party and The Zwifty Fifty use the route lists the weekly rotation already has.{' '}
        <Link href="/admin/events" style={{ color: '#F6AD55' }}>Back to events</Link>
      </Text>
      {error ? (
        <Box bg="red.900" color="red.100" p={3} mb={3} borderRadius="md" whiteSpace="pre-wrap">
          {error}
        </Box>
      ) : null}
      {notice ? (
        <Box bg="green.900" color="green.100" p={3} mb={3} borderRadius="md">
          {notice}
        </Box>
      ) : null}
      <Flex gap={6} align="flex-start" wrap="wrap">
        <Stack minW="220px" spacing={2}>
          <Button colorScheme="red" onClick={startNew}>New series</Button>
          {list.map((item) => (
            <Button
              key={item.slug}
              justifyContent="flex-start"
              variant={draft.slug === item.slug ? 'solid' : 'outline'}
              colorScheme={draft.slug === item.slug ? 'red' : undefined}
              color="white"
              onClick={() => void openSeries(item.slug)}
            >
              {item.name}
            </Button>
          ))}
        </Stack>
        <Stack flex="1" minW="320px" spacing={4}>
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(e) => {
                const name = e.target.value
                patch(saved || slugTouched ? { name } : { name, slug: pageAddress(name) })
              }}
              {...field}
            />
          </Field>
          <Field label="Page address" hint={draft.slug ? `Public page: /series/${draft.slug}` : 'Filled in from the name. You can change it before the first save.'}>
            <Input
              value={draft.slug}
              isReadOnly={saved}
              onChange={(e) => {
                setSlugTouched(true)
                patch({ slug: e.target.value.toLowerCase() })
              }}
              onBlur={(e) => patch({ slug: pageAddress(e.target.value) })}
              {...field}
            />
          </Field>
          <Field label="Introduction" hint="Shown under the title on the public page. A web address becomes a link. For your own words, write [the words](https://example.com).">
            <Textarea minH="90px" value={draft.intro} onChange={(e) => patch({ intro: e.target.value })} {...field} />
          </Field>
          <Field label="Card line" hint="The short line on the landing page card, under the series name.">
            <Input value={draft.cardText} onChange={(e) => patch({ cardText: e.target.value })} {...field} />
          </Field>
          <Field label="Time" hint="Shown on the landing page card, under the card line.">
            <Input value={draft.timeLabel} onChange={(e) => patch({ timeLabel: e.target.value })} {...field} />
          </Field>
          <Field label="Words in the Zwift event name" hint="Apply uses these words when the event id is empty. The series does not create the Zwift event.">
            <Input value={draft.zwiftName} onChange={(e) => patch({ zwiftName: e.target.value })} {...field} />
          </Field>
          <Field
            label="Schedule"
            hint={draft.kind === 'weekly'
              ? 'Each week takes the next route in the list. Any week can be changed on its own.'
              : 'Enter every race. Two races can share a date when each one has extra words from its Zwift event name.'}
          >
            <Select value={draft.kind} onChange={(e) => patch({ kind: e.target.value as Kind })} {...field}>
              <option value="weekly">Weekly series</option>
              <option value="limited">Short series</option>
            </Select>
          </Field>
          <Flex align="center" gap={3}>
            <Switch colorScheme="red" isChecked={draft.published} onChange={(e) => patch({ published: e.target.checked })} />
            <Text color="white">Show on the site</Text>
          </Flex>
          <Text color="gray.500" fontSize="sm" mt={-2}>The page address works as soon as the series is saved. This adds it to the menu and as a card on the landing page.</Text>
          <Field label="Menu icon" hint="Shown next to the name when the series is in the menu.">
            <Flex gap={2} wrap="wrap">
              <SeriesIconChoices value={draft.icon} onChange={(icon) => patch({ icon })} />
            </Flex>
          </Field>
          <Flex align="center" gap={3}>
            <Switch colorScheme="red" isChecked={draft.carousel} onChange={(e) => patch({ carousel: e.target.checked })} />
            <Text color="white">Carousel</Text>
          </Flex>
          <Text color="gray.500" fontSize="sm" mt={-2}>
            {draft.kind === 'weekly'
              ? 'The next race moves through its profile, the finish close-up, and each extra climb.'
              : 'The page moves through one profile for each stage.'}
          </Text>

          <Heading size="sm" color="white">Rules</Heading>
          <Text color="gray.500" fontSize="sm">Tick the rules that apply. The page shows each one with its icon.</Text>
          <Stack spacing={2}>
            {SERIES_RULES.map((rule) => (
              <Checkbox
                key={rule.id}
                colorScheme="red"
                color="white"
                isChecked={draft.rules.some((item) => item.toLowerCase() === rule.label.toLowerCase())}
                onChange={(event) => patch({ rules: orderedRules(event.target.checked ? [...draft.rules, rule.label] : draft.rules.filter((item) => item.toLowerCase() !== rule.label.toLowerCase())) })}
              >
                <Flex as="span" align="center" gap={2}>
                  <Icon as={rule.icon} color={rule.color} boxSize="18px" />
                  <Text as="span" color="white">{rule.label}</Text>
                </Flex>
              </Checkbox>
            ))}
            {draft.rules.filter((item) => !ruleOption(item)).map((rule) => (
              <Checkbox
                key={rule}
                colorScheme="red"
                color="white"
                isChecked
                onChange={() => patch({ rules: draft.rules.filter((item) => item !== rule) })}
              >
                <Text as="span" color="white">{rule}</Text>
              </Checkbox>
            ))}
          </Stack>

          <Heading size="sm" color="white">Banner</Heading>
          <Text color="gray.500" fontSize="sm">Shown across the top of the public page.</Text>
          {draft.logoUrl ? <Image src={draft.logoUrl} alt="" maxH="160px" objectFit="contain" /> : null}
          <Field label="PNG, JPEG, or WebP, under 2 MB">
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              pt={1}
              onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              bg="gray.900"
              borderColor="gray.700"
              color="white"
              sx={{ '::file-selector-button': { marginRight: '12px', color: 'black' } }}
            />
          </Field>

          <Heading size="sm" color="white">Points</Heading>
          <Text color="gray.500" fontSize="sm">Leave the rows empty to hide the points table. An extra row can be a finish bonus or a prime.</Text>
          <Field label="Note">
            <Input placeholder="Best 4 results count" value={draft.pointsNote} onChange={(e) => patch({ pointsNote: e.target.value })} {...field} />
          </Field>
          {draft.pointsRows.map((row, index) => (
            <Flex key={index} gap={2}>
              <Input
                placeholder="Place or bonus"
                value={row.label}
                onChange={(e) => {
                  const pointsRows = draft.pointsRows.slice()
                  pointsRows[index] = { ...row, label: e.target.value }
                  patch({ pointsRows })
                }}
                {...field}
              />
              <Input
                placeholder="Points"
                value={row.points}
                onChange={(e) => {
                  const pointsRows = draft.pointsRows.slice()
                  pointsRows[index] = { ...row, points: e.target.value }
                  patch({ pointsRows })
                }}
                {...field}
              />
              <Button onClick={() => patch({ pointsRows: draft.pointsRows.filter((_, rowIndex) => rowIndex !== index) })}>Remove</Button>
            </Flex>
          ))}
          <Button alignSelf="flex-start" onClick={() => patch({ pointsRows: [...draft.pointsRows, { label: '', points: '' }] })}>
            Add points row
          </Button>
          <Field label="ZwiftPower league link">
            <Input value={draft.leagueUrl} onChange={(e) => patch({ leagueUrl: e.target.value })} {...field} />
          </Field>

          <Heading size="sm" color="white">Discord</Heading>
          <Field label="Webhook" hint="Used when you press Apply. It is not shown on the site.">
            <Input
              type="password"
              placeholder={draft.discordWebhookSet ? 'A webhook is saved. Enter a new one to replace it.' : 'https://discord.com/api/webhooks/…'}
              value={webhook}
              onChange={(e) => setWebhook(e.target.value)}
              {...field}
            />
          </Field>
          {draft.discordWebhookSet ? (
            <Flex align="center" gap={3}>
              <Switch colorScheme="red" isChecked={clearWebhook} onChange={(e) => setClearWebhook(e.target.checked)} />
              <Text color="white">Remove the saved webhook</Text>
            </Flex>
          ) : null}

          {draft.kind === 'weekly' ? (
            <Field label="First race" hint="The rotation starts on this date and repeats every seven days.">
              <DateField value={draft.anchorDate} onChange={(anchorDate) => patch({ anchorDate })} />
            </Field>
          ) : (
            <Stack spacing={3}>
              <Heading size="sm" color="white">Races</Heading>
              {routes.length ? null : (
                <Text color="gray.400">
                  {saved
                    ? 'Add at least one route before placing races. Use Edit routes, then come back.'
                    : 'Save the series, add its routes, then come back to place the races.'}
                </Text>
              )}
              {draft.races.map((race, index) => (
                <Box key={index} borderWidth="1px" borderColor="gray.700" borderRadius="md" p={3}>
                  <Flex gap={2} wrap="wrap">
                    <DateField value={race.date} onChange={(date) => updateRace(index, { date })} />
                    <Select value={race.route} onChange={(e) => updateRace(index, { route: e.target.value })} {...field}>
                      <option value="">Route</option>
                      {routeChoices(race.route).map((route) => (
                        <option key={route} value={route}>{route}</option>
                      ))}
                    </Select>
                    <Input placeholder="Stage name" value={race.label} onChange={(e) => updateRace(index, { label: e.target.value })} {...field} />
                    <Input placeholder="Extra words in the Zwift name" value={race.match} onChange={(e) => updateRace(index, { match: e.target.value })} {...field} />
                  </Flex>
                  <Text color="gray.500" fontSize="sm" mt={2}>
                    Leave the event id empty to find the race on the public calendar. Type the id when the event is not listed there. Save the series to show the race pass.
                  </Text>
                  <Box mt={2}>
                    <EventIds starts={race.starts || []} onChange={(starts) => updateRace(index, { starts })} />
                  </Box>
                  <Flex gap={2} mt={2}>
                    <Button onClick={() => patch({ races: draft.races.filter((_, raceIndex) => raceIndex !== index) })}>Remove</Button>
                    <Button
                      colorScheme="red"
                      size="sm"
                      isDisabled={!saved || !race.date || !race.route}
                      isLoading={busy === `apply:${race.date}:${race.route}`}
                      onClick={() => void apply(race.date, race.route)}
                    >
                      Apply
                    </Button>
                  </Flex>
                </Box>
              ))}
              <Button
                alignSelf="flex-start"
                isDisabled={!routes.length}
                onClick={() => patch({ races: [...draft.races, { date: '', route: routes[0]?.route || '', label: '', match: '', starts: [] }] })}
              >
                Add race
              </Button>
            </Stack>
          )}

          <Flex gap={2} wrap="wrap">
            <Button colorScheme="red" isLoading={busy === 'save'} onClick={() => void save()}>Save series</Button>
            {saved ? (
              <Button as={Link} href={`/admin/events/routes?series=${encodeURIComponent(draft.slug)}`}>
                Edit routes
              </Button>
            ) : null}
            {saved ? (
              <Button as={Link} href={`/series/${draft.slug}`}>
                View page
              </Button>
            ) : null}
            {saved && draft.slug !== 'after-party' && draft.slug !== 'zwifty-fifty' ? (
              <Button variant="outline" colorScheme="red" isLoading={busy === 'delete'} onClick={() => void removeSeries()}>
                Delete series
              </Button>
            ) : null}
          </Flex>

          {saved && draft.kind === 'weekly' ? (
            <Stack spacing={2}>
              <Heading size="sm" color="white">Coming weeks</Heading>
              {!draft.anchorDate ? <Text color="gray.400">Choose the first race date and save.</Text> : null}
              {draft.anchorDate && !routes.length ? <Text color="gray.400">Add a route before the weeks can be filled in.</Text> : null}
              {schedule.map((row) => (
                <Box key={row.date} borderWidth="1px" borderColor="gray.700" borderRadius="md" p={3}>
                  <Flex gap={2} wrap="wrap" align="center">
                    <Text color="white" minW="180px">{row.label || row.date}</Text>
                    <Select
                      value={row.routeName}
                      isDisabled={!routes.length}
                      onChange={(e) => void changeWeek(row.date, e.target.value)}
                      {...field}
                    >
                      {routeChoices(row.routeName).map((route) => (
                        <option key={route} value={route}>{route}</option>
                      ))}
                    </Select>
                    <Button
                      colorScheme="red"
                      size="sm"
                      isDisabled={!row.routeName}
                      isLoading={busy === `apply:${row.date}:${row.routeName}`}
                      onClick={() => void apply(row.date, row.routeName)}
                    >
                      Apply
                    </Button>
                  </Flex>
                  <Text color="gray.500" fontSize="sm" mt={2}>
                    Leave the event id empty to find the race on the public calendar. Type the id when the event is not listed there. Save the series to show the race pass.
                  </Text>
                  <Box mt={2}>
                    <EventIds
                      starts={startsFor(row.date, row.routeName)}
                      onChange={(starts) => setWeekStarts(row.date, row.routeName, starts)}
                    />
                  </Box>
                </Box>
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Flex>
    </AdminShell>
  )
}
