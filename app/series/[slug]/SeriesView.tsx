'use client'

import { ExternalLinkIcon } from '@chakra-ui/icons'
import {
  Center,
  Container,
  Divider,
  Flex,
  Heading,
  Image,
  Link as ChakraLink,
  SimpleGrid,
  Stack,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
} from '@chakra-ui/react'
import { RouteProfilePreview } from '@/components/route-profile/RouteProfilePreview'
import { SeriesRulesList } from '@/components/series/SeriesRules'
import { zwiftInsiderUrl } from '@/packages/shared/routeProfile'
import SlideCarousel from '@/components/series/SlideCarousel'
import type { CatalogRoute } from '@/app/lib/catalogRoute'

type RaceStart = { time: string; eventId: string }

export type SeriesRaceView = {
  date: string
  label: string
  routeName: string
  route: CatalogRoute | null
  starts: RaceStart[]
}

export type SeriesPageData = {
  slug: string
  name: string
  intro: string
  timeLabel: string
  kind: 'weekly' | 'limited'
  logoUrl: string
  rules: string[]
  carousel: boolean
  pointsNote: string
  pointsRows: { label: string; points: string }[]
  leagueUrl: string
  schedule: SeriesRaceView[]
}

function insiderLink(route: CatalogRoute) {
  return route.linkRoute.trim() || zwiftInsiderUrl(route.zwiftRouteName || route.route)
}

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function ordinalDay(iso: string) {
  const day = Number(iso.slice(8, 10))
  const teen = day % 100
  const suffix = teen >= 11 && teen <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] || 'th'
  return `${day}${suffix}`
}

function stageDate(iso: string, includeMonth: boolean) {
  const day = ordinalDay(iso)
  if (!includeMonth) return day
  const month = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))))
    .toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })
  return `${day} ${month}`
}

function sprintColumns(route: CatalogRoute) {
  return route.sprints
    .map((name, index) => ({
      name: name.trim(),
      laps: (route.sprintLaps[index] || '').trim(),
    }))
    .filter((row) => row.name)
}

function bonusValues(route: CatalogRoute) {
  return route.bonus.map((value) => value.trim()).filter(Boolean)
}

function hasWeeklyPoints(route: CatalogRoute | null) {
  return Boolean(route && (sprintColumns(route).length || bonusValues(route).length))
}

function CourseProfile({ route, carousel = false }: { route: CatalogRoute; carousel?: boolean }) {
  const bonus = sprintColumns(route)
  return (
    <Stack spacing={4}>
      <RouteProfilePreview
        request={{
          world: route.world,
          route: route.zwiftRouteName || route.route,
          laps: route.laps,
          distance: route.distance,
          finish: route.finish,
          climbs: route.climbs,
          customClimbs: route.customClimbs,
        }}
        showClimbs={route.climbs.length + route.customClimbs.length > 0}
        showFinish={carousel && Boolean(route.finish)}
        bonusSprints={bonus}
        carousel={carousel}
      />
    </Stack>
  )
}

function EventLinks({ starts }: { starts: RaceStart[] }) {
  const linked = starts.filter((start) => start.eventId)
  if (!linked.length) return null
  return (
    <Stack spacing={1} align="center">
      {linked.map((start) => (
        <Stack key={start.eventId} spacing={1} align="center">
          {start.time ? <Text color="white">{start.time}</Text> : null}
          <Text color="white">
            ZwiftPower:{' '}
            <ChakraLink color="orange" href={`https://zwiftpower.com/events.php?zid=${start.eventId}`} isExternal>
              ZwiftPower<ExternalLinkIcon mx="2px" />
            </ChakraLink>
          </Text>
          <Text color="white">
            Race Pass:{' '}
            <ChakraLink color="orange" href={`https://www.zwift.com/eu/events/view/${start.eventId}`} isExternal>
              Zwift<ExternalLinkIcon mx="2px" />
            </ChakraLink>
          </Text>
        </Stack>
      ))}
    </Stack>
  )
}

function RulesBlock({ rules }: { rules: string[] }) {
  if (!rules.length) return null
  return (
    <Stack spacing={3}>
      <Heading color="white" fontSize="2xl">Rules</Heading>
      <SeriesRulesList rules={rules} />
    </Stack>
  )
}

