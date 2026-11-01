const test = require("node:test")
const assert = require("node:assert")
const { parseFinish, buildRaceProfile, raceDistanceKm, profileImageSrc, mergePositionedSegments, prepareLap, shiftProfileSegments, bonusNamesMatch, zwiftInsiderUrl, placeOnRoute } = require("./routeProfile")

test("a Zwift Insider link is the route name", () => {
  assert.strictEqual(zwiftInsiderUrl("Royal Pump Room 8"), "https://zwiftinsider.com/route/royal-pump-room-8/")
  assert.strictEqual(zwiftInsiderUrl("Queen's Highway After Party"), "https://zwiftinsider.com/route/queens-highway-after-party/")
  assert.strictEqual(zwiftInsiderUrl("Champs-Élysées"), "https://zwiftinsider.com/route/champs-elysees/")
  assert.strictEqual(zwiftInsiderUrl(""), "")
})

test("an After Party finish names the segment and the pass", () => {
  assert.deepStrictEqual(parseFinish("Banner on Petit KOM Reverse"), { pass: 1, name: "Petit KOM Reverse" })
  assert.deepStrictEqual(parseFinish("Banner second time on Governor St. Climb"), {
    pass: 2,
    name: "Governor St. Climb",
  })
  assert.deepStrictEqual(parseFinish("Blue banner fourth time on Libby Hill"), { pass: 4, name: "Libby Hill" })
  assert.deepStrictEqual(parseFinish("Blue banner seventh time on top of Mech Isle Climb"), {
    pass: 7,
    name: "Mech Isle Climb",
  })
  assert.deepStrictEqual(parseFinish("New York KOM Banner"), { pass: 1, name: "New York KOM" })
})

test("a whole-number lap count uses the route length, and 1+ uses the distance", () => {
  assert.strictEqual(raceDistanceKm(9, "2", "50"), 18)
  assert.strictEqual(raceDistanceKm(9, "1+", "36.7"), 36.7)
  assert.strictEqual(raceDistanceKm(20.149, "1+", "35.285", 2.28), 33.005)
})

test("the second pass of a climb is on the next lap", () => {
  const profile = buildRaceProfile({
    distanceM: [0, 5000, 9000],
    altitudeM: [10, 40, 12],
    segments: [{ name: "Libby Hill", type: "climb", fromKm: 7, toKm: 8.2, direction: "forward" }],
    raceKm: 18,
    finishText: "Blue banner second time on Libby Hill",
    climbNames: ["Libby Hill"],
  })
  assert.strictEqual(profile.finish.matched, true)
  assert.ok(profile.finish.fromKm > 9)
  assert.strictEqual(profile.climbs[0].matched, true)
  assert.ok(profile.climbs[0].fromKm < 9)
})

test("sprint laps follow each time the segment is crossed", () => {
  const profile = buildRaceProfile({
    distanceM: [0, 10000],
    altitudeM: [0, 10],
    segments: [{ name: "Country Sprint", type: "sprint", fromKm: 2, toKm: 2.3, direction: "forward" }],
    raceKm: 30,
    finishText: "",
    climbNames: [],
  })
  assert.deepStrictEqual(profile.sprints, [{ name: "Country Sprint", laps: "1,2,3" }])
})

test("ZwiftPower names match the segment on the route", () => {
  const profile = buildRaceProfile({
    distanceM: [0, 16200],
    altitudeM: [40, 40],
    segments: [
      { name: "Richmond KOM", type: "climb", fromKm: 12, toKm: 12.6, direction: "forward" },
      { name: "Titans Grove KOM Rev.", type: "climb", fromKm: 4, toKm: 5.2, direction: "reverse" },
    ],
    raceKm: 32.4,
    finishText: "Banner second time on Governor St. Climb",
    climbNames: ["Libby Hill", "Titans Groove KOM Reverse"],
  })
  assert.strictEqual(profile.finish.matched, true)
  assert.ok(profile.finish.fromKm > 16)
  assert.strictEqual(profile.climbs[0].matched, true)
  assert.strictEqual(profile.climbs[1].matched, true)
})

