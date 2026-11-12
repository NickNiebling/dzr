const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resampleTo1Hz,
  meanMaxPower,
  normalizedPower,
  intensityFactor,
  trainingStressScore,
  wPrimeBalance,
  aerobicDecoupling,
  timeInZones,
  detectIntervals,
  positiveStats,
  temperatureStats,
  seriesStats,
  enrichIntervals,
  segmentSummary,
  activityTimeline,
  heatAnalysis,
} = require("./streamMetrics");

test("irregular sampling is placed on a real time grid, not by array index", () => {
  // Smart recording: samples at 0s, 10s, 20s, 30s. Treating the array as 1 Hz would compress a
  // 30-second effort into 4 seconds and inflate every rolling metric.
  const time = [0, 10, 20, 30];
  const watts = [100, 200, 300, 400];
  const out = resampleTo1Hz(time, watts);
  assert.equal(out.length, 31, "one sample per second across the real duration");
  assert.equal(out[0], 100);
  assert.equal(out[10], 200);
  assert.equal(out[30], 400);
});

test("power gaps fill with zero, heart-rate gaps hold the last value", () => {
  const time = [0, 5];
  assert.equal(resampleTo1Hz(time, [200, 200], "zero")[3], 0, "coasting is zero watts");
  assert.equal(resampleTo1Hz(time, [150, 150], "hold")[3], 150, "a gap in HR is missing data, not a stopped heart");
});

test("mean-max power finds the best window, not the last one", () => {
  // 60s at 100W, then 60s at 300W, then 60s at 100W.
  const watts = [...Array(60).fill(100), ...Array(60).fill(300), ...Array(60).fill(100)];
  const mmp = meanMaxPower(watts, [60]);
  assert.equal(mmp[60], 300);
});

test("mean-max returns null for durations longer than the ride", () => {
  assert.equal(meanMaxPower(Array(60).fill(200), [3600])[3600], null);
});

test("normalized power exceeds average power on a variable ride", () => {
  const steady = Array(600).fill(200);
  const variable = [];
  for (let i = 0; i < 600; i++) variable.push(i % 120 < 60 ? 100 : 300);
  const avg = 200;
  assert.equal(normalizedPower(steady), avg, "steady riding: NP equals average");
  assert.ok(normalizedPower(variable) > avg, "surges cost more than their average suggests");
});

test("intensity and stress scale as expected against threshold", () => {
  assert.equal(intensityFactor(250, 250), 1);
  assert.equal(intensityFactor(200, 250), 0.8);
  assert.equal(intensityFactor(200, 0), null, "no FTP, no claim");
  // An hour exactly at threshold is 100 by definition.
  assert.equal(trainingStressScore(250, 250, 3600), 100);
  assert.equal(trainingStressScore(250, 250, 1800), 50);
});

test("W-prime balance spends above FTP and recharges below it", () => {
  const balance = wPrimeBalance(
    [...Array(10).fill(300), ...Array(30).fill(100)],
    250,
    20000
  );
  assert.equal(balance[9], 19500, "ten seconds at 50 W above FTP spends 500 J");
  assert.ok(balance.at(-1) > balance[9], "easy riding restores some W-prime");
  assert.ok(balance.at(-1) < 20000, "recovery is progressive, not instantaneous");
  assert.deepEqual(wPrimeBalance([300], null, 20000), []);
});

test("decoupling is near zero for a steady ride and positive when HR drifts up", () => {
  const steady = Array(1200).fill(200);
  const flatHr = Array(1200).fill(140);
  assert.equal(aerobicDecoupling(steady, flatHr), 0);

  // Same power, higher heart rate in the second half: cardiac cost rising.
  const driftHr = [...Array(600).fill(140), ...Array(600).fill(154)];
  const drift = aerobicDecoupling(steady, driftHr);
  assert.ok(drift > 5, `expected meaningful drift, got ${drift}`);
});

