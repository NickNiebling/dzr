'use client'

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Area, AreaChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, usePlotArea, XAxis, YAxis } from 'recharts'
import { Box, HStack, Spinner, Stack, Text } from '@chakra-ui/react'
import SlideCarousel from '@/components/series/SlideCarousel'
import type { CustomClimbRange, ProfileSegment, ProfileZoom, RaceProfile } from '@/packages/shared/routeProfile'
import { bonusNamesMatch, profileImageSrc } from '@/packages/shared/routeProfile'

const COLORS = { sprint: '#56A845', climb: '#ed2324', segment: '#718096', bonus: '#C9A227' }
const GRADE_BANDS = [
  { label: '<4%', color: '#3CB44A' },
  { label: '4–7%', color: '#2E6BFF' },
  { label: '7–10%', color: '#E10600' },
  { label: '10%+', color: '#111111' },
]

type BonusSprint = { name: string; laps?: string }

type ProfileRequest = {
  world: string
  route: string
  laps?: string
  distance?: string
  finish?: string
  climbs?: string[]
  customClimbs?: CustomClimbRange[]
}

function wantsReverse(value: string) {
  return /\b(reverse|rev\.?)\b/i.test(value)
}

function gradeColor(grade: number) {
  if (grade < 4) return GRADE_BANDS[0].color
  if (grade < 7) return GRADE_BANDS[1].color
  if (grade < 10) return GRADE_BANDS[2].color
  return GRADE_BANDS[3].color
}

function gradeBetween(
  start: { distance: number; altitude: number },
  end: { distance: number; altitude: number }
) {
  const run = (end.distance - start.distance) * 1000
  if (!(Math.abs(run) > 0.05)) return 0
  return ((end.altitude - start.altitude) / run) * 100
}

function gradeAt(points: { distance: number; altitude: number }[], distance: number) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (distance >= start.distance && distance <= end.distance) return gradeBetween(start, end)
  }
  if (points.length < 2) return 0
  return gradeBetween(points[points.length - 2], points[points.length - 1])
}

function ProfileHover({
  distance,
  altitude,
  grade,
}: {
  distance: number
  altitude: number
  grade: number
}) {
  return (
    <Box bg="#1A202C" borderWidth="1px" borderColor="#4A5568" px={3} py={2} rounded="md">
      <Text color="white" fontSize="sm">
        {distance.toFixed(1)} km
      </Text>
      <Text color="gray.300" fontSize="sm">
        Elevation: {Math.round(altitude)} m
      </Text>
      <Text color="gray.300" fontSize="sm">
        Gradient: {grade.toFixed(1)}%
      </Text>
    </Box>
  )
}

function segmentId(segment: ProfileSegment) {
  return `${segment.name}|${segment.direction}|${segment.fromKm.toFixed(3)}`
}

function isReverse(segment: ProfileSegment) {
  return segment.direction === 'reverse' || wantsReverse(segment.name)
}

export type BonusSegmentRow = {
  name: string
  type: ProfileSegment['type']
  lap: number
  fromKm: number
  toKm: number
}

function lapOf(segment: ProfileSegment, lapKm: number, leadInKm: number) {
  if (!(lapKm > 0)) return 1
  const onLap = Math.max(0, segment.fromKm - (leadInKm > 0 ? leadInKm : 0))
  return Math.floor(onLap / lapKm + 1e-6) + 1
}

function matchBonusSegments(segments: ProfileSegment[], bonusSprints: BonusSprint[], lapKm: number, leadInKm = 0) {
  const matches: { segment: ProfileSegment; name: string; lap: number }[] = []
  for (const row of bonusSprints) {
    const query = row.name.trim()
    if (!query) continue
    let candidates = segments.filter((segment) => bonusNamesMatch(segment.name, query))
    const hint = /\blong\b/i.test(query) ? 'long' : /\bshort\b/i.test(query) ? 'short' : ''
    if (hint && candidates.length > 1) {
      const sorted = [...candidates].sort((left, right) => left.toKm - left.fromKm - (right.toKm - right.fromKm))
      candidates = [hint === 'short' ? sorted[0] : sorted[sorted.length - 1]]
    } else if (wantsReverse(query) || /\bforward\b/i.test(query)) {
      const directed = candidates.filter((segment) => isReverse(segment) === wantsReverse(query))
      if (directed.length) candidates = directed
    } else {
      const forwards = candidates.filter((segment) => !isReverse(segment))
      if (forwards.length) candidates = forwards
    }
    const laps = String(row.laps || '')
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((value) => value > 0)
    for (const segment of candidates) {
      const lap = lapOf(segment, lapKm, leadInKm)
      if (laps.length && !laps.includes(lap)) continue
      matches.push({ segment, name: query, lap })
    }
  }
  return matches
}

