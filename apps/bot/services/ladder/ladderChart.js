// Loaded on first use so modules that only need cleanName() (and the unit tests) do not need the native canvas binary.
let canvasLib;
function canvasModule() {
  if (!canvasLib) canvasLib = require("canvas");
  return canvasLib;
}

const FONT = "Arial, Helvetica, sans-serif";
const C = { bg: "#1e1f24", panel: "#2a2c33", text: "#f2f3f5", muted: "#a3a7b0", grid: "#3a3d46", gold: "#f5c542" };
const FALLBACK = { us: "#e0463a", them: "#3b6fd4" };
const DURATIONS = [
  { seconds: 15, label: "15s" },
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 300, label: "5 min" },
  { seconds: 1200, label: "20 min" },
];
const WIDTH = 960;
const PAD = 20;

// Canvas has no emoji font, so drop anything outside letters, digits and basic punctuation.
function cleanName(name) {
  const plain = name.replace(/[^\p{L}\p{N}\s.\-[\]()#_']/gu, "").replace(/\s+/g, " ").trim();
  // Team tags like [DZR], (DBR), #DZR# (also unbalanced ones such as "[DZR)") are noise in the chart.
  const stripped = plain.replace(/\s*[[(#][^[\]()#]*[\])#]/g, "").trim();
  return stripped || plain;
}

function avg(riders, seconds) {
  const values = riders.map((r) => r.wkg[seconds]).filter((v) => typeof v === "number");
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Brightens colours that would disappear against the dark background.
function readable(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  const mix = lum < 0.35 ? 0.3 : 0;
  return `rgb(${rgb.map((v) => Math.round(v + (255 - v) * mix)).join(",")})`;
}

function colorDistance(a, b) {
  const x = hexToRgb(a), y = hexToRgb(b);
  if (!x || !y) return 0;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// Puts our own team ("us") first and picks distinct, readable colours from the ladder club colours.
function orient(fixture, ourTeam) {
  const awayIsUs = ourTeam && fixture.away.name && fixture.away.name.toLowerCase() === ourTeam.toLowerCase();
  const us = awayIsUs ? fixture.away : fixture.home;
  const them = awayIsUs ? fixture.home : fixture.away;
  const clubs = fixture.colors || {};
  const usHex = awayIsUs ? clubs.away : clubs.home;
  const themHex = awayIsUs ? clubs.home : clubs.away;
  const distinct = usHex && themHex && colorDistance(usHex, themHex) > 110;
  return {
    us,
    them,
    usColor: (distinct && readable(usHex)) || FALLBACK.us,
    themColor: (distinct && readable(themHex)) || FALLBACK.them,
  };
}

function panel(ctx, x, y, w, h, title) {
  ctx.fillStyle = C.panel;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.fillStyle = C.text;
  ctx.font = `bold 26px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(title, x + 22, y + 40);
}

function legend(ctx, x, y, items) {
  ctx.font = `22px ${FONT}`;
  ctx.textAlign = "left";
  let cx = x;
  for (const [name, color] of items) {
    ctx.fillStyle = color;
    ctx.fillRect(cx, y - 16, 18, 18);
    ctx.fillStyle = C.text;
    ctx.fillText(name, cx + 28, y);
    cx += 28 + ctx.measureText(name).width + 36;
  }
}

function drawBars(ctx, x, y, w, h, o) {
  panel(ctx, x, y, w, h, "Gennemsnit pr. varighed (W/kg, 90 dage)");
  legend(ctx, x + 22, y + 78, [[o.us.name, o.usColor], [o.them.name, o.themColor]]);
  const left = x + 64, right = x + w - 26, top = y + 126, bottom = y + h - 52;
  const values = DURATIONS.map((d) => [avg(o.us.riders, d.seconds), avg(o.them.riders, d.seconds)]);
  const peak = Math.max(1, ...values.flat().filter((v) => v !== null));
  const step = Math.ceil((peak * 1.15) / 4);
  const max = step * 4;

  ctx.font = `18px ${FONT}`;
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const gy = bottom - ((bottom - top) * i) / 4;
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    ctx.moveTo(left, gy);
    ctx.lineTo(right, gy);
    ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.fillText(String(step * i), left - 10, gy + 6);
  }

  const group = (right - left) / DURATIONS.length;
  const barW = Math.min(64, group / 3);
  DURATIONS.forEach((d, i) => {
    const gx = left + group * i + group / 2;
    const [uv, tv] = values[i];
    [[uv, o.usColor, -barW - 4], [tv, o.themColor, 4]].forEach(([v, color, dx]) => {
      if (v === null) return;
      const bh = ((bottom - top) * v) / max;
      ctx.fillStyle = color;
      ctx.fillRect(gx + dx, bottom - bh, barW, bh);
      ctx.fillStyle = C.text;
      ctx.font = `bold 20px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(v.toFixed(2), gx + dx + barW / 2, bottom - bh - 8);
    });
    if (uv !== null && tv !== null && Math.abs(uv - tv) >= 0.05) {
      const usAhead = uv > tv;
      const label = `+${Math.abs(uv - tv).toFixed(2)}`;
      ctx.font = `bold 18px ${FONT}`;
      const tw = ctx.measureText(label).width + 18;
      const ty = bottom - ((bottom - top) * Math.max(uv, tv)) / max - 56;
      ctx.fillStyle = usAhead ? o.usColor : o.themColor;
      ctx.beginPath();
      ctx.roundRect(gx - tw / 2, ty, tw, 26, 13);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(label, gx, ty + 19);
    }
    ctx.fillStyle = C.muted;
    ctx.font = `22px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(d.label, gx, bottom + 34);
  });
}

function drawDiff(ctx, x, y, w, h, o) {
  panel(ctx, x, y, w, h, "Hvem er foran? (forskel i W/kg)");
  ctx.font = `19px ${FONT}`;
  ctx.fillStyle = o.usColor;
  ctx.textAlign = "left";
  ctx.fillText(`< ${o.us.name}`, x + 22, y + 74);
  ctx.fillStyle = o.themColor;
  ctx.textAlign = "right";
  ctx.fillText(`${o.them.name} >`, x + w - 22, y + 74);

  const diffs = DURATIONS.map((d) => {
    const u = avg(o.us.riders, d.seconds), t = avg(o.them.riders, d.seconds);
    return u === null || t === null ? null : u - t;
  });
  const maxAbs = Math.max(0.3, ...diffs.filter((v) => v !== null).map(Math.abs));
  const labelW = 110, left = x + 22 + labelW, right = x + w - 22, mid = (left + right) / 2;
  const half = (right - left) / 2 - 120;

  ctx.strokeStyle = C.grid;
  ctx.beginPath();
  ctx.moveTo(mid, y + 92);
  ctx.lineTo(mid, y + h - 16);
  ctx.stroke();

  DURATIONS.forEach((d, i) => {
    const ry = y + 100 + i * 52;
    ctx.fillStyle = C.muted;
    ctx.font = `22px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(d.label, x + 22, ry + 28);
    const diff = diffs[i];
    ctx.font = `bold 20px ${FONT}`;
    if (diff === null) {
      ctx.fillStyle = C.muted;
      ctx.textAlign = "center";
      ctx.fillText("ingen data", mid, ry + 28);
      return;
    }
    if (Math.abs(diff) < 0.05) {
      ctx.fillStyle = C.text;
      ctx.textAlign = "center";
      ctx.fillText("lige", mid, ry + 28);
      return;
    }
    const bw = Math.max(8, (half * Math.abs(diff)) / maxAbs);
    const usAhead = diff > 0;
    ctx.fillStyle = usAhead ? o.usColor : o.themColor;
    ctx.fillRect(usAhead ? mid - bw : mid, ry + 6, bw, 32);
    ctx.fillStyle = C.text;
    ctx.textAlign = usAhead ? "right" : "left";
    ctx.fillText(`${Math.abs(diff).toFixed(2)} W/kg`, usAhead ? mid - bw - 10 : mid + bw + 10, ry + 29);
  });
}

function sortedRiders(team) {
  const score = (r) => [r.wkg[1200], r.wkg[300]].map((v) => (typeof v === "number" ? v : -1));
  return [...team.riders].sort((a, b) => score(b)[0] - score(a)[0] || score(b)[1] - score(a)[1]);
}

const TABLE_ROW_H = 34;
const TABLE_TEAM_H = 44;
const TABLE_HEAD_H = 34;

function riderTableHeight(o) {
  return 64 + TABLE_HEAD_H + 2 * TABLE_TEAM_H + (o.us.riders.length + o.them.riders.length) * TABLE_ROW_H + 24;
}

// Same teal-to-purple scale as the EventViewer heatmap: low is light, high is dark.
function heatColor(t) {
  const stops = [[0, 200, 240, 230], [0.25, 50, 195, 175], [0.5, 20, 125, 145], [0.75, 35, 70, 150], [1, 55, 30, 115]];
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [p0, r0, g0, b0] = stops[i];
  const [p1, r1, g1, b1] = stops[i + 1];
  const f = (t - p0) / (p1 - p0);
  const rgb = [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f].map(Math.round);
  const lum = (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255;
  return { fill: `rgb(${rgb.join(",")})`, text: lum > 0.5 ? "#1a2733" : "#ffffff" };
}

function drawRiderTable(ctx, x, y, w, h, o) {
  panel(ctx, x, y, w, h, "Ryttere (W/kg)");
  const cols = [
    { label: "ZRS", w: 72, heat: true, get: (r) => r.zrs, fmt: (v) => String(v) },
    { label: "Kat", w: 50, text: (r) => r.category || "-" },
    ...DURATIONS.map((d) => ({ label: d.label, w: 92, heat: true, get: (r) => r.wkg[d.seconds], fmt: (v) => v.toFixed(2) })),
    { label: "Form", w: 70, text: (r) => (typeof r.form === "number" ? `${r.form}%` : "-") },
  ];
  const nameW = 210;
  const left = x + 22;
  const colX = [];
  cols.reduce((cx, c) => (colX.push(cx), cx + c.w), left + nameW);

  // Heat range per column over both teams, so the colours compare riders across the whole match.
  const all = [...o.us.riders, ...o.them.riders];
  const ranges = cols.map((c) => {
    if (!c.heat) return null;
    const vals = all.map(c.get).filter((v) => typeof v === "number" && v > 0);
    return vals.length >= 2 && Math.max(...vals) > Math.min(...vals) ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  });

  let ty = y + 64;
  ctx.fillStyle = C.muted;
  ctx.font = `15px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("Navn", left, ty + 22);
  ctx.textAlign = "center";
  cols.forEach((c, i) => ctx.fillText(c.label, colX[i] + c.w / 2, ty + 22));
  ty += TABLE_HEAD_H;

  [[o.us, o.usColor], [o.them, o.themColor]].forEach(([team, color]) => {
    ctx.fillStyle = color;
    ctx.fillRect(left, ty + 8, 6, TABLE_TEAM_H - 14);
    ctx.font = `bold 22px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(team.name, left + 16, ty + 29);
    ty += TABLE_TEAM_H;

    sortedRiders(team).forEach((rider, ri) => {
      if (ri % 2 === 1) {
        ctx.fillStyle = "rgba(255,255,255,0.03)";
        ctx.fillRect(left, ty, w - 44, TABLE_ROW_H);
      }
      const hasData = DURATIONS.some((d) => typeof rider.wkg[d.seconds] === "number");
      let fontSize = 18;
      ctx.font = `${fontSize}px ${FONT}`;
      const name = cleanName(rider.name);
      while (fontSize > 13 && ctx.measureText(name).width > nameW - 12) {
        fontSize -= 1;
        ctx.font = `${fontSize}px ${FONT}`;
      }
      ctx.fillStyle = hasData ? C.text : C.muted;
      ctx.textAlign = "left";
      ctx.fillText(name, left + 6, ty + 23);

      cols.forEach((c, i) => {
        const cx = colX[i];
        ctx.textAlign = "center";
        if (!c.heat) {
          ctx.fillStyle = C.muted;
          ctx.font = `16px ${FONT}`;
          ctx.fillText(c.text(rider), cx + c.w / 2, ty + 23);
          return;
        }
        const v = c.get(rider);
        if (typeof v !== "number" || v <= 0) {
          ctx.fillStyle = C.muted;
          ctx.font = `16px ${FONT}`;
          ctx.fillText("-", cx + c.w / 2, ty + 23);
          return;
        }
        const range = ranges[i];
        const scheme = range ? heatColor((v - range.min) / (range.max - range.min)) : { fill: "#3a3d46", text: C.text };
        ctx.fillStyle = scheme.fill;
        ctx.beginPath();
        ctx.roundRect(cx + 2, ty + 2, c.w - 4, TABLE_ROW_H - 4, 5);
        ctx.fill();
        ctx.fillStyle = scheme.text;
        ctx.font = `bold 16px ${FONT}`;
        ctx.fillText(c.fmt(v), cx + c.w / 2, ty + 23);
      });
      ty += TABLE_ROW_H;
    });
  });
}

function formatStart(iso) {
  return new Date(iso).toLocaleString("da-DK", {
    timeZone: "Europe/Copenhagen",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function drawHeader(ctx, fixture, o, info) {
  ctx.textAlign = "left";
  let size = 46;
  const sep = "  mod  ";
  let usW, sepW, themW;
  const measure = () => {
    ctx.font = `bold ${size}px ${FONT}`;
    usW = ctx.measureText(o.us.name).width;
    themW = ctx.measureText(o.them.name).width;
    ctx.font = `${size}px ${FONT}`;
    sepW = ctx.measureText(sep).width;
  };
  measure();
  const maxW = WIDTH - 2 * PAD - 150;
  while (usW + sepW + themW > maxW && size > 26) {
    size -= 2;
    measure();
  }
  const baseY = 62;
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.fillStyle = o.usColor;
  ctx.fillText(o.us.name, PAD, baseY);
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(sep, PAD + usW, baseY);
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.fillStyle = o.themColor;
  ctx.fillText(o.them.name, PAD + usW + sepW, baseY);

  const parts = [];
  if (fixture.route) parts.push(fixture.world ? `${fixture.route} (${fixture.world})` : fixture.route);
  if (fixture.laps && !fixture.distance) parts.push(`${fixture.laps} omgange`);
  if (info) parts.push(`${info.distKm.toFixed(1)} km`, `${Math.round(info.elevM)} hm`, info.kind);
  else if (fixture.distance) parts.push(`${(fixture.distance / 1000).toFixed(1)} km`);
  ctx.font = `24px ${FONT}`;
  ctx.fillStyle = C.text;
  ctx.fillText(fixture.scout ? `${o.us.riders.length} mod ${o.them.riders.length} ryttere i truppen` : parts.length ? parts.join("  |  ") : "Rute ikke oplyst", PAD, 108);
  ctx.fillStyle = C.muted;
  ctx.fillText(fixture.start ? formatStart(fixture.start) : "", PAD, 142);
}

// Renders the W/kg comparison for a fixture (see ladderParser.js) as a PNG buffer. ourTeam is the team drawn first.
// info is the optional site-profile summary ({ distKm, elevM, kind }); the route itself is a separate image.
function buildLadderChart(fixture, ourTeam, info = null) {
  const o = orient(fixture, ourTeam);
  const headerH = 170, barsH = 400, diffH = 110 + DURATIONS.length * 52, ridersH = riderTableHeight(o);
  const height = headerH + barsH + diffH + ridersH + PAD * 4;
  const canvas = canvasModule().createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, WIDTH, height);
  drawHeader(ctx, fixture, o, info);

  let y = headerH;
  drawBars(ctx, PAD, y, WIDTH - 2 * PAD, barsH, o);
  y += barsH + PAD;
  drawDiff(ctx, PAD, y, WIDTH - 2 * PAD, diffH, o);
  y += diffH + PAD;
  drawRiderTable(ctx, PAD, y, WIDTH - 2 * PAD, ridersH, o);

  return canvas.toBuffer("image/png");
}

module.exports = { buildLadderChart, cleanName };
