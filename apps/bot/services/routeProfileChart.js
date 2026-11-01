/**
 * Draw route profile PNGs for Discord: the full race profile, and close-ups of climbs coloured by
 * gradient. A thin drawing layer over routeProfileGeometry, which holds the arithmetic and tests.
 *
 * Best-effort like workoutChart: `canvas` is native, so every failure returns null and the caller
 * says so in text instead.
 */
const {
  GRADE_BANDS,
  gradeBins,
  stretchStats,
  niceTicks,
  zoomSegment,
  profileBands,
} = require("./routeProfileGeometry");
const { loadPowerupImage } = require("./powerupIcons");

const BG = "#1A202C";
const GRID = "#2D3748";
const AXIS_TEXT = "#A0AEC0";
const TITLE = "#FFFFFF";
const PROFILE_FILL = "#4A5568";
const PROFILE_LINE = "#CBD5E0";
const FONT = "sans-serif";

function loadCanvas() {
  try {
    return require("canvas").createCanvas;
  } catch (err) {
    console.warn("route profile: canvas unavailable:", err?.message || err);
    return null;
  }
}

function frame(ctx, { width, height, pad, xMin, xMax, yMin, yMax }) {
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (km) => pad.left + ((km - xMin) / (xMax - xMin)) * plotW;
  const y = (m) => pad.top + plotH - ((m - yMin) / (yMax - yMin)) * plotH;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = AXIS_TEXT;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const m of niceTicks(yMin, yMax, 5)) {
    ctx.beginPath();
    ctx.moveTo(pad.left, y(m));
    ctx.lineTo(width - pad.right, y(m));
    ctx.stroke();
    ctx.fillText(`${Math.round(m)} m`, pad.left - 6, y(m));
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const km of niceTicks(xMin, xMax, 10)) {
    ctx.fillText(`${Number(km.toFixed(2))} km`, x(km), height - pad.bottom + 6);
  }
  return { x, y, plotW, plotH };
}

function yRange(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(20, hi - lo);
  return { yMin: Math.floor((lo - span * 0.05) / 10) * 10, yMax: Math.ceil((hi + span * 0.25) / 10) * 10 };
}

function title(ctx, text, sub, width) {
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = TITLE;
  ctx.font = `bold 20px ${FONT}`;
  ctx.fillText(text, 20, 14);
  if (sub) {
    ctx.fillStyle = AXIS_TEXT;
    ctx.font = `14px ${FONT}`;
    ctx.fillText(sub, 20, 40, width - 40);
  }
}

function drawDashedGuide(ctx, xOf, km, top, bottom) {
  ctx.strokeStyle = AXIS_TEXT;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(xOf(km), top);
  ctx.lineTo(xOf(km), bottom);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Lap and finish arches have no coloured band, so the icon needs the same dashed guide as the lead-in.
function flyingPowerupKm(profile, markers) {
  const segments = profile?.segments || [];
  const km = [];
  for (const marker of markers || []) {
    if (!(marker?.atKm >= 0) || !(marker.powerupIds || []).length) continue;
    if (Number(profile?.leadInKm) > 0 && Math.abs(marker.atKm - profile.leadInKm) < 0.02) continue;
    const onBand = segments.some(
      (segment) =>
        (segment.type === "sprint" || segment.type === "climb") &&
        Math.abs(Number(segment.toKm) - marker.atKm) < 0.02
    );
    if (!onBand) km.push(marker.atKm);
  }
  return km;
}

async function drawPowerupIcons(ctx, xOf, markers, plotTop) {
  const size = 22;
  const gap = 2;
  // Names occupy the three rows above the plot. The stack starts under that band.
  const topOfStack = plotTop + 4;
  for (const marker of markers || []) {
    const ids = marker?.powerupIds || [];
    if (!ids.length || !(marker.atKm >= 0)) continue;
    const cx = xOf(marker.atKm);
    let top = topOfStack;
    for (const id of ids) {
      try {
        const img = await loadPowerupImage(id);
        if (!img) continue;
        ctx.drawImage(img, cx - size / 2, top, size, size);
        top += size + gap;
      } catch (err) {
        console.warn("route profile: powerup icon skipped:", err?.message || err);
      }
    }
  }
}

/** Full race profile with climbs and sprints banded and labelled.
 * powerups is an optional list of { atKm, powerupIds }. Omit it and the picture is unchanged.
 */
async function renderRouteProfile(profile, { name = "", subtitle = "", powerups = [] } = {}) {
  const createCanvas = loadCanvas();
  if (!createCanvas) return null;
  try {
    const km = profile?.distanceKm || [];
    const alt = profile?.altitudeM || [];
    if (km.length < 2 || alt.length < 2) return null;

    const width = 1200;
    const height = 420;
    const pad = { top: 112, right: 24, bottom: 34, left: 60 };
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const { yMin, yMax } = yRange(alt);
    const xMin = km[0];
    const xMax = km[km.length - 1];
    const { x, y } = frame(ctx, { width, height, pad, xMin, xMax, yMin, yMax });
    const bottom = height - pad.bottom;

    // Climb and sprint bands behind the profile, labels staggered so neighbours do not collide.
    const bands = profileBands(profile.segments);
    ctx.font = `bold 12px ${FONT}`;
    const rows = [];
    for (const band of bands) {
      ctx.fillStyle = `${band.color}55`;
      ctx.fillRect(x(band.fromKm), pad.top, Math.max(2, x(band.toKm) - x(band.fromKm)), bottom - pad.top);
      const label = band.name;
      const w = ctx.measureText(label).width;
      const left = x(band.fromKm);
      let row = rows.findIndex((end) => end < left - 6);
      if (row < 0) {
        row = rows.length;
        rows.push(0);
      }
      if (row > 2) continue;
      rows[row] = left + w;
      ctx.fillStyle = band.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(label, left + 2, pad.top - 28 - row * 15);
    }

    if (profile.leadInKm > km[0] + 0.05) {
      const xLead = x(profile.leadInKm);
      const xStart = x(km[0]);
      ctx.fillStyle = "rgba(160, 174, 192, 0.18)";
      ctx.fillRect(xStart, pad.top, Math.max(0, xLead - xStart), bottom - pad.top);
    }

    ctx.beginPath();
    ctx.moveTo(x(km[0]), bottom);
    for (let i = 0; i < km.length; i += 1) ctx.lineTo(x(km[i]), y(alt[i]));
    ctx.lineTo(x(km[km.length - 1]), bottom);
    ctx.closePath();
    ctx.fillStyle = `${PROFILE_FILL}cc`;
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < km.length; i += 1) ctx[i ? "lineTo" : "moveTo"](x(km[i]), y(alt[i]));
    ctx.strokeStyle = PROFILE_LINE;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (profile.leadInKm > 0) drawDashedGuide(ctx, x, profile.leadInKm, pad.top, bottom);
    if (profile.leadInKm > km[0] + 0.05) {
      const xStart = x(km[0]);
      const xLead = x(profile.leadInKm);
      ctx.font = `bold 12px ${FONT}`;
      const label = "Lead-in";
      const widthPx = ctx.measureText(label).width;
      if (xLead - xStart >= widthPx + 8) {
        ctx.fillStyle = TITLE;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, (xStart + xLead) / 2, (pad.top + bottom) / 2);
      }
    }
    for (const km of flyingPowerupKm(profile, powerups)) drawDashedGuide(ctx, x, km, pad.top, bottom);

    if (powerups.length) await drawPowerupIcons(ctx, x, powerups, pad.top);
    title(ctx, name, subtitle, width);
    return canvas.toBuffer("image/png");
  } catch (err) {
    console.warn("route profile: render failed:", err?.message || err);
    return null;
  }
}