function bonusNames(segments: ProfileSegment[], bonusSprints: BonusSprint[], lapKm: number, leadInKm = 0) {
  const labels = new Map<string, string>()
  for (const match of matchBonusSegments(segments, bonusSprints, lapKm, leadInKm)) {
    labels.set(segmentId(match.segment), match.name)
  }
  return labels
}

/** Bonus segments placed on the race profile, in race order, with km from the pens (lead-in included). */
export function bonusSegmentRows(profile: RaceProfile, bonusSprints: BonusSprint[]): BonusSegmentRow[] {
  const seen = new Set<string>()
  const rows: BonusSegmentRow[] = []
  for (const match of matchBonusSegments(profile.segments, bonusSprints, profile.lapKm, profile.leadInKm)) {
    const id = segmentId(match.segment)
    if (seen.has(id)) continue
    seen.add(id)
    rows.push({
      name: match.name,
      type: match.segment.type,
      lap: match.lap,
      fromKm: Math.min(match.segment.fromKm, match.segment.toKm),
      toKm: Math.max(match.segment.fromKm, match.segment.toKm),
    })
  }
  return rows.sort((left, right) => left.fromKm - right.fromKm || left.lap - right.lap)
}

function segmentLabel(segment: ProfileSegment, bonusName: string | undefined) {
  if (!bonusName) return segment.name
  return segment.type === 'climb' ? `Bonus: ${bonusName}` : `Bonus Sprint: ${bonusName}`
}

function textWidth(text: string) {
  if (typeof document === 'undefined') return text.length * 7
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return text.length * 7
  ctx.font = '600 12px system-ui, sans-serif'
  return ctx.measureText(text).width
}

function SegmentNames({
  bands,
  bonusLabels,
  xDomain,
}: {
  bands: ProfileSegment[]
  bonusLabels: Map<string, string>
  xDomain: [number, number]
}) {
  const plot = usePlotArea()
  if (!plot || plot.width <= 0) return null
  const [x0, x1] = xDomain
  const span = x1 - x0 || 1
  const placed: { x: number; row: number; text: string; fill: string; half: number }[] = []
  const ordered = [...bands].sort((left, right) => left.fromKm - right.fromKm)
  for (const segment of ordered) {
    const bonusName = bonusLabels.get(segmentId(segment))
    const text = segmentLabel(segment, bonusName)
    const half = textWidth(text) / 2
    const mid = (segment.fromKm + segment.toKm) / 2
    const raw = plot.x + ((mid - x0) / span) * plot.width
    const minX = plot.x + Math.min(half, plot.width / 2)
    const maxX = plot.x + plot.width - Math.min(half, plot.width / 2)
    const x = Math.min(maxX, Math.max(minX, raw))
    let row = 0
    while (placed.some((label) => label.row === row && Math.abs(label.x - x) < label.half + half + 8)) row += 1
    placed.push({ x, row, text, fill: bonusName ? '#E6C35C' : 'white', half })
  }
  return (
    <g>
      {placed.map((label) => (
        <text
          key={`${label.text}-${label.x}-${label.row}`}
          x={label.x}
          y={14 + label.row * 16}
          textAnchor="middle"
          fill={label.fill}
          fontSize={12}
          fontWeight={600}
        >
          {label.text}
        </text>
      ))}
    </g>
  )
}

