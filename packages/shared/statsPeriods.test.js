const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const ts = require("typescript");

// Exercise the production TypeScript helpers with the existing Node test runner.
const outputDir = mkdtempSync(path.join(tmpdir(), "dzr-stats-tests-"));
test.after(() => rmSync(outputDir, { recursive: true, force: true }));
for (const name of ["statsPeriods", "statsSeries", "statsTimeline", "statsMemberHistory"]) {
  const source = readFileSync(path.join(__dirname, "../../app/lib", `${name}.ts`), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  writeFileSync(path.join(outputDir, `${name}.js`), outputText);
}

const { StatsPeriod, STATS_PERIODS, parseStatsPeriod, getPeriodWindow } = require(path.join(outputDir, "statsPeriods.js"));
const { buildSnapshotSeries, buildActivitySeries } = require(path.join(outputDir, "statsSeries.js"));

function activity(date, amount) {
  return {
    date,
    messages: amount,
    reactions: amount * 2,
    voice: amount * 3,
    interactions: amount * 4,
    total: amount * 10,
  };
}

test("period selections use semantic values and invalid or legacy day counts default to 30d", () => {
  assert.deepEqual(STATS_PERIODS, ["30d", "90d", "1y", "3y", "all"]);
  for (const period of STATS_PERIODS) assert.equal(parseStatsPeriod(period), period);
  for (const value of [null, "", "unknown", "30", "90", "365", "1095", "0", 365]) {
    assert.equal(parseStatsPeriod(value), StatsPeriod.Last30Days);
  }
});

for (const [period, count, start] of [
  [StatsPeriod.Last30Days, 30, "2024-02-01"],
  [StatsPeriod.Last90Days, 90, "2023-12-03"],
]) {
  test(`${period} includes exactly ${count} UTC dates through today, across leap day and year boundaries`, () => {
    const window = getPeriodWindow(period, new Date("2024-03-01T23:59:59Z"));
    assert.deepEqual(window, { selection: period, granularity: "day", start, end: "2024-03-01" });
    assert.equal((Date.parse(window.end) - Date.parse(window.start)) / 86400000 + 1, count);
    const rows = [
      activity("2023-12-02", 1),
      activity(start, 2),
      activity("2024-02-29", 3),
      activity("2024-03-01", 4),
      activity("2024-03-02", 5),
    ];
    assert.deepEqual(buildSnapshotSeries(rows, window), rows.slice(1, 4));
    assert.deepEqual(buildActivitySeries(rows, window), rows.slice(1, 4));
  });
}

for (const [period, weeks, start] of [
  [StatsPeriod.LastYear, 53, "2024-01-01"],
  [StatsPeriod.LastThreeYears, 157, "2022-01-03"],
]) {
  test(`${period} covers exactly ${weeks} complete Monday–Sunday weeks across leap and calendar years`, () => {
    const window = getPeriodWindow(period, new Date("2025-01-06T00:00:00Z"));
    assert.deepEqual(window, { selection: period, granularity: "week", start, end: "2025-01-05" });
    assert.equal((Date.parse(window.end) - Date.parse(window.start)) / 86400000 + 1, weeks * 7);
    const series = buildSnapshotSeries([{ date: "2020-01-01", count: 100 }], window);
    assert.equal(series.length, weeks);
    assert.equal(series[0].weekStart, start);
    assert.equal(series.at(-1).date, "2025-01-05");
    assert.ok(series.every(row => row.count === 100 && row.date === row.weekEnd));
  });
}

test("a week becomes eligible at Monday midnight UTC, including when now has another offset", () => {
  const sunday = getPeriodWindow(StatsPeriod.LastYear, new Date("2026-10-18T23:59:59.999Z"));
  const monday = getPeriodWindow(StatsPeriod.LastYear, new Date("2026-10-19T02:00:00+02:00"));
  assert.equal(sunday.start, "2025-10-06");
  assert.equal(sunday.end, "2026-10-11");
  assert.equal(monday.start, "2025-10-13");
  assert.equal(monday.end, "2026-10-18");
});

test("all has no lower bound and still excludes the current week", () => {
  assert.deepEqual(getPeriodWindow(StatsPeriod.All, new Date("2026-10-21T12:00:00Z")), {
    selection: StatsPeriod.All,
    granularity: "week",
    start: null,
    end: "2026-10-18",
  });
});

test("weekly snapshots carry the latest count across sparse data without summing or mutating history", () => {
  const rows = Object.freeze([
    Object.freeze({ date: "2026-10-19", count: 999, active: 99 }),
    Object.freeze({ date: "2026-10-09", count: 112, active: 12 }),
    Object.freeze({ date: "2026-09-23", count: 100, active: 10 }),
    Object.freeze({ date: "2026-10-18", count: 130, active: 13 }),
  ]);
  const original = JSON.stringify(rows);
  const window = getPeriodWindow(StatsPeriod.All, new Date("2026-10-21T12:00:00Z"));
  assert.deepEqual(buildSnapshotSeries(rows, window), [
    { date: "2026-09-27", count: 100, active: 10, weekStart: "2026-09-21", weekEnd: "2026-09-27" },
    { date: "2026-10-04", count: 100, active: 10, weekStart: "2026-09-28", weekEnd: "2026-10-04" },
    { date: "2026-10-11", count: 112, active: 12, weekStart: "2026-10-05", weekEnd: "2026-10-11" },
    { date: "2026-10-18", count: 130, active: 13, weekStart: "2026-10-12", weekEnd: "2026-10-18" },
  ]);
  assert.equal(JSON.stringify(rows), original);
});

test("weekly snapshots plot the finished week of the first count and skip the current week", () => {
  const window = getPeriodWindow(StatsPeriod.LastYear, new Date("2026-10-19T12:00:00Z"));
  const week = { date: "2026-10-18", count: 5, weekStart: "2026-10-12", weekEnd: "2026-10-18" };
  assert.deepEqual(buildSnapshotSeries([{ date: "2026-10-12", count: 5 }], window), [week]);
  assert.deepEqual(buildSnapshotSeries([{ date: "2026-10-14", count: 5 }], window), [week]);
  assert.deepEqual(buildSnapshotSeries([{ date: "2026-10-18", count: 5 }], window), [week]);
  assert.deepEqual(buildSnapshotSeries([{ date: "2026-10-19", count: 5 }], window), []);
});

test("daily snapshots preserve observed values and sort dates without modifying the input", () => {
  const rows = Object.freeze([
    Object.freeze({ date: "2026-10-19", count: 15 }),
    Object.freeze({ date: "2026-10-01", count: 10 }),
  ]);
  const window = getPeriodWindow(StatsPeriod.Last30Days, new Date("2026-10-19T12:00:00Z"));
  assert.deepEqual(buildSnapshotSeries(rows, window), [rows[1], rows[0]]);
  assert.equal(rows[0].date, "2026-10-19");
});

test("weekly activity omits a partial opening week while snapshots keep that finished Sunday", () => {
  const rows = Object.freeze([
    activity("2026-10-19", 100),
    activity("2026-10-11", 4),
    activity("2026-09-23", 100),
    activity("2026-09-28", 1),
    activity("2026-10-04", 2),
    activity("2026-10-05", 3),
    activity("2026-10-18", 5),
  ].map(Object.freeze));
  const window = getPeriodWindow(StatsPeriod.All, new Date("2026-10-21T12:00:00Z"));
  const original = JSON.stringify(rows);
  const series = buildActivitySeries(rows, window);
  assert.deepEqual(series, [
    { ...activity("2026-10-04", 3), weekStart: "2026-09-28", weekEnd: "2026-10-04" },
    { ...activity("2026-10-11", 7), weekStart: "2026-10-05", weekEnd: "2026-10-11" },
    { ...activity("2026-10-18", 5), weekStart: "2026-10-12", weekEnd: "2026-10-18" },
  ]);
  const snapshotDates = buildSnapshotSeries(rows.map(row => ({ date: row.date, count: 5 })), window).map(row => row.date);
  assert.deepEqual(snapshotDates, ["2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18"]);
  assert.deepEqual(series.map(row => row.date), snapshotDates.slice(1));
  assert.equal(JSON.stringify(rows), original);
});

test("weekly activity respects both selected boundaries and retains observed zero-activity weeks", () => {
  const window = getPeriodWindow(StatsPeriod.LastYear, new Date("2026-10-19T12:00:00Z"));
  const rows = [
    activity("2025-10-12", 100),
    activity("2025-10-13", 0),
    activity("2026-10-18", 2),
    activity("2026-10-19", 100),
  ];
  assert.deepEqual(buildActivitySeries(rows, window), [
    { ...activity("2025-10-19", 0), weekStart: "2025-10-13", weekEnd: "2025-10-19" },
    { ...activity("2026-10-18", 2), weekStart: "2026-10-12", weekEnd: "2026-10-18" },
  ]);
});

test("daily activity passes through values and order without weekly aggregation or mutation", () => {
  const rows = Object.freeze([
    Object.freeze(activity("2026-10-19", 2)),
    Object.freeze(activity("2026-10-18", 3)),
  ]);
  const window = getPeriodWindow(StatsPeriod.Last30Days, new Date("2026-10-19T12:00:00Z"));
  assert.deepEqual(buildActivitySeries(rows, window), rows);
});

test("empty histories produce no chart points for any selection", () => {
  for (const period of STATS_PERIODS) {
    const window = getPeriodWindow(period, new Date("2026-10-19T12:00:00Z"));
    assert.deepEqual(buildSnapshotSeries([], window), []);
    assert.deepEqual(buildActivitySeries([], window), []);
  }
});

const { buildChartTimeline, buildSnapshotTimeline, dateTimestamp, isDateKey } = require(path.join(outputDir, "statsTimeline.js"));
const { normalizeMemberHistory, buildMemberTimeline, findMissingMemberObservations } = require(path.join(outputDir, "statsMemberHistory.js"));
const now = new Date("2026-10-20T12:00:00Z");
const member = (date, members = 700, clubMembers = 100) => ({ date, members, clubMembers, presence: null, estimated: false });
const dailyWindow = (start, end) => ({ selection: StatsPeriod.Last30Days, granularity: "day", start, end });

test("screenshot dates are sorted without losing observations and spaced in a 3:30:1 ratio", () => {
  const rows = Object.freeze([member("2026-10-20"), member("2026-09-16"), member("2026-10-19"), member("2026-09-19")]);
  const timeline = buildSnapshotTimeline(rows, getPeriodWindow(StatsPeriod.Last90Days, now), now);
  assert.deepEqual(timeline.points.map(p => p.date), ["2026-09-16", "2026-09-19", "2026-10-19", "2026-10-20"]);
  assert.deepEqual(timeline.points.slice(1).map((p, i) => (p.timestamp - timeline.points[i].timestamp) / 86400000), [3, 30, 1]);
  assert.equal(timeline.start, "2026-07-23");
  assert.equal(rows[0].date, "2026-10-20");
});

test("missing daily observations occupy time without inventing counts", () => {
  const timeline = buildSnapshotTimeline([member("2026-10-10"), member("2026-10-16")], dailyWindow("2026-10-10", "2026-10-16"), now);
  assert.equal(timeline.points.length, 2);
  assert.equal(timeline.domain[1] - timeline.domain[0], 6 * 86400000);
  assert.equal(timeline.extended, false);
});

test("daily edges hold the nearest count inside the selected window", () => {
  const rows = ["2026-10-01", "2026-10-05", "2026-10-10", "2026-10-15", "2026-10-19"].map(date => member(date, 700));
  const timeline = buildSnapshotTimeline(rows, dailyWindow("2026-10-07", "2026-10-13"), now);
  assert.deepEqual(timeline.points.map(p => [p.date, p.sourceDate, p.boundary, p.members]), [
    ["2026-10-07", "2026-10-05", "before", 700],
    ["2026-10-10", "2026-10-10", undefined, 700],
    ["2026-10-13", "2026-10-10", "after", 700],
  ]);
  assert.deepEqual(timeline.domain, [dateTimestamp("2026-10-07"), dateTimestamp("2026-10-13")]);
  assert.equal(timeline.extended, false);
  const exact = buildSnapshotTimeline(rows, dailyWindow("2026-10-05", "2026-10-15"), now);
  assert.deepEqual(exact.points.map(p => p.date), ["2026-10-05", "2026-10-10", "2026-10-15"]);
  assert.equal(exact.extended, false);
});

test("empty and singleton timelines have finite, nonzero domains; invalid and future dates are excluded", () => {
  const window = dailyWindow(null, "2026-10-20");
  for (const rows of [[], [member("2026-10-20")]]) {
    const timeline = buildSnapshotTimeline(rows, window, now);
    assert.ok(timeline.domain.every(Number.isFinite));
    assert.ok(timeline.domain[1] > timeline.domain[0]);
    assert.equal(timeline.points.length, rows.length);
  }
  assert.equal(buildSnapshotTimeline([member("2026-10-21"), member("2026-02-30")], window, now).points.length, 0);
  assert.equal(isDateKey("2024-02-29"), true);
  assert.equal(isDateKey("2025-02-29"), false);
});

test("weekly points preserve source dates and exclude the unfinished week", () => {
  const window = getPeriodWindow(StatsPeriod.All, now);
  const rows = [member("2026-09-23", 100), member("2026-10-09", 120), member("2026-10-19", 999)];
  const timeline = buildSnapshotTimeline(rows, window, now);
  assert.deepEqual(timeline.points.map(p => [p.date, p.sourceDate, p.members]), [
    ["2026-09-27", "2026-09-23", 100], ["2026-10-04", "2026-09-23", 100],
    ["2026-10-11", "2026-10-09", 120], ["2026-10-18", "2026-10-09", 120],
  ]);
  assert.equal(timeline.points[0].weekStart, "2026-09-21");
  const gaps = findMissingMemberObservations(rows, timeline, now);
  assert.ok(gaps.some(gap => gap.start === "2026-09-24" && gap.end === "2026-10-08"));
});

test("activity timestamps retain daily zero values and full selected domain", () => {
  const timeline = buildChartTimeline([activity("2026-10-19", 0), activity("2026-10-15", 2)], dailyWindow("2026-10-01", "2026-10-20"));
  assert.deepEqual(timeline.domain, [dateTimestamp("2026-10-01"), dateTimestamp("2026-10-20")]);
  assert.deepEqual(timeline.points.map(p => p.messages), [2, 0]);
});

test("raw missing ranges distinguish each series, accept zero, and exclude dates before collection and today", () => {
  const rows = [member("2026-10-17", 0, 0), member("2026-10-15", 600, null), member("2026-10-19", 700, null)];
  assert.deepEqual(findMissingMemberObservations(rows, { start: "2026-10-01", end: "2026-10-20" }, now), [
    { series: "members", start: "2026-10-16", end: "2026-10-16", days: 1 },
    { series: "members", start: "2026-10-18", end: "2026-10-18", days: 1 },
    { series: "clubMembers", start: "2026-10-18", end: "2026-10-19", days: 2 },
  ]);
});

test("missing days stay inside the selected window and run through yesterday", () => {
  const rows = [member("2026-10-10", 650), member("2026-10-16", 700)];
  const timeline = buildSnapshotTimeline(rows, dailyWindow("2026-10-12", "2026-10-20"), now);
  assert.deepEqual(timeline.points.map(p => [p.date, p.sourceDate, p.members]), [
    ["2026-10-12", "2026-10-10", 650],
    ["2026-10-16", "2026-10-16", 700],
    ["2026-10-20", "2026-10-16", 700],
  ]);
  assert.equal(timeline.start, "2026-10-12");
  assert.equal(timeline.end, "2026-10-20");
  const gaps = findMissingMemberObservations(rows, timeline, now).filter(gap => gap.series === "members");
  assert.deepEqual(gaps, [
    { series: "members", start: "2026-10-12", end: "2026-10-15", days: 4 },
    { series: "members", start: "2026-10-17", end: "2026-10-19", days: 3 },
  ]);
  assert.deepEqual(findMissingMemberObservations([], timeline, now), []);
  assert.deepEqual(findMissingMemberObservations([member("2026-10-20")], timeline, now), []);
});

test("legacy date IDs and role count maps are normalized without losing zero counts", () => {
  const snapshots = [
    { id: "2026-10-19", data: { memberCount: 0, roleCounts: { club: 0 } } },
    { id: "2026-10-18", data: { dateKey: "invalid", memberCount: 5 } },
    { id: "legacy", data: { dateKey: "2026-10-17", memberCount: 5 } },
    { id: "2026-10-16", data: { memberCount: 5, clubMemberCount: NaN, roleCounts: { club: 4 } } },
  ];
  assert.deepEqual(normalizeMemberHistory(snapshots, "club"), [
    member("2026-10-16", 5, 4),
    member("2026-10-17", 5, null),
    member("2026-10-18", 5, null),
    member("2026-10-19", 0, 0),
  ]);
  for (const memberCount of [undefined, -1, NaN, Infinity, "1"]) {
    assert.deepEqual(normalizeMemberHistory([{ id: "2026-10-19", data: { memberCount } }]), []);
  }
  assert.deepEqual(normalizeMemberHistory([{ id: "2026-02-30", data: { memberCount: 5 } }]), []);
});

test("all retains legacy Club Member observations when the configured role is missing", () => {
  const snapshots = [
    { id: "2026-09-16", data: { memberCount: 675, clubMemberCount: 138, clubMemberRoleId: "club" } },
    { id: "2025-10-20", data: { memberCount: 400, roleCounts: { club: 70, verified: 200 } } },
    { id: "2026-10-19", data: { memberCount: 716 } },
    { id: "2025-10-19", data: { memberCount: 399, estimated: true } },
    { id: "2026-01-05", data: { roleCounts: { club: 0 } } },
  ];
  const original = JSON.stringify(snapshots);
  const rows = normalizeMemberHistory(snapshots);
  assert.deepEqual(rows, [
    { ...member("2025-10-19", 399, null), estimated: true },
    member("2025-10-20", 400, 70),
    member("2026-01-05", null, 0),
    member("2026-09-16", 675, 138),
    member("2026-10-19", 716, null),
  ]);

  const timeline = buildMemberTimeline(rows, getPeriodWindow(StatsPeriod.All, now), now);
  const firstClub = timeline.points.find(point => point.clubMembers !== null);
  assert.equal(firstClub.clubMembers, 70);
  assert.equal(firstClub.sourceDates.clubMembers, "2025-10-20");
  assert.equal(timeline.points.find(point => point.date === "2026-01-11").clubMembers, 0);
  assert.equal(timeline.points.at(-1).clubMembers, 138);
  assert.equal(timeline.points.at(-1).sourceDates.clubMembers, "2026-09-16");
  assert.equal(JSON.stringify(snapshots), original);
});

test("history role lookup prefers settings, then the latest valid dated role metadata", () => {
  const legacy = { id: "2025-10-20", data: { memberCount: 400, roleCounts: { configured: 70, latest: 60, older: 50 } } };
  const snapshots = [
    { id: "legacy-id", data: { dateKey: "2026-10-18", clubMemberRoleId: " latest " } },
    { id: "2026-10-20", data: { clubMemberRoleId: " " } },
    { id: "2026-10-19", data: { clubMemberRoleId: 123 } },
    { id: "2026-02-30", data: { clubMemberRoleId: "invalid-date" } },
    { id: "2026-09-16", data: { dateKey: "invalid", clubMemberRoleId: "older" } },
    legacy,
  ];
  assert.deepEqual(normalizeMemberHistory(snapshots, " configured "), [member("2025-10-20", 400, 70)]);
  assert.deepEqual(normalizeMemberHistory(snapshots), [member("2025-10-20", 400, 60)]);
  assert.deepEqual(normalizeMemberHistory([...snapshots].reverse(), " "), [member("2025-10-20", 400, 60)]);
  assert.deepEqual(normalizeMemberHistory([legacy, snapshots[4]]), [member("2025-10-20", 400, 50)]);
});

test("history without explicit Club Member role metadata stays unknown", () => {
  const snapshots = [{ id: "2025-10-20", data: { memberCount: 400, roleCounts: { verified: 200 } } }];
  assert.deepEqual(normalizeMemberHistory(snapshots), [member("2025-10-20", 400, null)]);
  assert.deepEqual(normalizeMemberHistory([]), []);
});

for (const [period, weeks] of [[StatsPeriod.LastYear, 53], [StatsPeriod.LastThreeYears, 157]]) {
  test(`${period} timeline keeps exactly ${weeks} completed weeks even with older observations`, () => {
    const window = getPeriodWindow(period, now);
    const timeline = buildSnapshotTimeline([member("2020-01-01", 10)], window, now);
    assert.equal(timeline.points.length, weeks);
    assert.equal(timeline.points[0].weekStart, window.start);
    assert.equal(timeline.points.at(-1).weekEnd, window.end);
    assert.equal(timeline.points[0].sourceDate, "2020-01-01");
    assert.equal(timeline.extended, false);
    assert.ok(timeline.points.every(p => p.boundary === undefined));
  });
}

test("all shows the full first completed week and reports gaps before its Sunday", () => {
  const rows = [member("2026-10-12"), member("2026-10-16")];
  const timeline = buildMemberTimeline(rows, getPeriodWindow(StatsPeriod.All, now), now);
  assert.equal(timeline.start, "2026-10-12");
  assert.equal(timeline.end, "2026-10-18");
  assert.equal(timeline.points.length, 1);
  assert.deepEqual(findMissingMemberObservations(rows, timeline, now).filter(gap => gap.series === "members"), [
    { series: "members", start: "2026-10-13", end: "2026-10-15", days: 3 },
    { series: "members", start: "2026-10-17", end: "2026-10-18", days: 2 },
  ]);
});

test("role-only snapshots survive normalization, and missing totals stay unknown rather than zero", () => {
  for (const data of [{ clubMemberCount: 0 }, { memberCount: NaN, roleCounts: { club: 0 } }]) {
    assert.deepEqual(normalizeMemberHistory([{ id: "2026-10-16", data }], "club"), [member("2026-10-16", null, 0)]);
  }
  const rows = [member("2026-10-15", 700, 10), member("2026-10-16", null, 0)];
  const timeline = buildMemberTimeline(rows, dailyWindow("2026-10-15", "2026-10-16"), now);
  assert.deepEqual(timeline.points.map(p => [p.members, p.clubMembers]), [[700, 10], [null, 0]]);
  assert.deepEqual(findMissingMemberObservations(rows, timeline, now), [
    { series: "members", start: "2026-10-16", end: "2026-10-16", days: 1 },
  ]);
});

test("weekly member totals and roles retain independent values and source dates without altering raw observations", () => {
  const rows = Object.freeze([
    Object.freeze(member("2026-10-16", null, 0)),
    Object.freeze({ ...member("2026-10-12", 700, 10), estimated: true }),
    Object.freeze(member("2026-10-19", 999, 999)),
  ]);
  const timeline = buildMemberTimeline(rows, getPeriodWindow(StatsPeriod.All, now), now);
  assert.equal(timeline.points.length, 2);
  assert.equal(timeline.points[0].date, "2026-10-18");
  assert.equal(timeline.points[0].members, 700);
  assert.equal(timeline.points[0].clubMembers, 10);
  assert.equal(timeline.points[0].estimated, true);
  assert.deepEqual(timeline.points[0].sourceDates, { members: "2026-10-12", clubMembers: "2026-10-12" });
  assert.equal(timeline.points[1].date, "2026-10-19");
  assert.equal(timeline.points[1].openWeek, true);
  assert.equal(timeline.points[1].members, 999);
  assert.equal(timeline.points[1].clubMembers, 999);
  assert.equal(timeline.end, "2026-10-19");
  assert.ok(findMissingMemberObservations(rows, timeline, now).some(gap => gap.series === "members" && gap.start === "2026-10-13" && gap.end === "2026-10-18"));
  assert.equal(rows[0].members, null);
  assert.equal(rows[0].date, "2026-10-16");
});

test("the current week shows the latest member and role counts past the last Sunday", () => {
  const rows = [member("2026-09-19", 686, 151), member("2026-10-20", 721, 184)];
  const timeline = buildMemberTimeline(rows, getPeriodWindow(StatsPeriod.All, now), now);
  const closed = timeline.points.find(point => point.date === "2026-10-18");
  const open = timeline.points.at(-1);
  assert.equal(closed.members, 686);
  assert.equal(closed.clubMembers, 151);
  assert.deepEqual(closed.sourceDates, { members: "2026-09-19", clubMembers: "2026-09-19" });
  assert.equal(open.date, "2026-10-20");
  assert.equal(open.openWeek, true);
  assert.equal(open.members, 721);
  assert.equal(open.clubMembers, 184);
  assert.deepEqual(open.sourceDates, { members: "2026-10-20", clubMembers: "2026-10-20" });
  assert.equal(timeline.end, "2026-10-20");
  assert.equal(timeline.domain[1], dateTimestamp("2026-10-20"));
});

test("a newer total does not erase an earlier role value or change its source date", () => {
  const rows = [member("2026-10-12", 700, 10), member("2026-10-16", 710, null)];
  const timeline = buildMemberTimeline(rows, getPeriodWindow(StatsPeriod.All, now), now);
  assert.equal(timeline.points[0].clubMembers, 10);
  assert.deepEqual(timeline.points[0].sourceDates, { members: "2026-10-16", clubMembers: "2026-10-12" });
  const roleOnly = buildMemberTimeline([member("2026-10-16", null, 0)], getPeriodWindow(StatsPeriod.All, now), now);
  assert.equal(roleOnly.points[0].members, null);
  assert.equal(roleOnly.points[0].clubMembers, 0);
  assert.deepEqual(roleOnly.points[0].sourceDates, { clubMembers: "2026-10-16" });
});



for (const period of [StatsPeriod.Last30Days, StatsPeriod.Last90Days]) {
  test(`${period} retains October 22 role observations after switching from weekly views`, () => {
    const clock = new Date("2026-10-24T18:00:00Z");
    const rows = Object.freeze([
      Object.freeze(member("2026-10-21", 724, 188)),
      Object.freeze(member("2026-10-22", 725, 189)),
      Object.freeze(member("2026-10-23", 728, null)),
    ]);
    buildMemberTimeline(rows, getPeriodWindow(StatsPeriod.All, clock), clock);
    const points = buildMemberTimeline(rows, getPeriodWindow(period, clock), clock).points;
    assert.equal(points.find(p => p.date === "2026-10-22").clubMembers, 189);
    assert.equal(points.find(p => p.date === "2026-10-23").clubMembers, null);
    assert.equal(points.find(p => p.date === "2026-10-21").clubMembers, 188);
  });
}

for (const period of [StatsPeriod.LastYear, StatsPeriod.LastThreeYears, StatsPeriod.All]) {
  test(`${period} selects independent weekly maxima, resets each week, and carries actual counts through gaps`, () => {
    const clock = new Date("2026-10-24T18:00:00Z");
    const rows = Object.freeze([
      Object.freeze(member("2026-10-05", 700, 100)),
      Object.freeze(member("2026-10-07", 705, 105)),
      Object.freeze(member("2026-10-09", 710, 104)),
      Object.freeze(member("2026-10-19", 690, 90)),
      Object.freeze(member("2026-10-21", 695, 95)),
      Object.freeze(member("2026-10-23", 692, 94)),
      Object.freeze(member("2026-10-25", 999, 999)),
    ]);
    const points = buildMemberTimeline(rows, getPeriodWindow(period, clock), clock).points;
    const peak = points.find(p => p.date === "2026-10-11");
    assert.equal(peak.members, 710);
    assert.equal(peak.clubMembers, 105);
    assert.deepEqual(peak.sourceDates, { members: "2026-10-09", clubMembers: "2026-10-07" });
    const gap = points.find(p => p.date === "2026-10-18");
    assert.equal(gap.clubMembers, 104);
    assert.equal(gap.sourceDates.clubMembers, "2026-10-09");
    const current = points.at(-1);
    assert.equal(current.date, "2026-10-23");
    assert.equal(current.openWeek, true);
    assert.equal(current.members, 695);
    assert.equal(current.clubMembers, 95);
    assert.deepEqual(current.sourceDates, { members: "2026-10-21", clubMembers: "2026-10-21" });
  });
}

test("weekly maxima preserve zero, use the latest tied peak, and exclude earlier weeks' higher values", () => {
  const clock = new Date("2026-10-24T18:00:00Z");
  const rows = [member("2026-10-09", 999, 999), member("2026-10-12", 700, 0), member("2026-10-14", 700, null)];
  const timeline = buildMemberTimeline(rows, getPeriodWindow(StatsPeriod.All, clock), clock);
  const point = timeline.points.at(-1);
  assert.equal(point.members, 700);
  assert.equal(point.clubMembers, 0);
  assert.deepEqual(point.sourceDates, { members: "2026-10-14", clubMembers: "2026-10-12" });
});