test("a segment ridden backwards is not placed on the route", () => {
  const route = []
  for (let index = 0; index <= 20; index += 1) route.push([51.5 + index * 0.0002, -0.1])
  const distance = route.map((_, index) => index * 22.24)
  const forward = [route[2], route[10], route[18]]
  const hit = placeOnRoute(route, distance, forward)
  assert.ok(hit)
  assert.ok(hit.toM > hit.fromM)
  assert.strictEqual(placeOnRoute(route, distance, [route[18], route[10], route[2]]), null)
})

test("Sauce positions fill gaps and leave an existing band in place", () => {
  const merged = mergePositionedSegments(
    [{ name: "Richmond Sprint", type: "sprint", fromKm: 3.7, toKm: 3.9, direction: "forward" }],
    [
      { name: "Richmond Sprint", type: "sprint", fromKm: 3.74, toKm: 3.97, direction: "forward", archId: 4 },
      { name: "Country Sprint", type: "sprint", fromKm: 13.995, toKm: 14.142, direction: "forward", archId: 2 },
    ]
  )
  assert.deepStrictEqual(merged.map((segment) => segment.name), ["Richmond Sprint", "Country Sprint"])
  assert.strictEqual(merged[0].fromKm, 3.7)
  assert.strictEqual(merged[0].archId, 4)
  assert.strictEqual(merged[1].archId, 2)
})

test("arch id stays on a segment through the race profile", () => {
  const profile = buildRaceProfile({
    distanceM: [0, 5000, 9000],
    altitudeM: [10, 40, 12],
    segments: [{ name: "Libby Hill", type: "climb", fromKm: 7, toKm: 8.2, direction: "forward", archId: 4 }],
    raceKm: 9,
    finishText: "",
    climbNames: [],
  })
  assert.strictEqual(profile.segments[0].archId, 4)
})

test("a lead-in in the elevation stream is removed from the segment marks", () => {
  const lap = prepareLap([0, 497, 831, 1731, 46103], [5, 5, 7, 58, 144], 0.497, 45.753)
  assert.ok(lap.leadInKm > 0.4)
  const shifted = shiftProfileSegments(
    [{ name: "Zwift KOM", type: "climb", fromKm: 0.831, toKm: 1.731, direction: "forward" }],
    lap.leadInKm
  )
  assert.ok(Math.abs(shifted[0].fromKm - 0.334) < 0.01)
  assert.ok(shifted[0].toKm < 1.3)
})

test("a few extra meters of race distance do not repeat the start of the lap", () => {
  const profile = buildRaceProfile({
    distanceM: [0, 2, 17146],
    altitudeM: [132.6, 132.6, 162.8],
    segments: [],
    raceKm: 17.149,
    finishText: "",
    climbNames: [],
  })
  assert.ok(profile.altitudeM[profile.altitudeM.length - 1] > 150)
  assert.ok(profile.distanceKm[profile.distanceKm.length - 1] > 17)
})

test("a KOM finish stays on the climb when a sprint shares the world name", () => {
  const profile = buildRaceProfile({
    distanceM: [0, 17149],
    altitudeM: [120, 170],
    segments: [
      { name: "Yorkshire Sprint Rev.", type: "sprint", fromKm: 2.581, toKm: 2.978, direction: "reverse" },
      { name: "Yorkshire KOM Rev.", type: "climb", fromKm: 15.981, toKm: 17.141, direction: "reverse" },
      { name: "New York Sprint", type: "sprint", fromKm: 1, toKm: 1.3, direction: "forward" },
      { name: "New York KOM", type: "climb", fromKm: 8, toKm: 9.4, direction: "forward" },
    ],
    raceKm: 17.149,
    finishText: "Banner on Yorkshire KOM Reverse",
    climbNames: ["New York KOM"],
  })
  assert.strictEqual(profile.finish.matched, true)
  assert.ok(profile.finish.fromKm > 15)
  assert.strictEqual(profile.finish.climb, true)
  assert.ok(profile.climbs[0].fromKm > 7)
})