function LeadInLabel({
  fromKm,
  toKm,
  xDomain,
}: {
  fromKm: number
  toKm: number
  xDomain: [number, number]
}) {
  const plot = usePlotArea()
  if (!plot || plot.width <= 0 || !(toKm > fromKm)) return null
  const [x0, x1] = xDomain
  const span = x1 - x0 || 1
  const text = 'Lead-in'
  const width = textWidth(text)
  const bandLeft = plot.x + ((Math.max(fromKm, x0) - x0) / span) * plot.width
  const bandRight = plot.x + ((Math.min(toKm, x1) - x0) / span) * plot.width
  if (bandRight - bandLeft < width + 8) return null
  return (
    <text
      x={(bandLeft + bandRight) / 2}
      y={plot.y + plot.height / 2}
      textAnchor="middle"
      dominantBaseline="middle"
      fill="white"
      fontSize={12}
      fontWeight={600}
    >
      {text}
    </text>
  )
}

function elevationDomain(points: { altitude: number }[]): [number, number] {
  const altitudes = points.map((point) => point.altitude)
  const low = Math.min(...altitudes)
  const high = Math.max(...altitudes)
  const step = high - low > 120 ? 20 : 10
  const floor = low < 40 ? 0 : Math.floor((low - step) / step) * step
  const ceil = Math.ceil((high + step * 0.4) / step) * step
  return [floor, Math.max(ceil, floor + step)]
}

function clipToWindow(points: { distance: number; altitude: number }[], fromKm: number, toKm: number) {
  const clipped: { distance: number; altitude: number }[] = []
  const at = (left: { distance: number; altitude: number }, right: { distance: number; altitude: number }, km: number) => {
    const span = right.distance - left.distance || 1
    const ratio = (km - left.distance) / span
    return { distance: km, altitude: left.altitude + (right.altitude - left.altitude) * ratio }
  }
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const previous = points[index - 1]
    if (previous && previous.distance < fromKm && point.distance >= fromKm) clipped.push(at(previous, point, fromKm))
    if (point.distance >= fromKm && point.distance <= toKm) clipped.push(point)
    if (previous && previous.distance <= toKm && point.distance > toKm) clipped.push(at(previous, point, toKm))
  }
  return clipped
}

function kmStep(span: number) {
  if (span > 8) return 2
  if (span > 3) return 1
  if (span > 1.2) return 0.5
  if (span > 0.6) return 0.2
  return 0.1
}

