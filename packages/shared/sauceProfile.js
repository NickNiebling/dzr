/**
 * Route elevation and dictionary segment markers from the vendored Sauce snapshot.
 *
 * Height is the road point's z, converted the way the game does it: subtract the
 * world's sea level, add its elevation offset, divide by 100, then apply
 * physicsSlopeScale. A road position is an index into the curve,
 * percent * (nodeCount - 3) + 1. Distances from route_elevation are metres
 * from the start banner. Lead-in rows are the pens and are not part of the lap.
 */
const fs = require("node:fs")
const path = require("node:path")

const SAMPLE_M = 20

const worldsCache = new Map()
const roadsCache = new Map()
const segmentsCache = new Map()
const nodesCache = new Map()
let routesCache = null

function dataDir() {
  return process.env.SAUCE_DATA_DIR || path.join(process.cwd(), "data", "sauce")
}

function readJson(relativePath) {
  const file = path.join(dataDir(), relativePath)
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function worlds() {
  if (worldsCache.size) return worldsCache
  for (const row of readJson("worldlist.json")) worldsCache.set(Number(row.worldId), row)
  return worldsCache
}

function routes() {
  if (routesCache) return routesCache
  routesCache = new Map()
  const rows = readJson("routes.json")
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && typeof row === "object") routesCache.set(String(row.id), row)
  }
  return routesCache
}

function roads(worldId) {
  const key = Number(worldId)
  if (roadsCache.has(key)) return roadsCache.get(key)
  const indexed = new Map()
  for (const row of readJson(`worlds/${key}/roads.json`)) indexed.set(Number(row.id), row)
  roadsCache.set(key, indexed)
  return indexed
}

function segmentsById(worldId) {
  const key = Number(worldId)
  if (segmentsCache.has(key)) return segmentsCache.get(key)
  const indexed = new Map()
  const file = path.join(dataDir(), "worlds", String(key), "segments.json")
  if (fs.existsSync(file)) {
    const rows = JSON.parse(fs.readFileSync(file, "utf8"))
    for (const segment of Array.isArray(rows) ? rows : []) {
      if (!segment || typeof segment !== "object") continue
      if (segment.idForward != null) indexed.set(String(segment.idForward), { segment, direction: "forward" })
      if (segment.idReverse != null) indexed.set(String(segment.idReverse), { segment, direction: "reverse" })
    }
  }
  segmentsCache.set(key, indexed)
  return indexed
}

function sauceRoute(routeId) {
  return routes().get(String(routeId)) || null
}

function sauceWorldName(worldId) {
  return worlds().get(Number(worldId))?.name || ""
}

function worldKey(value) {
  const folded = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "")
  if (folded === "bolognatt") return "bologna"
  if (folded === "makuri") return "makuriislands"
  return folded
}

function foldRoute(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function describeRoute(row) {
  const id = row?.signature
  const name = String(row?.name || "").trim()
  if (id == null || !name) return null
  const sauce = sauceRoute(id)
  const leadM = Number(row.leadinDistanceInMeters) || 0
  return {
    id: String(id),
    name,
    world: sauce ? sauceWorldName(sauce.worldId) : "",
    leadInKm: leadM > 0 ? leadM / 1000 : 0,
    drawable: Boolean(sauce),
  }
}

/** Pick one dictionary route row by id, or by name and world. */
function resolveProfileRoute(rows, { routeId, name, world } = {}) {
  const list = Array.isArray(rows) ? rows : []
  if (routeId) {
    const hit = list.map(describeRoute).find((row) => row && row.id === String(routeId))
    return hit || { error: "No Zwift route matched that id" }
  }
  const wanted = foldRoute(name)
  if (!wanted) return { error: "No Zwift route matched that name" }
  let matches = list.filter((row) => foldRoute(row?.name) === wanted)
  const wantedWorld = worldKey(world || "")
  if (wantedWorld) matches = matches.filter((row) => worldKey(row?.map) === wantedWorld)
  const described = matches.map(describeRoute).filter(Boolean)
  if (described.length === 1) return described[0]
  const drawable = described.filter((row) => row.drawable)
  if (drawable.length === 1) return drawable[0]
  if (!described.length) return { error: "No Zwift route matched that name" }
  return { error: "Several routes match that name. Add the world." }
}

function altitudeM(worldId, zCm) {
  const world = worlds().get(Number(worldId)) || {}
  const scale = Number(world.physicsSlopeScale) || 1
  const sea = Number(world.seaLevel) || 0
  const offset = Number(world.eleOffset) || 0
  return ((Number(zCm) - sea + offset) / 100) * scale
}

function xyz(point) {
  return [Number(point[0]), Number(point[1]), Number(point[2])]
}

function lerp(t, a, b) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function cubic(t, a, b, c, d) {
  const u = 1 - t
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    u * u * u * a[2] + 3 * u * u * t * b[2] + 3 * u * t * t * c[2] + t * t * t * d[2],
  ]
}