test("a KOM close-up is drawn only for a chosen climb or a custom span", () => {
  const profile = buildRaceProfile({
    distanceM: [0, 5000, 10000],
    altitudeM: [10, 40, 20],
    segments: [{ name: "Box Hill", type: "climb", fromKm: 2, toKm: 4, direction: "forward" }],
    raceKm: 10,
    finishText: "Banner on Box Hill",
    climbNames: [],
  })
  assert.deepStrictEqual(profile.climbs, [])
  const chosen = buildRaceProfile({
    distanceM: [0, 5000, 10000],
    altitudeM: [10, 40, 20],
    segments: [{ name: "Box Hill", type: "climb", fromKm: 2, toKm: 4, direction: "forward" }],
    raceKm: 10,
    climbNames: ["Box Hill"],
    customClimbs: [{ name: "Governor stretch", fromKm: 6.2, toKm: 8.4 }],
  })
  assert.strictEqual(chosen.climbs.length, 2)
  assert.strictEqual(chosen.climbs[0].matched, true)
  assert.strictEqual(chosen.climbs[1].title, "Governor stretch")
  assert.strictEqual(chosen.climbs[1].fromKm, 6.2)
  assert.strictEqual(chosen.climbs[1].toKm, 8.4)
  assert.strictEqual(chosen.climbs[1].climb, true)
  assert.strictEqual(chosen.lapGainM, 30)
})

test("the lead-in elevation is drawn once in front of the banner", () => {
  const profile = buildRaceProfile({
    distanceM: [0, 5000, 10000],
    altitudeM: [40, 80, 20],
    segments: [{ name: "Libby Hill", type: "climb", fromKm: 5, toKm: 8, direction: "forward" }],
    raceKm: 10,
    leadInKm: 2,
    leadDistanceM: [0, 1000, 2000],
    leadAltitudeM: [10, 30, 25],
  })
  assert.strictEqual(profile.distanceKm[0], 0)
  assert.ok(profile.distanceKm.some((km) => Math.abs(km - 2) < 0.01))
  assert.strictEqual(profile.altitudeM[profile.distanceKm.indexOf(2)], 40)
  assert.strictEqual(profile.altitudeM[0], 25)
  assert.ok(Math.abs(profile.segments[0].fromKm - 7) < 0.01)
  assert.strictEqual(profile.raceKm, 12)
})

test("kilometre marks start at the lead-in so a custom finish lands on the climb", () => {
  const profile = buildRaceProfile({
    distanceM: [0, 10251, 12859, 20149],
    altitudeM: [15, 30, 82, 12],
    segments: [{ name: "Titans Grove KOM", type: "climb", fromKm: 10.251, toKm: 12.859, direction: "forward" }],
    raceKm: 33.005,
    leadInKm: 2.28,
    customClimbs: [{ name: "Second Titans Grove", fromKm: 32.68, toKm: 35.285 }],
  })
  assert.strictEqual(profile.distanceKm[0], 2.28)
  assert.strictEqual(profile.raceKm, 35.285)
  assert.strictEqual(profile.distanceKm[profile.distanceKm.length - 1], 35.285)
  const second = profile.segments.filter((segment) => segment.name === "Titans Grove KOM")[1]
  assert.ok(Math.abs(second.toKm - 35.285) < 0.01)
  assert.strictEqual(profile.climbs[0].toKm, 35.285)
  assert.ok(profile.altitudeM[profile.altitudeM.length - 1] > 70)
})

test("a ZwiftPower title with the world in front still marks the segment", () => {
  assert.strictEqual(bonusNamesMatch("Fox Hill", "London Fox Hill"), true)
  assert.strictEqual(bonusNamesMatch("Box Hill", "London Box Hill"), true)
  assert.strictEqual(bonusNamesMatch("London Sprint", "London Sprint"), true)
  assert.strictEqual(bonusNamesMatch("London Sprint", "London Fox Hill"), false)
  assert.strictEqual(bonusNamesMatch("Fuego Flats", "Fuego Flats Long"), true)
})

test("the existing profile picture path stays the same", () => {
  assert.strictEqual(
    profileImageSrc("after-party", "Itza Climb Finish"),
    "/dzr-after-party/itza-climb-finish/Itza-Climb-Finish-profile.png"
  )
})