function RibbonChart({
  points,
  fromKm,
  toKm,
  height,
}: {
  points: { distance: number; altitude: number }[]
  fromKm: number
  toKm: number
  height: number
}) {
  const frame = useRef<HTMLDivElement>(null)
  const clipId = useId().replace(/:/g, '')
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ distance: number; altitude: number; grade: number; x: number; y: number } | null>(null)
  useEffect(() => {
    const node = frame.current
    if (!node) return
    const measure = () => setWidth(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const data = clipToWindow(points, fromKm, toKm)
  const [y0, y1] = elevationDomain(data.length ? data : points)
  const depthX = 12
  const depthY = 40
  const margin = { top: 6, right: 12, bottom: 28, left: 52 }
  const plotLeft = margin.left
  const plotWidth = Math.max(1, width - margin.left - margin.right - depthX)
  const plotTop = margin.top + depthY
  const plotHeight = Math.max(1, height - plotTop - margin.bottom)
  const xSpan = toKm - fromKm || 1
  const ySpan = y1 - y0 || 1
  const fx = (distance: number) => plotLeft + ((distance - fromKm) / xSpan) * plotWidth
  const fy = (altitude: number) => plotTop + (1 - (altitude - y0) / ySpan) * plotHeight
  const px = (distance: number, back = false) => fx(distance) + (back ? depthX : 0)
  const py = (distance: number, altitude: number, back = false) => fy(altitude) - (back ? depthY : 0)
  const ground = (_distance: number, back = false) => fy(y0) - (back ? depthY : 0)
  const front = data.map((point) => ({ x: px(point.distance), y: py(point.distance, point.altitude) }))
  const face =
    front.length > 1
      ? `M ${px(data[0].distance)} ${ground(data[0].distance)} ${front.map((point) => `L ${point.x} ${point.y}`).join(' ')} L ${px(data[data.length - 1].distance)} ${ground(data[data.length - 1].distance)} Z`
      : ''
  const quads = []
  for (let index = 0; index < data.length - 1; index += 1) {
    const start = data[index]
    const end = data[index + 1]
    const grade = gradeBetween(start, end)
    const color = gradeColor(grade)
    quads.push(
      <polygon
        key={index}
        points={`${px(start.distance)},${py(start.distance, start.altitude)} ${px(end.distance)},${py(end.distance, end.altitude)} ${px(end.distance, true)},${py(end.distance, end.altitude, true)} ${px(start.distance, true)},${py(start.distance, start.altitude, true)}`}
        fill={color}
        stroke={color}
        strokeWidth={0.6}
      />
    )
  }
  const last = data[data.length - 1]
  const cap = last
    ? `${px(last.distance)},${ground(last.distance)} ${px(last.distance)},${py(last.distance, last.altitude)} ${px(last.distance, true)},${py(last.distance, last.altitude, true)} ${px(last.distance, true)},${ground(last.distance, true)}`
    : ''
  const yStep = y1 - y0 > 120 ? 20 : 10
  const yTicks = []
  for (let altitude = y0; altitude <= y1 + 0.1; altitude += yStep) yTicks.push(altitude)
  const xTicks = []
  const step = kmStep(xSpan)
  for (let distance = Math.ceil(fromKm / step) * step; distance <= toKm + step * 0.01; distance += step) xTicks.push(distance)
  const hatch = []
  if (front.length > 1) {
    for (let x = plotLeft; x <= plotLeft + plotWidth; x += 3) {
      const along = fromKm + ((x - plotLeft) / plotWidth) * xSpan
      hatch.push(<line key={x} x1={x} y1={ground(along)} x2={x} y2={0} stroke="#D0D0D0" strokeWidth={1} />)
    }
  }
  function track(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    let nearest = data[0]
    let best = Infinity
    for (const point of data) {
      const delta = Math.abs(fx(point.distance) - x)
      if (delta < best) {
        best = delta
        nearest = point
      }
    }
    if (!nearest) {
      setHover(null)
      return
    }
    setHover({
      distance: nearest.distance,
      altitude: nearest.altitude,
      grade: gradeAt(data, nearest.distance),
      x: fx(nearest.distance),
      y: py(nearest.distance, nearest.altitude),
    })
  }

  return (
    <Box ref={frame} position="relative" h={`${height}px`} w="100%">
      {width > 0 && data.length > 1 ? (
        <svg width={width} height={height} role="img" onMouseMove={track} onMouseLeave={() => setHover(null)}>
          <polygon points={cap} fill="#E4E4E4" />
          <clipPath id={clipId}>
            <path d={face} />
          </clipPath>
          <path d={face} fill="#F7F7F7" />
          <g clipPath={`url(#${clipId})`}>{hatch}</g>
          {quads}
          <polyline
            points={front.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="#8A8A8A"
            strokeWidth={1}
          />
          <polyline
            points={data.map((point) => `${px(point.distance, true)},${py(point.distance, point.altitude, true)}`).join(' ')}
            fill="none"
            stroke="#8A8A8A"
            strokeWidth={1}
          />
          <line
            x1={px(data[0].distance)}
            y1={py(data[0].distance, data[0].altitude)}
            x2={px(data[0].distance, true)}
            y2={py(data[0].distance, data[0].altitude, true)}
            stroke="#8A8A8A"
          />
          <line
            x1={px(last.distance)}
            y1={py(last.distance, last.altitude)}
            x2={px(last.distance, true)}
            y2={py(last.distance, last.altitude, true)}
            stroke="#8A8A8A"
          />
          {yTicks.map((altitude) => (
            <text key={altitude} x={plotLeft - 8} y={fy(altitude) + 4} textAnchor="end" fill="#A0AEC0" fontSize={12}>
              {altitude} m
            </text>
          ))}
          {xTicks.map((distance) => (
            <text key={distance} x={px(distance)} y={ground(distance) + 16} textAnchor="middle" fill="#A0AEC0" fontSize={12}>
              {distance.toFixed(1)} km
            </text>
          ))}
          {hover ? (
            <g>
              <line
                x1={px(hover.distance)}
                y1={ground(hover.distance)}
                x2={px(hover.distance)}
                y2={py(hover.distance, hover.altitude)}
                stroke="#718096"
                strokeDasharray="3 3"
              />
            </g>
          ) : null}
        </svg>
      ) : null}
      {hover ? (
        <Box
          position="absolute"
          left={`${Math.min(hover.x + 12, Math.max(8, width - 148))}px`}
          top={`${Math.max(8, hover.y - 78)}px`}
          pointerEvents="none"
          zIndex={2}
        >
          <ProfileHover distance={hover.distance} altitude={hover.altitude} grade={hover.grade} />
        </Box>
      ) : null}
    </Box>
  )
}

function pointsIn(profile: RaceProfile, fromKm: number, toKm: number) {
  return profile.distanceKm
    .map((distance, index) => ({ distance, altitude: profile.altitudeM[index] || 0 }))
    .filter((point) => point.distance >= fromKm - 0.05 && point.distance <= toKm + 0.05)
}

function zoomHasChart(profile: RaceProfile, zoom: ProfileZoom) {
  return Boolean(zoom.matched) && pointsIn(profile, zoom.fromKm, zoom.toKm).length >= 2
}

function segmentsIn(segments: ProfileSegment[], fromKm: number, toKm: number, bonusLabels: Map<string, string>) {
  return segments.filter(
    (segment) =>
      segment.toKm >= fromKm &&
      segment.fromKm <= toKm &&
      (segment.type !== 'segment' || bonusLabels.has(segmentId(segment)))
  )
}

function ProfileChart({
  profile,
  fromKm,
  toKm,
  height = 220,
  bonusSprints = [],
  colorByGrade = false,
  named = false,
}: {
  profile: RaceProfile
  fromKm: number
  toKm: number
  height?: number
  bonusSprints?: BonusSprint[]
  colorByGrade?: boolean
  named?: boolean
}) {
  const data = pointsIn(profile, fromKm, toKm)
  const bonusLabels = bonusNames(profile.segments, bonusSprints, profile.lapKm, profile.leadInKm)
  const bands = segmentsIn(profile.segments, fromKm, toKm, bonusLabels)
  if (data.length < 2) return <Text color="gray.500">No elevation in this section.</Text>
  if (colorByGrade) return <RibbonChart points={data} fromKm={fromKm} toKm={toKm} height={height} />
  const xDomain: [number, number] = [fromKm, toKm]
  return (
    <Box h={`${height}px`} w="100%">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: named ? 64 : 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="distance"
            type="number"
            domain={xDomain}
            allowDataOverflow
            stroke="#A0AEC0"
            tick={{ fill: '#A0AEC0', fontSize: 12 }}
            tickFormatter={(value) => Number(value).toFixed(1)}
            unit=" km"
          />
          <YAxis type="number" stroke="#A0AEC0" tick={{ fill: '#A0AEC0', fontSize: 12 }} width={48} unit=" m" />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const distance = Number(label)
              const altitude = Number(payload[0].value)
              return <ProfileHover distance={distance} altitude={altitude} grade={gradeAt(data, distance)} />
            }}
          />
          {profile.leadInKm > fromKm + 0.05 ? (
            <ReferenceArea
              x1={fromKm}
              x2={Math.min(profile.leadInKm, toKm)}
              fill="#A0AEC0"
              fillOpacity={0.28}
              strokeOpacity={0}
              ifOverflow="hidden"
            />
          ) : null}
          <Area type="monotone" dataKey="altitude" stroke="#E2E8F0" fill="#2D3748" fillOpacity={0.9} dot={false} />
          {profile.leadInKm > fromKm + 0.05 && profile.leadInKm < toKm ? (
            <ReferenceLine x={profile.leadInKm} stroke="#E2E8F0" strokeDasharray="4 4" ifOverflow="hidden" />
          ) : null}
          {named ? <SegmentNames bands={bands} bonusLabels={bonusLabels} xDomain={xDomain} /> : null}
          {profile.leadInKm > fromKm + 0.05 && profile.leadInKm < toKm ? (
            <LeadInLabel fromKm={fromKm} toKm={profile.leadInKm} xDomain={xDomain} />
          ) : null}
          {bands.map((segment) => {
                const bonusName = bonusLabels.get(segmentId(segment))
                const color = bonusName ? COLORS.bonus : COLORS[segment.type] || COLORS.segment
                return segment.toKm - segment.fromKm < 0.05 ? (
                  <ReferenceLine
                    key={`${segment.name}-${segment.fromKm}`}
                    x={segment.fromKm}
                    stroke={color}
                    strokeWidth={3}
                    ifOverflow="visible"
                  />
                ) : (
                  <ReferenceArea
                    key={`${segment.name}-${segment.fromKm}`}
                    x1={segment.fromKm}
                    x2={segment.toKm}
                    fill={color}
                    fillOpacity={bonusName ? 0.72 : 0.4}
                    stroke={color}
                    strokeWidth={2}
                    ifOverflow="visible"
                  />
                )
          })}
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  )
}

function markerFill(color: string, alpha: number) {
  const value = color.replace('#', '')
  const red = parseInt(value.slice(0, 2), 16)
  const green = parseInt(value.slice(2, 4), 16)
  const blue = parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function legendMarks(profile: RaceProfile, bonusSprints: BonusSprint[]) {
  const fromKm = profile.leadInKm || 0
  const toKm = profile.raceKm || profile.distanceKm[profile.distanceKm.length - 1]
  const bonusLabels = bonusNames(profile.segments, bonusSprints, profile.lapKm, profile.leadInKm)
  const bands = segmentsIn(profile.segments, fromKm, toKm, bonusLabels)
  const bonus = (segment: ProfileSegment) => bonusLabels.has(segmentId(segment))
  const marks = []
  if (bands.some((segment) => segment.type === 'sprint' && !bonus(segment))) {
    marks.push({ label: 'Sprint', color: COLORS.sprint, fill: 0.4 })
  }
  if (bands.some((segment) => segment.type === 'climb' && !bonus(segment))) {
    marks.push({ label: 'KOM', color: COLORS.climb, fill: 0.4 })
  }
  if (bands.some(bonus)) marks.push({ label: 'Bonus', color: COLORS.bonus, fill: 0.72 })
  return marks
}

function SegmentLegend({ marks }: { marks: ReturnType<typeof legendMarks> }) {
  if (!marks.length) return null
  return (
    <HStack spacing={3} flexWrap="wrap" justify="flex-end" w="100%">
      {marks.map((mark) => (
        <HStack key={mark.label} spacing={1}>
          <Box
            w="14px"
            h="14px"
            bg={markerFill(mark.color, mark.fill)}
            borderWidth="2px"
            borderColor={mark.color}
            flexShrink={0}
          />
          <Text color="gray.200" fontSize="sm">{mark.label}</Text>
        </HStack>
      ))}
    </HStack>
  )
}

function GradeLegend() {
  return (
    <HStack spacing={3} mb={1} flexWrap="wrap">
      {GRADE_BANDS.map((band) => (
        <HStack key={band.label} spacing={1}>
          <Box w="12px" h="12px" bg={band.color} borderWidth="1px" borderColor="whiteAlpha.500" rounded="sm" />
          <Text color="gray.300" fontSize="xs">
            {band.label}
          </Text>
        </HStack>
      ))}
    </HStack>
  )
}

function ZoomBlock({ profile, zoom, climb }: { profile: RaceProfile; zoom: ProfileZoom; climb?: boolean }) {
  const grade = Boolean(climb || zoom.climb)
  return (
    <Box>
      <Text color="white" fontWeight="semibold" mb={1}>
        {zoom.title}
      </Text>
      {zoom.matched && grade ? <GradeLegend /> : null}
      {zoom.matched ? (
        <ProfileChart profile={profile} fromKm={zoom.fromKm} toKm={zoom.toKm} height={grade ? 280 : 180} colorByGrade={grade} />
      ) : (
        <Text color="orange.300">No matching segment on this route.</Text>
      )}
    </Box>
  )
}

export function useProfileImage(series: 'after-party' | 'zwifty-fifty', routeName: string) {
  const src = profileImageSrc(series, routeName)
  const [state, setState] = useState<'checking' | 'yes' | 'no'>('checking')
  useEffect(() => {
    let cancelled = false
    setState('checking')
    const image = new Image()
    image.onload = () => {
      if (!cancelled) setState('yes')
    }
    image.onerror = () => {
      if (!cancelled) setState('no')
    }
    image.src = src
    return () => {
      cancelled = true
    }
  }, [src])
  return state
}

export function KeepExistingImages({
  series,
  routeName,
  children,
  fallback,
}: {
  series: 'after-party' | 'zwifty-fifty'
  routeName: string
  children: ReactNode
  fallback: ReactNode
}) {
  const image = useProfileImage(series, routeName)
  if (image === 'checking') return <Spinner mx="auto" color="white" />
  if (image === 'yes') return <>{children}</>
  return <>{fallback}</>
}

export function RouteProfilePreview({
  request,
  showFinish,
  showClimbs,
  bonusSprints = [],
  onProfile,
  carousel = false,
}: {
  request: ProfileRequest | null
  showFinish?: boolean
  showClimbs?: boolean
  bonusSprints?: BonusSprint[]
  onProfile?: (profile: RaceProfile | null) => void
  carousel?: boolean
}) {
  const [profile, setProfile] = useState<RaceProfile | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const key = request
    ? [
        request.world,
        request.route,
        request.laps,
        request.distance,
        request.finish,
        (request.climbs || []).join('|'),
        JSON.stringify(request.customClimbs || []),
      ].join('\n')
    : ''

  useEffect(() => {
    if (!request?.route) {
      setProfile(null)
      setError('')
      onProfile?.(null)
      return
    }
    let cancelled = false
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({
        world: request.world,
        route: request.route,
        laps: request.laps || '',
        distance: request.distance || '',
        finish: request.finish || '',
        climbs: (request.climbs || []).join(','),
        ranges: JSON.stringify(request.customClimbs || []),
      })
      setLoading(true)
      setError('')
      void fetch(`/api/route-profile?${params.toString()}`)
        .then(async (res) => {
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(String(body.error || 'Could not load the route profile'))
          return body as RaceProfile
        })
        .then((body) => {
          if (cancelled) return
          setProfile(body)
          onProfile?.(body)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setProfile(null)
          onProfile?.(null)
          setError(err instanceof Error ? err.message : 'Could not load the route profile')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
    // The request fields are folded into key. onProfile is a refresh callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!request?.route) return null
  const overview = profile && profile.distanceKm.length > 1 ? (
    <Box>
      <Box mb={1}>
        <Text color="white" fontWeight="semibold" mb={1}>Profile</Text>
        <SegmentLegend marks={legendMarks(profile, bonusSprints)} />
      </Box>
      <ProfileChart
        profile={profile}
        fromKm={profile.distanceKm[0] ?? 0}
        toKm={profile.raceKm || profile.distanceKm[profile.distanceKm.length - 1]}
        bonusSprints={bonusSprints}
        named
      />
    </Box>
  ) : null
  let finishSlide: ReactNode = null
  if (profile && showFinish && profile.finish && profile.finish.matched) {
    const zoom = profile.finish
    finishSlide = <ZoomBlock key={`${zoom.title}-finish`} profile={profile} zoom={zoom} />
  }
  const climbSlides = profile && showClimbs
    ? profile.climbs.map((climb) => ({
        chart: zoomHasChart(profile, climb),
        node: <ZoomBlock key={`${climb.title}-${climb.fromKm}`} profile={profile} zoom={climb} climb />,
      }))
    : []
  const zooms = profile && profile.distanceKm.length > 1
    ? [
        ...(finishSlide ? [finishSlide] : []),
        ...climbSlides.map((slide) => slide.node),
      ]
    : []
  const slides = [overview, ...zooms].filter(Boolean)
  const carouselSlides = [
    overview,
    ...(profile && showFinish && profile.finish && zoomHasChart(profile, profile.finish) ? [finishSlide] : []),
    ...climbSlides.filter((slide) => slide.chart).map((slide) => slide.node),
  ].filter(Boolean)
  const shown = carousel
    ? (carouselSlides.length > 1 ? <SlideCarousel slides={carouselSlides} /> : carouselSlides)
    : slides
  return (
    <Stack spacing={4}>
      {loading ? <Text color="gray.400">Loading profile…</Text> : null}
      {error ? <Text color="red.300">{error}</Text> : null}
      {shown}
    </Stack>
  )
}