function AwardTable({ label, values, suffix = '' }: { label: string; values: string[]; suffix?: string }) {
  if (!values.length) return null
  return (
    <TableContainer>
      <Table size="sm" color="white" borderColor="white" border="1px">
        <Thead>
          <Tr>
            <Th textAlign="left" color="white" borderRight="1px solid white">Position</Th>
            {values.map((_, index) => (
              <Th key={index} textAlign="center" color="white" borderRight="1px solid white">{index + 1}</Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          <Tr>
            <Td textAlign="left" borderRight="1px solid white" fontWeight="700">{label}</Td>
            {values.map((value, index) => (
              <Td key={index} textAlign="center" borderRight="1px solid white">{value}{suffix}</Td>
            ))}
          </Tr>
        </Tbody>
      </Table>
    </TableContainer>
  )
}

function PointsSection({ route }: { route: CatalogRoute }) {
  const sprints = sprintColumns(route)
  const bonuses = bonusValues(route)
  const finish = route.award === 'points' ? route.finishPoints.map((value) => value.trim()).filter(Boolean) : []
  const points = route.award === 'points'
  if (!sprints.length && !bonuses.length && !finish.length) return null
  return (
    <Stack spacing={4}>
      <Heading as="h1" size="lg" color="white">{points ? 'Points' : 'Bonus Sprints'}</Heading>
      {sprints.length ? (
        <>
          <Heading color="white" fontSize="md">
            {points
              ? 'First across line (FAL) points are awarded on segments below'
              : 'First across line (FAL) bonus seconds on segments below'}
          </Heading>
          <TableContainer>
            <Table size="sm" color="white" borderColor="white" border="1px">
              <Thead>
                <Tr>
                  <Th textAlign="left" color="white" borderRight="1px solid white">Segment</Th>
                  {sprints.map((sprint) => (
                    <Th key={sprint.name} textAlign="center" color="white" borderRight="1px solid white">{sprint.name}</Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                <Tr>
                  <Td textAlign="left" borderRight="1px solid white" fontWeight="700">Laps</Td>
                  {sprints.map((sprint) => (
                    <Td key={sprint.name} textAlign="center" borderRight="1px solid white">{sprint.laps}</Td>
                  ))}
                </Tr>
              </Tbody>
            </Table>
          </TableContainer>
        </>
      ) : null}
      {bonuses.length ? (
        <>
          <Heading color="white" fontSize="md">
            {points ? 'Points on each segment are awarded according to' : 'Bonus seconds on each sprint are awarded according to'}
          </Heading>
          <AwardTable label={points ? 'Points' : 'Bonus'} values={bonuses} suffix={points ? '' : 's'} />
        </>
      ) : null}
      {finish.length ? (
        <>
          <Heading color="white" fontSize="md">First across line (FAL) points are awarded on the finish according to</Heading>
          <AwardTable label="Points" values={finish} />
        </>
      ) : null}
    </Stack>
  )
}

function WeeklyPointsRace({ series, race }: { series: SeriesPageData; race: SeriesRaceView }) {
  const route = race.route
  const start = race.starts.find((item) => item.eventId)
  return (
    <Stack spacing={6}>
      <Heading color="white">{series.name}</Heading>
      {series.intro ? (
        <Text color="white" fontSize="lg" whiteSpace="pre-line">{series.intro}</Text>
      ) : null}
      <RulesBlock rules={series.rules} />
      <Heading as="h1" size="lg" color="white">{race.label || race.date}</Heading>
      {series.timeLabel ? <Heading as="h2" size="md" color="white">{series.timeLabel}</Heading> : null}
      {route ? (
        <TableContainer>
          <Table size="sm" color="white" borderColor="white" border="1px">
            <Thead>
              <Tr>
                {['Race Pass', 'ZwiftPower', 'World', 'Route', 'Laps', 'Km', 'Hm'].map((heading) => (
                  <Th key={heading} textAlign="center" color="white">{heading}</Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              <Tr>
                <Td textAlign="center">
                  {start ? (
                    <ChakraLink color="orange" href={`https://www.zwift.com/eu/events/view/${start.eventId}`} isExternal>
                      Zwift<ExternalLinkIcon mx="2px" />
                    </ChakraLink>
                  ) : '—'}
                </Td>
                <Td textAlign="center">
                  {start ? (
                    <ChakraLink color="orange" href={`https://zwiftpower.com/events.php?zid=${start.eventId}`} isExternal>
                      ZwiftPower<ExternalLinkIcon mx="2px" />
                    </ChakraLink>
                  ) : '—'}
                </Td>
                <Td textAlign="center">{route.world}</Td>
                <Td textAlign="center">
                  {insiderLink(route) ? (
                    <ChakraLink color="orange" href={insiderLink(route)} isExternal>
                      {route.route}<ExternalLinkIcon mx="2px" />
                    </ChakraLink>
                  ) : route.route}
                </Td>
                <Td textAlign="center">{route.laps}</Td>
                <Td textAlign="center">{route.distance}</Td>
                <Td textAlign="center">{route.elevation}</Td>
              </Tr>
            </Tbody>
          </Table>
        </TableContainer>
      ) : null}
      <Heading as="h1" size="lg" color="white">Route Profile and Key Climbs</Heading>
      {route ? <Heading as="h2" size="lg" color="white">{route.route}</Heading> : null}
      {route ? (
        <CourseProfile route={route} carousel={series.carousel} />
      ) : (
        <Text color="gray.400">Add a route in the series setup to show the course here.</Text>
      )}
      {route ? <PointsSection route={route} /> : null}
    </Stack>
  )
}

function WeeklyRace({ series, race }: { series: SeriesPageData; race: SeriesRaceView }) {
  const route = race.route
  if (hasWeeklyPoints(route)) return <WeeklyPointsRace series={series} race={race} />
  return (
    <Stack spacing={6}>
      {series.intro ? (
        <Text color="white" fontSize="md" align="center" whiteSpace="pre-line">{series.intro}</Text>
      ) : null}
      <RulesBlock rules={series.rules} />
      <Center><Divider width="50%" /></Center>
      <Center>
        <Stack spacing={2} align="center">
          <Heading as="h1" color="white">{race.label || race.date}</Heading>
          {series.timeLabel ? <Heading color="white">{series.timeLabel}</Heading> : null}
        </Stack>
      </Center>
      <Center><Divider width="50%" /></Center>
      {route ? (
        <Center>
          <Stack spacing={1} align="center">
            <Text color="white">World: {route.world}</Text>
            <Text color="white">Route: {route.route}</Text>
            <Text color="white">Laps: {route.laps}</Text>
            <Text color="white">Distance: {route.distance} km</Text>
            <Text color="white">Elevation: {route.elevation} hm</Text>
            {route.finish ? <Text color="white">Finish: {route.finish}</Text> : null}
            {insiderLink(route) ? (
              <Text color="white">
                Route:{' '}
                <ChakraLink color="orange" href={insiderLink(route)} isExternal>
                  {route.route}<ExternalLinkIcon mx="2px" />
                </ChakraLink>
              </Text>
            ) : null}
            <EventLinks starts={race.starts} />
          </Stack>
        </Center>
      ) : null}
      <Center><Divider width="75%" /></Center>
      <Center><Heading color="white">Profiles</Heading></Center>
      {route ? (
        <CourseProfile route={route} carousel={series.carousel} />
      ) : (
        <Text color="gray.400" align="center">Add a route in the series setup to show the course here.</Text>
      )}
    </Stack>
  )
}

function LimitedSeries({ series }: { series: SeriesPageData }) {
  const months = new Set(series.schedule.map((race) => race.date.slice(0, 7)))
  const includeMonth = months.size > 1
  return (
    <Stack spacing={4}>
      <Heading color="white">{series.name}</Heading>
      {series.intro ? (
        <Text color="white" fontSize="lg" whiteSpace="pre-line">{series.intro}</Text>
      ) : null}
      {series.rules.length ? (
        <>
          <Heading color="white" fontSize="2xl">Rules</Heading>
          <SeriesRulesList rules={series.rules} />
        </>
      ) : null}
      {series.schedule.length ? (
        <>
          <Heading color="white" fontSize="2xl">Stages Overview</Heading>
          {series.timeLabel ? <Heading color="white" fontSize="md">{series.timeLabel}</Heading> : null}
          <TableContainer textAlign="center">
            <Table size="sm" color="white" borderColor="white" border="1px">
              <Thead>
                <Tr>
                  {['Race Pass', 'Date', 'World', 'Route', 'Laps', 'Km', 'Hm'].map((heading) => (
                    <Th key={heading} textAlign="center" color="white">{heading}</Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {series.schedule.map((race) => {
                  const event = race.starts.find((start) => start.eventId)
                  return (
                    <Tr key={`${race.date}-${race.label}-${race.routeName}`}>
                      <Td textAlign="center">
                        {event ? (
                          <ChakraLink color="orange" href={`https://www.zwift.com/eu/events/view/${event.eventId}`} isExternal>
                            {race.label || race.routeName}
                          </ChakraLink>
                        ) : (
                          race.label || race.routeName
                        )}
                      </Td>
                      <Td textAlign="center">{stageDate(race.date, includeMonth)}</Td>
                      <Td textAlign="center">{race.route?.world || ''}</Td>
                      <Td textAlign="center">
                        {race.route && insiderLink(race.route) ? (
                          <ChakraLink color="orange" href={insiderLink(race.route)} isExternal>
                            {race.routeName}
                          </ChakraLink>
                        ) : (
                          race.routeName
                        )}
                      </Td>
                      <Td textAlign="center">{race.route?.laps || ''}</Td>
                      <Td textAlign="center">{race.route?.distance || ''}</Td>
                      <Td textAlign="center">{race.route?.elevation || ''}</Td>
                    </Tr>
                  )
                })}
              </Tbody>
            </Table>
          </TableContainer>
        </>
      ) : null}
      <Heading color="white" fontSize="2xl">Route Profiles</Heading>
      {series.carousel ? (
        <Stack spacing={3}>
          <SlideCarousel
            slides={series.schedule.flatMap((race) => (
              race.route ? [(
                <Stack key={`${race.date}-${race.label}`} spacing={2}>
                  <Heading color="white" fontSize="lg">{[race.label, race.routeName].filter(Boolean).join(' · ')}</Heading>
                  <CourseProfile route={race.route} />
                </Stack>
              )] : []
            ))}
          />
        </Stack>
      ) : series.schedule.map((race) => (
        race.route ? (
          <Stack key={`${race.date}-${race.label}`} spacing={2}>
            <Heading color="white" fontSize="lg">{[race.label, race.routeName].filter(Boolean).join(' · ')}</Heading>
            <CourseProfile route={race.route} />
          </Stack>
        ) : null
      ))}
      {series.pointsRows.length || series.pointsNote || series.leagueUrl ? (
        <>
          <Heading color="white" fontSize="2xl">Point Structure</Heading>
          {series.pointsNote.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => (
            <Heading key={line} color="white" fontSize="md">{line}</Heading>
          ))}
          {series.pointsRows.length ? (
            <TableContainer textAlign="center">
              <Table size="sm" color="white" borderColor="white" border="1px">
                <Tbody>
                  {series.pointsRows.map((row) => (
                    <Tr key={`${row.label}-${row.points}`}>
                      <Td textAlign="center">{row.label}</Td>
                      <Td textAlign="center">{row.points}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </TableContainer>
          ) : null}
          {series.leagueUrl ? (
            <>
              <Heading color="white" fontSize="2xl">Results</Heading>
              <Heading color="white" fontSize="md">
                Keep track of your performance and progress throughout the series on :{' '}
                <ChakraLink color="orange" href={series.leagueUrl} isExternal>ZwiftPower</ChakraLink>
              </Heading>
            </>
          ) : null}
        </>
      ) : null}
    </Stack>
  )
}

export default function SeriesView({ series }: { series: SeriesPageData }) {
  const today = todayIso()
  const next = series.schedule.find((race) => race.date >= today) || series.schedule[0]
  return (
    <Container maxW={{ base: '90%', md: '5xl' }} py={0} mb={20}>
      <SimpleGrid columns={1} spacing={10}>
        {series.logoUrl ? (
          <Flex>
            <Image rounded="md" alt={`${series.name} banner`} src={series.logoUrl} objectFit="contain" w="100%" />
          </Flex>
        ) : null}
        {series.kind === 'weekly' ? (
          next ? <WeeklyRace series={series} race={next} /> : (
            <Stack spacing={4}>
              {!series.logoUrl ? <Heading color="white">{series.name}</Heading> : null}
              {series.intro ? <Text color="white" align="center" whiteSpace="pre-line">{series.intro}</Text> : null}
            </Stack>
          )
        ) : (
          <LimitedSeries series={series} />
        )}
      </SimpleGrid>
    </Container>
  )
}