test("decoupling refuses to answer on too little data", () => {
  assert.equal(aerobicDecoupling(Array(120).fill(200), Array(120).fill(140)), null);
  assert.equal(aerobicDecoupling(Array(1200).fill(200), Array(1200).fill(0)), null, "no usable HR");
});

test("time in zones buckets every second, including above the top boundary", () => {
  const watts = [...Array(10).fill(50), ...Array(20).fill(150), ...Array(30).fill(400)];
  const zones = timeInZones(watts, [100, 200]);
  assert.deepEqual(zones, [10, 20, 30]);
  assert.equal(zones.reduce((a, b) => a + b, 0), watts.length);
});

test("intervals are detected, and a brief dip does not split one in two", () => {
  const watts = [
    ...Array(60).fill(100),
    ...Array(120).fill(300),
    ...Array(5).fill(80), // momentary freewheel mid-effort
    ...Array(120).fill(300),
    ...Array(60).fill(100),
  ];
  const found = detectIntervals(watts, { thresholdWatts: 250, minSeconds: 30, bridgeSeconds: 10 });
  assert.equal(found.length, 1, "the dip is bridged rather than reported as two efforts");
  assert.ok(found[0].durationSeconds >= 240);
  assert.equal(found[0].peakWatts, 300);
});

test("short surges are not reported as intervals", () => {
  const watts = [...Array(60).fill(100), ...Array(10).fill(400), ...Array(60).fill(100)];
  assert.equal(detectIntervals(watts, { thresholdWatts: 250, minSeconds: 30 }).length, 0);
});

test("heart-rate and cadence stats ignore dropouts and coasting", () => {
  assert.deepEqual(positiveStats([0, 140, 150, null, 160, 0]), { average: 150, max: 160 });
  assert.equal(positiveStats([0, 0]), null);
  assert.equal(positiveStats(null), null);
});

test("core-temperature stats preserve sensor precision and ignore missing samples", () => {
  assert.deepEqual(temperatureStats([null, 0, 37.12, 37.46, 37.8]), {
    average: 37.46,
    min: 37.12,
    max: 37.8,
  });
  assert.equal(temperatureStats([null, 0]), null);
});

test("generic sensor stats retain negative terrain values when requested", () => {
  assert.deepEqual(seriesStats([-4.24, 0, 7.86], { digits: 1 }), {
    average: 1.2,
    min: -4.2,
    max: 7.9,
  });
  assert.deepEqual(seriesStats([0, 0.5, 1], { digits: 2, positiveOnly: true }), {
    average: 0.75,
    min: 0.5,
    max: 1,
  });
});

test("each interval gets its own heart rate, cadence and core temperature", () => {
  const heartrate = [...Array(60).fill(120), ...Array(60).fill(170), ...Array(60).fill(130)];
  const cadence = [...Array(60).fill(80), ...Array(60).fill(95), ...Array(60).fill(0)];
  const coreTemperature = [...Array(60).fill(37.2), ...Array(60).fill(38.45), ...Array(60).fill(37.8)];
  const [interval] = enrichIntervals(
    [{ startSeconds: 60, durationSeconds: 60, averageWatts: 300, peakWatts: 320 }],
    { heartrate, cadence, coreTemperature }
  );
  assert.equal(interval.averageHeartRate, 170);
  assert.equal(interval.maxHeartRate, 170);
  assert.equal(interval.averageCadence, 95);
  assert.equal(interval.averageCoreTemperatureC, 38.45);
  assert.equal(interval.maxCoreTemperatureC, 38.45);
  assert.equal(interval.averageWatts, 300, "power fields are kept");
});