function dist3(a, b) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function catmullControls(pPrev, p0, p1, p2) {
  const cp1 = pPrev ? [p0[0] + (p1[0] - pPrev[0]) / 6, p0[1] + (p1[1] - pPrev[1]) / 6, p0[2] + (p1[2] - pPrev[2]) / 6] : p0
  const cp2 = p2 ? [p1[0] - (p2[0] - p0[0]) / 6, p1[1] - (p2[1] - p0[1]) / 6, p1[2] - (p2[2] - p0[2]) / 6] : p1
  return [cp1, cp2]
}

function bezierControls(pPrev, p0, p1, p2, smoothing = 0.2) {
  const cp1 = pPrev
    ? [p0[0] + (p1[0] - pPrev[0]) * smoothing, p0[1] + (p1[1] - pPrev[1]) * smoothing, p0[2] + (p1[2] - pPrev[2]) * smoothing]
    : p0
  const cp2 = p2
    ? [p1[0] + (p0[0] - p2[0]) * smoothing, p1[1] + (p0[1] - p2[1]) * smoothing, p1[2] + (p0[2] - p2[2]) * smoothing]
    : p1
  return [cp1, cp2]
}

function nodes(worldId, roadId) {
  const key = `${worldId}:${roadId}`
  if (nodesCache.has(key)) return nodesCache.get(key)
  const road = roads(worldId).get(Number(roadId))
  if (!road) {
    nodesCache.set(key, [])
    return []
  }
  let points = (road.path || []).map(xyz)
  if (points.length < 2) {
    nodesCache.set(key, [])
    return []
  }
  if (road.looped && points.length >= 3) points = [points[points.length - 1], ...points, points[0], points[1]]
  const bezier = road.splineType === "Bezier"
  const built = [{ end: points[0] }]
  const last = points.length - 1
  for (let index = 0; index < last; index += 1) {
    const pPrev = index ? points[index - 1] : null
    const p0 = points[index]
    const p1 = points[index + 1]
    const p2 = index + 2 <= last ? points[index + 2] : null
    const [cp1, cp2] = bezier ? bezierControls(pPrev, p0, p1, p2) : catmullControls(pPrev, p0, p1, p2)
    built.push({ end: p1, cp1, cp2 })
  }
  nodesCache.set(key, built)
  return built
}

function pointAt(curve, offset) {
  if (!curve.length) return [0, 0, 0]
  if (offset <= 0) return curve[0].end
  const index = Math.trunc(offset)
  const frac = offset - index
  if (index >= curve.length - 1) return curve[curve.length - 1].end
  const next = curve[index + 1]
  const origin = curve[index].end
  if (!next.cp1) return lerp(frac, origin, next.end)
  return cubic(frac, origin, next.cp1, next.cp2, next.end)
}

function curveOffset(curve, percent) {
  return Number(percent) * (curve.length - 3) + 1
}

