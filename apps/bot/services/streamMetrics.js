/**
 * Derived metrics from activity power and heart-rate streams.
 *
 * Pure functions, no I/O and no imports, so this can be unit tested — the numbers here end up in
 * coaching advice, and a silently wrong power curve is the fastest way to lose a strong rider's
 * trust.
 *
 * Streams never reach the model. A two-hour ride is roughly 7,200 samples per stream; the whole
 * point is to reduce that to a handful of numbers here and send only those.
 */

/** Standard mean-maximal durations, in seconds. */
const MMP_DURATIONS = [5, 15, 30, 60, 300, 480, 720, 1200, 3600];

/**
 * Resample an irregularly-sampled stream onto a 1 Hz grid.
 *
 * Device recording does not always sample every second — it records when values change, so
 * gaps of several seconds are normal. Treating the raw array as 1 Hz (its index as its timestamp)
 * silently compresses time and inflates every rolling-window metric: a 20-minute power computed
 * over what is really 35 minutes of riding. The `time` stream carries the true offsets, so use it.
 *
 * @param {number[]} timeStream Seconds from activity start, monotonically increasing.
 * @param {number[]} values Samples aligned to timeStream.
 * @param {"zero"|"hold"} fill How to fill gaps. Power coasts to zero; heart rate holds its
 *   previous value, because a gap in HR means "not recorded", not "no heartbeat".
 * @returns {number[]} One value per second, index = seconds from start.
 */
function resampleTo1Hz(timeStream, values, fill = "zero") {
  if (!Array.isArray(timeStream) || !Array.isArray(values) || timeStream.length === 0) return [];
  const n = Math.min(timeStream.length, values.length);
  if (n === 0) return [];

  const lastTime = Math.floor(Number(timeStream[n - 1]));
  if (!Number.isFinite(lastTime) || lastTime < 0) return [];
  // Guard against a corrupt stream claiming a 30-day ride.
  const duration = Math.min(lastTime, 24 * 3600);

  const out = new Array(duration + 1).fill(fill === "hold" ? null : 0);
  let previous = 0;

  for (let i = 0; i < n; i++) {
    const t = Math.floor(Number(timeStream[i]));
    if (!Number.isFinite(t) || t < 0 || t > duration) continue;
    const v = Number(values[i]);
    const value = Number.isFinite(v) ? v : previous;
    out[t] = value;
    previous = value;
  }

  if (fill === "hold") {
    let carry = null;
    for (let i = 0; i < out.length; i++) {
      if (out[i] == null) out[i] = carry;
      else carry = out[i];
    }
  }
  return out;
}

/** Rolling mean over `window` seconds, returned at each end-index. */
function rollingMean(series, window) {
  if (!Array.isArray(series) || window <= 0 || series.length < window) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    sum += Number(series[i]) || 0;
    if (i >= window) sum -= Number(series[i - window]) || 0;
    if (i >= window - 1) out.push(sum / window);
  }
  return out;
}

/**
 * Best average power sustained for each duration — the mean-maximal curve.
 * Derived from the watts stream.
 */
function meanMaxPower(watts1Hz, durations = MMP_DURATIONS) {
  const out = {};
  for (const duration of durations) {
    const means = rollingMean(watts1Hz, duration);
    out[duration] = means.length ? Math.round(Math.max(...means)) : null;
  }
  return out;
}

/**
 * Normalized power: 30-second rolling average, raised to the fourth power, averaged, fourth root.
 * Weights surges more heavily than a plain average, which is why it tracks perceived cost better.
 */
function normalizedPower(watts1Hz) {
  const rolled = rollingMean(watts1Hz, 30);
  if (rolled.length === 0) return null;
  const meanOfFourth = rolled.reduce((acc, w) => acc + Math.pow(Math.max(0, w), 4), 0) / rolled.length;
  return Math.round(Math.pow(meanOfFourth, 0.25));
}

/** Intensity factor: normalized power relative to threshold. */
function intensityFactor(np, ftp) {
  if (!np || !ftp || ftp <= 0) return null;
  return Number((np / ftp).toFixed(3));
}

