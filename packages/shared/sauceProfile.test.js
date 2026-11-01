const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const { routeElevation, measuredProfileSegments, jerseyMarker, dictionarySegmentName, worldKey, resolveProfileRoute } = require("./sauceProfile")

const routes = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "sauce", "routes.json"), "utf8"))

test("jersey icon decides sprint, climb, or segment", () => {
  assert.equal(jerseyMarker("WhiteOrangeTheme/GreenJersey.png"), "sprint")
  assert.equal(jerseyMarker("Jerseys/DesertSprint.png"), "sprint")
  assert.equal(jerseyMarker("Jerseys/PolkaDots.png"), "climb")
  assert.equal(jerseyMarker("Jerseys/NationalForestKOM.png"), "climb")
  assert.equal(jerseyMarker("Jerseys/OrangeBadge.png"), "segment")
  assert.equal(jerseyMarker(""), "segment")
})

test("a reverse arch uses the reverse dictionary name", () => {
  assert.equal(dictionarySegmentName({ direction: "reverse", archFriendlyName: "Sprint", archFriendlyNameR: "Sprint Rev" }), "Sprint Rev")
  assert.equal(dictionarySegmentName({ archFriendlyName: "Epic KOM", name: "EPIC_KOM" }), "Epic KOM")
})

test("a Sauce lap is close to the route length and starts at the banner", () => {
  const route = routes.find((row) => row && row.name === "Tempus Fugit")
  assert.ok(route, "Tempus Fugit is in the Sauce snapshot")
  const line = routeElevation(route.id)
  assert.ok(line.distance.length > 10)
  assert.equal(line.distance[0], 0)
  const lengthM = line.distance[line.distance.length - 1]
  const official = Number(route.distanceInMeters)
  assert.ok(Math.abs(lengthM - official) / official < 0.08, `${lengthM} vs ${official}`)
  assert.ok(line.altitude.every((height) => Number.isFinite(height)))
})

test("dictionary arches on the route keep the Sauce arch id", () => {
  const route = routes.find((row) => row && row.name === "Elevation Evaluation")
  const rows = [{
    signature: 1063365476,
    onRoutes: String(route.id),
    direction: "forward",
    archFriendlyName: "The Grade",
    jerseyIconPath: "Jerseys/PolkaDots.png",
  }]
  const placed = measuredProfileSegments(route.id, rows)
  assert.equal(placed.length, 1)
  assert.equal(placed[0].name, "The Grade")
  assert.equal(placed[0].type, "climb")
  assert.equal(placed[0].archId, 77)
  assert.ok(Math.abs(placed[0].fromKm - 2.855) < 0.01)
})

test("world names fold the same way as dictionary map codes", () => {
  assert.equal(worldKey("Watopia"), worldKey("WATOPIA"))
  assert.equal(worldKey("Makuri Islands"), worldKey("MAKURI_ISLANDS"))
  assert.equal(worldKey("Makuri"), "makuriislands")
  assert.equal(worldKey("New York"), worldKey("NEWYORK"))
  assert.equal(worldKey("Crit City"), worldKey("CRIT_CITY"))
  assert.equal(worldKey("Bologna"), worldKey("BOLOGNATT"))
})

test("a name match uses the world, and one drawable copy wins", () => {
  const rows = [
    { signature: 1, name: "Volcano Circuit", map: "WATOPIA", leadinDistanceInMeters: 400 },
    { signature: 2, name: "Volcano Circuit", map: "MAKURI_ISLANDS" },
  ]
  assert.equal(resolveProfileRoute(rows, { name: "volcano circuit" }).error, "Several routes match that name. Add the world.")
  assert.equal(resolveProfileRoute(rows, { name: "Volcano Circuit", world: "Watopia" }).id, "1")
  assert.equal(resolveProfileRoute(rows, { routeId: "2" }).id, "2")
  assert.equal(resolveProfileRoute([], { name: "Missing" }).error, "No Zwift route matched that name")
  const tempus = routes.find((row) => row.name === "Tempus Fugit")
  const picked = resolveProfileRoute([
    { signature: tempus.id, name: "Tempus Fugit", map: "WATOPIA" },
    { signature: 999, name: "Tempus Fugit", map: "WATOPIA" },
  ], { name: "Tempus Fugit", world: "Watopia" })
  assert.equal(picked.id, String(tempus.id))
})

test("a whole-lap banner is a point and a long climb keeps its length", () => {
  const alpe = measuredProfileSegments(2663908549, [{
    signature: 2233445522,
    onRoutes: "2663908549",
    archFriendlyName: "Alpe du Zwift",
    jerseyIconPath: "Jerseys/PolkaDots.png",
  }])
  assert.equal(alpe[0].type, "climb")
  assert.ok(alpe[0].toKm - alpe[0].fromKm > 10)
  const banner = measuredProfileSegments(3266658632, [{
    signature: routes.find((row) => row.name === "Caldera Coaster").segments[0].id,
    onRoutes: "3266658632",
    archFriendlyName: "Caldera Cruiser Reverse",
    jerseyIconPath: "Jerseys/OrangeBadge.png",
  }])
  assert.equal(banner[0].fromKm, banner[0].toKm)
  assert.equal(banner[0].type, "segment")
})

test("a negative or lead-in offset is not a lap marker", () => {
  const route = routes.find((row) => row && (row.segments || []).some((segment) => segment.leadinOnly || Number(segment.offset) < 0))
  const entry = route.segments.find((segment) => segment.leadinOnly || Number(segment.offset) < 0)
  const placed = measuredProfileSegments(route.id, [{
    signature: entry.id,
    onRoutes: String(route.id),
    archFriendlyName: "Pens",
    jerseyIconPath: "Jerseys/GreenJersey.png",
  }])
  assert.equal(placed.length, 0)
})