function sample(worldId, roadId, start, end) {
  const curve = nodes(worldId, roadId)
  if (curve.length < 4) return [[], []]
  const o0 = curveOffset(curve, start)
  const o1 = curveOffset(curve, end)
  const steps = Math.max(8, Math.trunc(Math.abs(o1 - o0) * 40))
  const raw = []
  for (let i = 0; i <= steps; i += 1) raw.push(pointAt(curve, o0 + (o1 - o0) * (i / steps)))
  const distances = [0]
  const altitudes = [altitudeM(worldId, raw[0][2])]
  let cursor = 0
  let previous = raw[0]
  for (let i = 1; i < raw.length; i += 1) {
    cursor += dist3(previous, raw[i]) / 100
    previous = raw[i]
    if (cursor - distances[distances.length - 1] >= SAMPLE_M) {
      distances.push(cursor)
      altitudes.push(altitudeM(worldId, raw[i][2]))
    }
  }
  if (cursor - distances[distances.length - 1] > 0.5) {
    distances.push(cursor)
    altitudes.push(altitudeM(worldId, raw[raw.length - 1][2]))
  }
  return [distances, altitudes]
}

function stitch(route, { leadinOnly = false, includeLeadin = false } = {}) {
  const empty = { distance: [], altitude: [] }
  if (!route || route.worldId == null) return empty
  const worldId = Number(route.worldId)
  const distances = []
  const altitudes = []
  let cursor = 0
  for (const entry of route.manifest || []) {
    if (!entry || typeof entry !== "object") continue
    const isLeadin = Boolean(entry.leadin)
    if (leadinOnly && !isLeadin) continue
    if (isLeadin && !includeLeadin && !leadinOnly) continue
    if (entry.roadId == null) continue
    let start = Number(entry.start) || 0
    let end = Number(entry.end) || 0
    if (entry.reverse && start <= end) {
      const swap = start
      start = end
      end = swap
    }
    const [partD, partA] = sample(worldId, Number(entry.roadId), start, end)
    if (partD.length < 2) continue
    for (let index = 0; index < partD.length; index += 1) {
      const along = cursor + partD[index]
      if (distances.length && along < distances[distances.length - 1] + 1) continue
      if (index === 0 && distances.length) continue
      distances.push(along)
      altitudes.push(partA[index])
    }
    cursor += partD[partD.length - 1]
  }
  if (distances.length < 2) return empty
  return {
    distance: distances.map((value) => Math.round(value * 100) / 100),
    altitude: altitudes.map((value) => Math.round(value * 100) / 100),
  }
}

function routeElevation(routeId) {
  return stitch(sauceRoute(routeId))
}

function routeLeadinProfile(routeId) {
  return stitch(sauceRoute(routeId), { leadinOnly: true })
}

function bannerDistanceM(routeId, roadId, percent, reverse) {
  const route = sauceRoute(routeId)
  if (!route || route.worldId == null) return null
  const worldId = Number(route.worldId)
  let cursor = 0
  const target = Number(percent)
  for (const entry of route.manifest || []) {
    if (!entry || typeof entry !== "object" || entry.leadin) continue
    if (entry.roadId == null) continue
    let start = Number(entry.start) || 0
    let end = Number(entry.end) || 0
    if (entry.reverse && start <= end) {
      const swap = start
      start = end
      end = swap
    }
    const [partD] = sample(worldId, Number(entry.roadId), start, end)
    const sliceLen = partD.length ? partD[partD.length - 1] : 0
    const sameRoad = Number(entry.roadId) === Number(roadId)
    const sameDir = Boolean(entry.reverse) === Boolean(reverse)
    const low = Math.min(start, end) - 1e-5
    const high = Math.max(start, end) + 1e-5
    if (sameRoad && sameDir && low <= target && target <= high) {
      const [partial] = sample(worldId, Number(entry.roadId), start, target)
      return cursor + (partial.length ? partial[partial.length - 1] : 0)
    }
    cursor += sliceLen
  }
  return null
}

function jerseyMarker(iconPath) {
  const fileName = String(iconPath || "").split("/").pop() || ""
  if (fileName.startsWith("Green") || fileName.startsWith("Desert")) return "sprint"
  if (fileName.includes("Polka") || fileName.startsWith("NationalForest")) return "climb"
  return "segment"
}

function dictionarySegmentName(row) {
  const direction = String(row?.direction || "")
  let name
  if (direction === "reverse") name = row?.archFriendlyNameR || row?.archFriendlyName
  else name = row?.archFriendlyName || row?.archFriendlyNameR
  if (!name) name = String(row?.name || "").replace(/_/g, " ")
  return String(name).trim()
}