/** Training stress for the session. 100 = an hour at threshold. */
function trainingStressScore(np, ftp, durationSeconds) {
  const intensity = intensityFactor(np, ftp);
  if (!intensity || !durationSeconds || durationSeconds <= 0) return null;
  return Math.round((durationSeconds * np * intensity) / (ftp * 3600) * 100);
}

/**
 * Intervals.icu-style W′ balance. Work above FTP spends finite anaerobic capacity; riding below
 * FTP restores it progressively. Inputs are one-second power samples and W′ in joules.
 */
function wPrimeBalance(watts1Hz, ftp, wPrimeJ) {
  if (!Array.isArray(watts1Hz) || !watts1Hz.length || !ftp || ftp <= 0 || !wPrimeJ || wPrimeJ <= 0) {
    return [];
  }
  let balance = Number(wPrimeJ);
  return watts1Hz.map((raw) => {
    const watts = Math.max(0, Number(raw) || 0);
    const delta = Number(ftp) - watts;
    if (delta > 0) balance += delta * (wPrimeJ - balance) / wPrimeJ;
    else balance += delta;
    return Math.round(balance);
  });
}

/**
 * Aerobic decoupling: how far the power-to-heart-rate ratio drifts from the first half of a ride
 * to the second. Rising cardiac cost at the same power indicates fading durability. Conventionally
 * anything under about 5% is considered aerobically sound.
 *
 * Only meaningful for steady rides; returns null when either half lacks usable data.
 */
function aerobicDecoupling(watts1Hz, hr1Hz) {
  if (!Array.isArray(watts1Hz) || !Array.isArray(hr1Hz)) return null;
  const n = Math.min(watts1Hz.length, hr1Hz.length);
  if (n < 600) return null; // under ten minutes, drift is noise

  const half = Math.floor(n / 2);
  const efficiency = (from, to) => {
    let power = 0;
    let heart = 0;
    let count = 0;
    for (let i = from; i < to; i++) {
      const w = Number(watts1Hz[i]);
      const h = Number(hr1Hz[i]);
      if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) continue;
      power += w;
      heart += h;
      count += 1;
    }
    if (count < 60) return null;
    const avgHr = heart / count;
    return avgHr > 0 ? power / count / avgHr : null;
  };

  const first = efficiency(0, half);
  const second = efficiency(half, n);
  if (first == null || second == null || first === 0) return null;
  return Number((((first - second) / first) * 100).toFixed(1));
}

/**
 * Seconds spent in each power zone.
 * @param {number[]} boundaries Ascending upper bounds; the final zone is open-ended.
 */
function timeInZones(watts1Hz, boundaries) {
  if (!Array.isArray(watts1Hz) || !Array.isArray(boundaries) || boundaries.length === 0) return null;
  const counts = new Array(boundaries.length + 1).fill(0);
  for (const raw of watts1Hz) {
    const w = Number(raw);
    if (!Number.isFinite(w)) continue;
    let zone = boundaries.findIndex((upper) => w <= upper);
    if (zone === -1) zone = boundaries.length;
    counts[zone] += 1;
  }
  return counts;
}

/**
 * Detect work intervals: contiguous stretches above `thresholdWatts`.
 *
 * `minSeconds` discards surges too short to be a deliberate effort, and `bridgeSeconds` joins
 * blocks separated by a brief dip, so one interval with a momentary freewheel is not reported as
 * two.
 */
function detectIntervals(watts1Hz, { thresholdWatts, minSeconds = 30, bridgeSeconds = 10 } = {}) {
  if (!Array.isArray(watts1Hz) || !thresholdWatts || thresholdWatts <= 0) return [];

  const blocks = [];
  let start = null;
  let gap = 0;

  for (let i = 0; i < watts1Hz.length; i++) {
    const above = (Number(watts1Hz[i]) || 0) >= thresholdWatts;
    if (above) {
      if (start == null) start = i;
      gap = 0;
    } else if (start != null) {
      gap += 1;
      if (gap > bridgeSeconds) {
        blocks.push([start, i - gap]);
        start = null;
        gap = 0;
      }
    }
  }
  if (start != null) blocks.push([start, watts1Hz.length - 1]);

  return blocks
    .filter(([from, to]) => to - from + 1 >= minSeconds)
    .map(([from, to]) => {
      const slice = watts1Hz.slice(from, to + 1).map((w) => Number(w) || 0);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      return {
        startSeconds: from,
        durationSeconds: to - from + 1,
        averageWatts: Math.round(avg),
        peakWatts: Math.round(Math.max(...slice)),
      };
    });
}