test("a segment summarises only its window and reports intervals in ride time", () => {
  // 10 min easy, 5 min hard, 10 min easy.
  const watts = [...Array(600).fill(150), ...Array(300).fill(300), ...Array(600).fill(150)];
  const heartrate = [...Array(600).fill(130), ...Array(300).fill(170), ...Array(600).fill(135)];
  const cadence = Array(1500).fill(90);
  const coreTemperature = [
    ...Array(600).fill(37.4),
    ...Array(150).fill(38.1),
    ...Array(150).fill(38.7),
    ...Array(600).fill(37.8),
  ];
  const seg = segmentSummary({ watts, heartrate, cadence, coreTemperature }, 600, 900, { ftp: 280 });
  assert.equal(seg.durationSeconds, 300);
  assert.equal(seg.averageWatts, 300);
  assert.equal(seg.averageHeartRate, 170);
  assert.equal(seg.averageCadence, 90);
  assert.equal(seg.averageCoreTemperatureC, 38.4);
  assert.equal(seg.minCoreTemperatureC, 38.1);
  assert.equal(seg.maxCoreTemperatureC, 38.7);
  assert.equal(seg.meanMaxPower[3600], undefined, "durations longer than the window are left out");
  assert.equal(seg.intervals.length, 1);
  assert.equal(seg.intervals[0].startSeconds, 600, "start is from the ride start, not the window");
});

test("a segment outside the ride or too short is null", () => {
  const watts = Array(600).fill(200);
  assert.equal(segmentSummary({ watts }, 700, 900), null);
  assert.equal(segmentSummary({ watts }, 100, 110), null);
  assert.equal(segmentSummary({ watts }, 300, Infinity).durationSeconds, 300, "open end runs to the ride end");
});

test("a heart-rate-only segment still reports heart rate", () => {
  const seg = segmentSummary({ heartrate: Array(600).fill(140) }, 0, 300);
  assert.equal(seg.averageWatts, null);
  assert.equal(seg.averageHeartRate, 140);
});

test("empty and malformed input never throws", () => {
  assert.deepEqual(resampleTo1Hz([], []), []);
  assert.deepEqual(resampleTo1Hz(null, null), []);
  assert.equal(normalizedPower([]), null);
  assert.deepEqual(detectIntervals([], { thresholdWatts: 250 }), []);
  assert.equal(timeInZones([], []), null);
});

test("intervals and segments without a core sensor carry no core-temperature fields", () => {
  const watts = Array(600).fill(300);
  const heartrate = Array(600).fill(160);
  const [interval] = enrichIntervals(
    [{ startSeconds: 0, durationSeconds: 300, averageWatts: 300, peakWatts: 300 }],
    { heartrate }
  );
  assert.equal("averageCoreTemperatureC" in interval, false);
  assert.equal("maxCoreTemperatureC" in interval, false);
  const seg = segmentSummary({ watts, heartrate }, 0, 600, { ftp: 280 });
  assert.equal("averageCoreTemperatureC" in seg, false);
  assert.equal("minCoreTemperatureC" in seg, false);
});

test("a timeline without a core sensor has only the streams that were recorded", () => {
  const watts = [...Array(1800).fill(200), ...Array(1800).fill(250)];
  const heartrate = [...Array(1800).fill(140), ...Array(1800).fill(155)];
  const timeline = activityTimeline({ watts, heartrate, coreTemperature: [], cadence: Array(3600).fill(0) });
  assert.deepEqual(timeline.columns, ["minute", "watts", "heartRate"]);
  assert.equal(timeline.bucketSeconds, 60);
  assert.equal(timeline.rows.length, 60);
  assert.equal(timeline.rows[0], "0, 200, 140");
  assert.equal(timeline.rows[59], "59, 250, 155");
});

test("a timeline adds a core-temperature column when the ride recorded it", () => {
  const watts = Array(600).fill(250);
  const heartrate = Array(600).fill(150);
  // Sensor reads 0 while it pairs, then real values.
  const coreTemperature = [...Array(60).fill(0), ...Array(540).fill(37.81)];
  const timeline = activityTimeline({ watts, heartrate, coreTemperature });
  assert.deepEqual(timeline.columns, ["minute", "watts", "heartRate", "coreTemperatureC"]);
  assert.equal(timeline.rows[0], "0, 250, 150, -", "the pairing minute has no reading");
  assert.equal(timeline.rows[1], "1, 250, 150, 37.81");
});