/** Close-up of one climb or stretch, each bar coloured by its gradient. */
function renderClimbZoom(profile, zoom) {
  const createCanvas = loadCanvas();
  if (!createCanvas) return null;
  try {
    const bins = gradeBins(profile?.distanceKm || [], profile?.altitudeM || [], zoom.fromKm, zoom.toKm);
    if (!bins.length) return null;
    const climb = zoomSegment(profile, zoom);
    const stats = stretchStats(gradeBins(profile.distanceKm, profile.altitudeM, climb.fromKm, climb.toKm));

    const width = 1000;
    const height = 420;
    const pad = { top: 72, right: 24, bottom: 34, left: 60 };
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const { yMin, yMax } = yRange(bins.flatMap((b) => [b.altFrom, b.altTo]));
    const { x, y } = frame(ctx, { width, height, pad, xMin: zoom.fromKm, xMax: zoom.toKm, yMin, yMax });
    const bottom = height - pad.bottom;

    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const bin of bins) {
      ctx.beginPath();
      ctx.moveTo(x(bin.fromKm), bottom);
      ctx.lineTo(x(bin.fromKm), y(bin.altFrom));
      ctx.lineTo(x(bin.toKm), y(bin.altTo));
      ctx.lineTo(x(bin.toKm), bottom);
      ctx.closePath();
      ctx.fillStyle = bin.color;
      ctx.fill();
      ctx.strokeStyle = BG;
      ctx.lineWidth = 1;
      ctx.stroke();
      const barW = x(bin.toKm) - x(bin.fromKm);
      if (barW >= 38) {
        ctx.fillStyle = TITLE;
        ctx.fillText(`${bin.grade.toFixed(1)}%`, (x(bin.fromKm) + x(bin.toKm)) / 2, Math.min(y(bin.altFrom), y(bin.altTo)) - 3);
      }
    }

    const sub = `${stats.lengthKm.toFixed(2)} km · ${Math.round(stats.gainM)} m · avg ${stats.avgGrade.toFixed(1)}% · max ${stats.maxGrade.toFixed(1)}%`;
    title(ctx, zoom.title, sub, width);

    // Legend, top right.
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let lx = width - pad.right - GRADE_BANDS.length * 70;
    for (const band of GRADE_BANDS) {
      ctx.fillStyle = band.color === "#111111" ? "#000000" : band.color;
      ctx.fillRect(lx, 22, 12, 12);
      ctx.strokeStyle = AXIS_TEXT;
      ctx.strokeRect(lx, 22, 12, 12);
      ctx.fillStyle = AXIS_TEXT;
      ctx.fillText(band.label, lx + 16, 28);
      lx += 70;
    }
    return canvas.toBuffer("image/png");
  } catch (err) {
    console.warn("route profile zoom: render failed:", err?.message || err);
    return null;
  }
}

module.exports = { renderRouteProfile, renderClimbZoom };