function onRouteIds(raw) {
  if (Array.isArray(raw)) return new Set(raw.map((part) => String(part).trim()).filter(Boolean))
  return new Set(String(raw || "").split(",").map((part) => part.trim()).filter(Boolean))
}

function roundKm(metres) {
  return Math.round(metres / 1000 * 1000) / 1000
}

function markerRow({ name, marker, direction, fromM, lengthM, lapKm, archId }) {
  if (!name || fromM < 0) return null
  let length = lengthM
  // A lap banner stores the whole-loop length, so the arch is a point.
  // A long climb such as the Alpe is about 70 percent of its route and stays a range.
  if (lapKm > 0 && length > lapKm * 1000 * 0.98) length = 0
  const fromKm = roundKm(fromM)
  if (lapKm > 0 && fromKm > lapKm + 0.15) return null
  const toKm = roundKm(fromM + Math.max(0, length))
  const type = marker === "sprint" || marker === "climb" ? marker : "segment"
  const row = {
    name,
    type,
    fromKm,
    toKm: Math.max(fromKm, toKm),
    direction: direction === "reverse" ? "reverse" : "forward",
  }
  const arch = Number(archId)
  if (Number.isFinite(arch)) row.archId = arch
  return row
}

/**
 * Dictionary segments on one race lap, kilometres from the banner.
 * `rows` is the live dictionary SEGMENT list. Sauce supplies the metre offset
 * and archId. A generic Sauce name is replaced by the dictionary arch name.
 */
function measuredProfileSegments(routeId, rows) {
  const route = sauceRoute(routeId)
  if (!route) return []
  const worldId = route.worldId ?? route.courseId
  if (worldId == null) return []
  const wanted = String(routeId)
  const dictionary = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue
    if (!onRouteIds(row.onRoutes).has(wanted)) continue
    if (row.signature == null) continue
    dictionary.set(String(row.signature), row)
  }
  if (!dictionary.size) return []
  const byId = segmentsById(Number(worldId))
  const lapM = Number(route.distanceInMeters) || 0
  const lapKm = lapM > 0 ? lapM / 1000 : 0
  const placed = []
  const placedIds = new Set()

  for (const entry of route.segments || []) {
    if (!entry || typeof entry !== "object" || entry.leadinOnly) continue
    const segId = String(entry.id)
    const row = dictionary.get(segId)
    if (!row) continue
    const offsetM = Number(entry.offset)
    const lengthM = Number(entry.distance) || 0
    if (!Number.isFinite(offsetM) || offsetM < 0) continue
    const found = byId.get(segId)
    const direction = found?.direction || (row.direction === "reverse" ? "reverse" : "forward")
    const marker = markerRow({
      name: dictionarySegmentName(row),
      marker: jerseyMarker(row.jerseyIconPath),
      direction,
      fromM: offsetM,
      lengthM,
      lapKm,
      archId: found?.segment?.archId,
    })
    if (!marker) continue
    placed.push(marker)
    placedIds.add(segId)
  }

  for (const [segId, row] of dictionary) {
    if (placedIds.has(segId)) continue
    const found = byId.get(segId)
    if (!found) continue
    const roadId = found.segment.roadId
    const percent = found.segment.roadFinish
    if (roadId == null || percent == null) continue
    const bannerM = bannerDistanceM(routeId, Number(roadId), Number(percent), found.direction === "reverse")
    if (bannerM == null) continue
    const lengthKey = found.direction === "reverse" ? "distanceReverse" : "distanceForward"
    const lengthM = Number(found.segment[lengthKey]) || 0
    const marker = markerRow({
      name: dictionarySegmentName(row),
      marker: jerseyMarker(row.jerseyIconPath),
      direction: found.direction,
      fromM: Math.max(0, bannerM - Math.max(0, lengthM)),
      lengthM,
      lapKm,
      archId: found.segment.archId,
    })
    if (marker) placed.push(marker)
  }

  placed.sort((a, b) => a.fromKm - b.fromKm || a.toKm - b.toKm || a.name.localeCompare(b.name))
  return placed
}

module.exports = {
  routeElevation,
  routeLeadinProfile,
  measuredProfileSegments,
  jerseyMarker,
  dictionarySegmentName,
  sauceRoute,
  sauceWorldName,
  worldKey,
  resolveProfileRoute,
}