/**
 * Average and maximum of the positive samples. Zero heart rate is a strap dropout and zero cadence
 * is coasting, so neither belongs in the average.
 */
function positiveStats(series) {
  if (!Array.isArray(series)) return null;
  let sum = 0;
  let count = 0;
  let max = 0;
  for (const raw of series) {
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) continue;
    sum += v;
    count += 1;
    if (v > max) max = v;
  }
  return count ? { average: Math.round(sum / count), max: Math.round(max) } : null;
}

/** Preserve the decimal precision needed for body-temperature sensor data. */
function temperatureStats(series) {
  return seriesStats(series, { digits: 2, positiveOnly: true });
}

/** Decimal-preserving summary for sensor streams. */
function seriesStats(series, { digits = 1, positiveOnly = false } = {}) {
  if (!Array.isArray(series)) return null;
  const values = series
    .filter((value) => value != null && value !== "")
    .map(Number)
    .filter((value) => Number.isFinite(value) && (!positiveOnly || value > 0));
  if (!values.length) return null;
  const rounded = (value) => Number(value.toFixed(digits));
  return {
    average: rounded(values.reduce((sum, value) => sum + value, 0) / values.length),
    min: rounded(Math.min(...values)),
    max: rounded(Math.max(...values)),
  };
}

/** Heart rate, cadence and core temperature for each detected interval. */
function enrichIntervals(intervals, { heartrate = [], cadence = [], coreTemperature = [] } = {}) {
  if (!Array.isArray(intervals)) return [];
  return intervals.map((interval) => {
    const from = interval.startSeconds;
    const to = from + interval.durationSeconds;
    const hr = positiveStats(heartrate.slice(from, to));
    const cad = positiveStats(cadence.slice(from, to));
    const core = temperatureStats(coreTemperature.slice(from, to));
    return {
      ...interval,
      averageHeartRate: hr?.average ?? null,
      maxHeartRate: hr?.max ?? null,
      averageCadence: cad?.average ?? null,
      // Most riders have no core sensor; an empty field would invite the model to talk about it.
      ...(core ? { averageCoreTemperatureC: core.average, maxCoreTemperatureC: core.max } : {}),
    };
  });
}

/**
 * Metrics for one stretch of a ride, `fromSeconds` inclusive to `toSeconds` exclusive.
 * Returns null when the window is under 30 seconds or outside the ride.
 */
function segmentSummary(
  { watts = [], heartrate = [], cadence = [], coreTemperature = [] } = {},
  fromSeconds,
  toSeconds,
  { ftp } = {}
) {
  const length = Math.max(watts.length, heartrate.length, cadence.length, coreTemperature.length);
  const from = Math.max(0, Math.floor(Number(fromSeconds) || 0));
  const to = Math.min(length, Math.floor(Number.isFinite(Number(toSeconds)) ? Number(toSeconds) : length));
  if (!(to - from >= 30)) return null;

  const w = watts.slice(from, to).map((x) => Number(x) || 0);
  const h = heartrate.slice(from, to);
  const hr = positiveStats(h);
  const cad = positiveStats(cadence.slice(from, to));
  const core = temperatureStats(coreTemperature.slice(from, to));
  const np = w.length >= 30 ? normalizedPower(w) : null;
  const intervals = ftp && w.length
    ? enrichIntervals(
        detectIntervals(w, { thresholdWatts: Math.round(ftp * 0.95) }),
        {
          heartrate: h,
          cadence: cadence.slice(from, to),
          coreTemperature: coreTemperature.slice(from, to),
        }
      ).map((interval) => ({ ...interval, startSeconds: interval.startSeconds + from }))
    : [];

  return {
    fromSeconds: from,
    toSeconds: to,
    durationSeconds: to - from,
    averageWatts: w.length ? Math.round(w.reduce((a, b) => a + b, 0) / w.length) : null,
    normalizedPower: np,
    intensityFactor: intensityFactor(np, ftp),
    peakWatts: w.length ? Math.round(Math.max(...w)) : null,
    meanMaxPower: w.length ? meanMaxPower(w, MMP_DURATIONS.filter((d) => d <= w.length)) : null,
    averageHeartRate: hr?.average ?? null,
    maxHeartRate: hr?.max ?? null,
    averageCadence: cad?.average ?? null,
    ...(core
      ? {
          averageCoreTemperatureC: core.average,
          minCoreTemperatureC: core.min,
          maxCoreTemperatureC: core.max,
        }
      : {}),
    aerobicDecouplingPercent: aerobicDecoupling(w, h),
    intervals,
  };
}