test("a long ride gets coarser timeline buckets and a short segment finer ones", () => {
  const watts = Array(4 * 3600).fill(200);
  const long = activityTimeline({ watts });
  assert.equal(long.bucketSeconds, 180, "four hours fits in 90 rows at three minutes");
  assert.ok(long.rows.length <= 90);
  const segment = activityTimeline({ watts }, { fromSeconds: 600, toSeconds: 900, minBucketSeconds: 30, maxRows: 60 });
  assert.equal(segment.bucketSeconds, 30);
  assert.equal(segment.rows[0], "10, 200");
  assert.equal(segment.rows.length, 10);
});

test("a timeline is null when nothing was recorded", () => {
  assert.equal(activityTimeline({ watts: Array(600).fill(0) }), null);
  assert.equal(activityTimeline({}), null);
});

test("heat analysis is null without a core sensor or with only glitches", () => {
  assert.equal(heatAnalysis({ watts: Array(3600).fill(250), heartrate: Array(3600).fill(150) }), null);
  assert.equal(heatAnalysis({ coreTemperature: Array(3600).fill(0) }), null);
  assert.equal(heatAnalysis({ coreTemperature: Array(3600).fill(99) }), null, "out-of-range readings are ignored");
});

test("heat analysis describes how core temperature developed against power and heart rate", () => {
  // 45 min: core climbs steadily from 37.3 to 38.5 over the first 30 min, then holds.
  // Power holds at 250 W while heart rate drifts up, so the heart pays more per watt late on.
  const seconds = 45 * 60;
  const coreTemperature = Array.from({ length: seconds }, (_, t) =>
    t < 1800 ? 37.3 + (1.2 * t) / 1800 : 38.5
  );
  const watts = Array(seconds).fill(250);
  const heartrate = Array.from({ length: seconds }, (_, t) => (t < 900 ? 140 : t < 1800 ? 150 : 160));
  const heat = heatAnalysis({ watts, heartrate, coreTemperature });

  assert.ok(Math.abs(heat.startC - 37.32) < 0.02);
  assert.equal(heat.peakC, 38.5);
  assert.ok(heat.peakMinute >= 29.9 && heat.peakMinute <= 30, `peak at ${heat.peakMinute}`);
  assert.equal(heat.endC, 38.5);
  assert.ok(Math.abs(heat.riseCPer10MinToPeak - 0.4) < 0.02, `rise ${heat.riseCPer10MinToPeak}`);
  assert.ok(Math.abs(heat.largestRiseIn10MinC - 0.4) < 0.01);
  assert.equal(heat.minutesAboveC["38.5"], 15);
  assert.ok(heat.minutesAboveC["38.0"] > heat.minutesAboveC["38.5"]);
  assert.equal(heat.minutesAboveC["39.0"], 0);

  assert.equal(heat.byThird.length, 3);
  assert.deepEqual(heat.byThird.map((part) => part.averageHeartRate), [140, 150, 160]);
  assert.deepEqual(heat.byThird.map((part) => part.heartRatePer100W), [56, 60, 64]);
  assert.ok(heat.byThird[0].averageCoreTemperatureC < heat.byThird[2].averageCoreTemperatureC);
});

test("heat analysis without power keeps heart rate and temperature by third", () => {
  const coreTemperature = Array(1800).fill(38);
  const heartrate = Array(1800).fill(150);
  const heat = heatAnalysis({ heartrate, coreTemperature });
  assert.equal(heat.byThird[0].averageHeartRate, 150);
  assert.equal("averageWatts" in heat.byThird[0], false);
  assert.equal("heartRatePer100W" in heat.byThird[0], false);
});

test("heat analysis of a segment reports minutes from the ride start", () => {
  const coreTemperature = [...Array(1200).fill(37.5), ...Array(1200).fill(38.2)];
  const heat = heatAnalysis({ coreTemperature }, { fromSeconds: 1200, toSeconds: 2400 });
  assert.equal(heat.startC, 38.2);
  assert.equal(heat.peakMinute, 20);
  assert.equal(heat.minutesAboveC["38.0"], 20);
});