/** Core body temperature outside this range is a sensor glitch or a sensor not yet worn. */
const CORE_TEMPERATURE_RANGE_C = [34, 42];

function plausibleCore(raw) {
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  const [low, high] = CORE_TEMPERATURE_RANGE_C;
  return Number.isFinite(value) && value >= low && value <= high ? value : null;
}

function round(value, digits) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

function meanOf(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** [from, to) clamped to the longest of the given series. Null when shorter than `minSeconds`. */
function clampWindow(seriesList, fromSeconds, toSeconds, minSeconds) {
  const length = Math.max(0, ...seriesList.map((s) => (Array.isArray(s) ? s.length : 0)));
  const from = Math.max(0, Math.floor(Number(fromSeconds) || 0));
  const requestedTo = Number(toSeconds);
  const to = Math.min(length, Number.isFinite(requestedTo) ? Math.floor(requestedTo) : length);
  return to - from >= minSeconds ? { from, to } : null;
}

const TIMELINE_BUCKETS = [30, 60, 120, 180, 300, 600, 900, 1800];

/**
 * The ride as a short table, one row per time bucket, so the model can see how power, heart rate
 * and body temperature moved together rather than only their whole-ride averages.
 *
 * A column is present only when its stream has data in the window, so a rider without a core
 * sensor gets no temperature column at all. Each row is one comma-separated line in `columns`
 * order, to keep the payload small: a one-hour ride is 60 short lines.
 */
function activityTimeline(
  { watts = [], heartrate = [], cadence = [], coreTemperature = [], skinTemperature = [] } = {},
  { fromSeconds = 0, toSeconds = Infinity, maxRows = 90, minBucketSeconds = 60 } = {}
) {
  const window = clampWindow(
    [watts, heartrate, cadence, coreTemperature, skinTemperature],
    fromSeconds,
    toSeconds,
    60
  );
  if (!window) return null;
  const { from, to } = window;
  const duration = to - from;
  const bucketSeconds =
    TIMELINE_BUCKETS.find((b) => b >= minBucketSeconds && Math.ceil(duration / b) <= maxRows) ??
    TIMELINE_BUCKETS[TIMELINE_BUCKETS.length - 1];

  const positiveMean = (slice) => {
    const values = slice.map(Number).filter((v) => Number.isFinite(v) && v > 0);
    return values.length ? Math.round(meanOf(values)) : null;
  };
  const candidates = [
    {
      name: "watts",
      series: watts,
      // Coasting is real zero power, so it stays in the average.
      stat: (slice) => (slice.length ? Math.round(meanOf(slice.map((v) => Number(v) || 0))) : null),
      present: (slice) => slice.some((v) => Number(v) > 0),
    },
    { name: "heartRate", series: heartrate, stat: positiveMean },
    { name: "cadence", series: cadence, stat: positiveMean },
    {
      name: "coreTemperatureC",
      series: coreTemperature,
      stat: (slice) => round(meanOf(slice.map(plausibleCore).filter((v) => v != null)), 2),
      present: (slice) => slice.some((v) => plausibleCore(v) != null),
    },
    {
      name: "skinTemperatureC",
      series: skinTemperature,
      stat: (slice) => seriesStats(slice, { digits: 1, positiveOnly: true })?.average ?? null,
    },
  ];
  const columns = candidates.filter((column) => {
    const slice = Array.isArray(column.series) ? column.series.slice(from, to) : [];
    return column.present ? column.present(slice) : slice.some((v) => Number(v) > 0);
  });
  if (!columns.length) return null;

  // Rows are "minute, value, value" strings: Firestore (the metrics cache) rejects nested arrays,
  // and a plain table reads well for the model. "-" marks a bucket with no reading.
  const rows = [];
  for (let start = from; start < to; start += bucketSeconds) {
    const end = Math.min(to, start + bucketSeconds);
    const values = [
      round(start / 60, 1),
      ...columns.map((column) => column.stat(column.series.slice(start, end))),
    ];
    rows.push(values.map((value) => (value == null ? "-" : String(value))).join(", "));
  }
  return {
    bucketSeconds,
    columns: ["minute", ...columns.map((column) => column.name)],
    rows,
  };
}

const HEAT_THRESHOLDS_C = [38, 38.5, 39];

/**
 * How core temperature developed and how the heart's cost of each watt changed alongside it.
 * Returns null without at least two minutes of plausible core-temperature samples, so riders
 * without a sensor get nothing.
 */
function heatAnalysis(
  { watts = [], heartrate = [], coreTemperature = [] } = {},
  { fromSeconds = 0, toSeconds = Infinity } = {}
) {
  const window = clampWindow([coreTemperature], fromSeconds, toSeconds, 120);
  if (!window) return null;
  const { from, to } = window;
  const core = coreTemperature.slice(from, to).map(plausibleCore);
  const valid = [];
  core.forEach((value, i) => {
    if (value != null) valid.push(i);
  });
  if (valid.length < 120) return null;

  const averageBetween = (a, b) =>
    meanOf(core.slice(Math.max(0, a), Math.max(0, b)).filter((v) => v != null));
  const first = valid[0];
  const last = valid[valid.length - 1];
  const startC = averageBetween(first, first + 60);
  const endC = averageBetween(last - 59, last + 1);

  let peakIndex = first;
  for (const i of valid) if (core[i] > core[peakIndex]) peakIndex = i;
  const peakC = core[peakIndex];

  let maxRise = null;
  for (let i = 0; i + 600 < core.length; i++) {
    if (core[i] == null || core[i + 600] == null) continue;
    const rise = core[i + 600] - core[i];
    if (maxRise == null || rise > maxRise) maxRise = rise;
  }

  const minutesToPeak = (peakIndex - first) / 60;
  const minutesAboveC = Object.fromEntries(
    HEAT_THRESHOLDS_C.map((threshold) => [
      threshold.toFixed(1),
      round(valid.filter((i) => core[i] >= threshold).length / 60, 1),
    ])
  );

  // Thirds of the window: does the heart pay more per watt as the body heats up?
  let byThird = null;
  if (to - from >= 900) {
    const size = Math.floor((to - from) / 3);
    byThird = [0, 1, 2].map((part) => {
      const a = from + part * size;
      const b = part === 2 ? to : a + size;
      const w = Array.isArray(watts) ? watts.slice(a, b).map((v) => Number(v) || 0) : [];
      const hasPower = w.some((v) => v > 0);
      const averageWatts = hasPower ? Math.round(meanOf(w)) : null;
      const averageHeartRate = positiveStats(Array.isArray(heartrate) ? heartrate.slice(a, b) : [])?.average ?? null;
      const coreAverage = round(averageBetween(a - from, b - from), 2);
      return Object.fromEntries(
        Object.entries({
          fromMinute: round(a / 60, 1),
          toMinute: round(b / 60, 1),
          averageWatts,
          averageHeartRate,
          averageCoreTemperatureC: coreAverage,
          heartRatePer100W:
            averageWatts && averageHeartRate ? round((averageHeartRate / averageWatts) * 100, 1) : null,
        }).filter(([, value]) => value != null)
      );
    });
  }

  const summary = {
    startC: round(startC, 2),
    endC: round(endC, 2),
    peakC: round(peakC, 2),
    peakMinute: round((from + peakIndex) / 60, 1),
    riseFromStartToPeakC: round(peakC - startC, 2),
    riseCPer10MinToPeak: minutesToPeak >= 5 ? round(((peakC - startC) / minutesToPeak) * 10, 2) : null,
    largestRiseIn10MinC: round(maxRise, 2),
    minutesAboveC,
    byThird,
  };
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value != null));
}

module.exports = {
  MMP_DURATIONS,
  resampleTo1Hz,
  rollingMean,
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
};
