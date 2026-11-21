const axios = require("axios");
const { getAllBotKnowledge } = require("./firebase");

const CATEGORY_RANK = { D: 0, C: 1, B: 2, A: 3 };
const CATEGORIES_HIGH_TO_LOW = ["A", "B", "C", "D"];

const FALLBACK_LIMITS = {
  season: "2026/27",
  open: {
    A: { ftpW: 250, ftpWkg: 4.2, mapWkg: 5.1 },
    B: { ftpW: 200, ftpWkg: 3.36, mapWkg: 4.1 },
    C: { ftpW: 150, ftpWkg: 2.63, mapWkg: 3.2 },
  },
  women: {
    A: { ftpWkg: 3.88, mapWkg: 4.8 },
    B: { ftpWkg: 3.36, mapWkg: 4.1 },
    C: { ftpWkg: 2.63, mapWkg: 3.2 },
  },
  development: {
    open: {
      A: { ftpWkgMax: 4.37, mapWkgMax: 5.33, ftpWMin: 250 },
      B: { ftpWkgMax: 3.74, mapWkgMax: 4.53, ftpWMin: 200 },
      C: { ftpWkgMax: 3.08, mapWkgMax: 3.68, ftpWMin: 150 },
      D: { ftpWkgMax: 2.4, mapWkgMax: 2.83 },
    },
    women: {
      A: { ftpWkgMax: 4.36, mapWkgMax: 5.29 },
      B: { ftpWkgMax: 3.74, mapWkgMax: 4.53 },
      C: { ftpWkgMax: 3.08, mapWkgMax: 3.68 },
      D: { ftpWkgMax: 2.4, mapWkgMax: 2.83 },
    },
  },
};

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 2) {
  if (value == null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function higherCategory(a, b) {
  if (!a) return b || "D";
  if (!b) return a;
  return CATEGORY_RANK[a] >= CATEGORY_RANK[b] ? a : b;
}

function parseBound(str) {
  const s = String(str || "");
  const out = {};
  const minWkg = s.match(/>=\s*([\d.]+)\s*w\s*\/\s*kg/i);
  const maxWkg = s.match(/<\s*([\d.]+)\s*w\s*\/\s*kg/i);
  const minW = s.match(/>=\s*([\d.]+)\s*W(?!\s*\/)/i);
  const maxW = s.match(/<\s*([\d.]+)\s*W(?!\s*\/)/i);
  if (minWkg) out.minWkg = Number(minWkg[1]);
  if (maxWkg) out.maxWkg = Number(maxWkg[1]);
  if (minW) out.minW = Number(minW[1]);
  if (maxW) out.maxW = Number(maxW[1]);
  return out;
}

function parseCategoryFields(cat) {
  const ftp = {};
  const map = {};
  for (const [key, value] of Object.entries(cat || {})) {
    const bound = parseBound(value);
    if (String(key).toLowerCase().includes("map")) {
      Object.assign(map, bound);
    } else {
      Object.assign(ftp, bound);
    }
  }
  return { ftp, map };
}

function extractJsonObject(content) {
  if (!content) return null;
  const text = String(content).trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function parseZrlKnowledge(content) {
  const json = extractJsonObject(content);
  if (!json) return null;
  const root = json.zwift_racing_league_limits_2026_27 || json;
  if (!root.standard && !root.open_divisions) return null;

  const standard = root.standard || {};
  const development = root.development || {};
  const openStd = standard.open_divisions || {};
  const womenStd = standard.womens_divisions || standard.women_divisions || {};
  const openDev = development.open_divisions || {};
  const womenDev = development.womens_divisions || development.women_divisions || {};

  const openA = parseCategoryFields(openStd.A);
  const openB = parseCategoryFields(openStd.B);
  const openC = parseCategoryFields(openStd.C);
  const openD = parseCategoryFields(openStd.D);
  const womenA = parseCategoryFields(womenStd.A);
  const womenC = parseCategoryFields(womenStd.C);
  const womenD = parseCategoryFields(womenStd.D);

  if (!openA.ftp.minW || !openA.ftp.minWkg) return null;

  const parsed = {
    season: "2026/27",
    open: {
      A: {
        ftpW: openA.ftp.minW,
        ftpWkg: openA.ftp.minWkg,
        mapWkg: openA.map.minWkg,
      },
      B: {
        ftpW: openB.ftp.minW,
        ftpWkg: openC.ftp.maxWkg,
        mapWkg: openC.map.maxWkg,
      },
      C: {
        ftpW: openC.ftp.minW,
        ftpWkg: openD.ftp.maxWkg,
        mapWkg: openD.map.maxWkg,
      },
    },
    women: {
      A: { ftpWkg: womenA.ftp.minWkg, mapWkg: womenA.map.minWkg },
      B: { ftpWkg: womenC.ftp.maxWkg, mapWkg: womenC.map.maxWkg },
      C: { ftpWkg: womenD.ftp.maxWkg, mapWkg: womenD.map.maxWkg },
    },
    development: { open: {}, women: {} },
  };

  for (const letter of CATEGORIES_HIGH_TO_LOW) {
    const openFields = parseCategoryFields(openDev[`${letter}_DEV`] || openDev[letter]);
    const womenFields = parseCategoryFields(womenDev[`${letter}_DEV`] || womenDev[letter]);
    parsed.development.open[letter] = {
      ftpWkgMax: openFields.ftp.maxWkg,
      mapWkgMax: openFields.map.maxWkg,
      ftpWMin: openFields.ftp.minW,
    };
    parsed.development.women[letter] = {
      ftpWkgMax: womenFields.ftp.maxWkg,
      mapWkgMax: womenFields.map.maxWkg,
    };
  }

  return parsed;
}

function isZrlKnowledgeEntry(entry) {
  const key = String(entry?.key || entry?.id || "").toLowerCase();
  const title = String(entry?.title || "").toLowerCase();
  const tags = Array.isArray(entry?.tags) ? entry.tags.map((t) => String(t).toLowerCase()) : [];
  return (
    key.includes("zrl") ||
    title.includes("zwift racing league") ||
    title.includes("zrl") ||
    tags.some((t) => t.includes("zrl") || t.includes("zwift racing league"))
  );
}

async function loadZrlLimits() {
  const all = await getAllBotKnowledge();
  const entry = (all || []).find(isZrlKnowledgeEntry) || null;
  const parsed = entry ? parseZrlKnowledge(entry.content) : null;
  return {
    limits: parsed || FALLBACK_LIMITS,
    source: parsed ? (entry.key || entry.id) : "fallback",
    title: entry?.title || "ZRL category limits",
    usedFallback: !parsed,
  };
}

function categoryFromMetric(value, thresholds) {
  if (value == null) return null;
  if (value >= thresholds.A) return "A";
  if (value >= thresholds.B) return "B";
  if (value >= thresholds.C) return "C";
  return "D";
}

function dropCategory(category) {
  if (category === "A") return "B";
  if (category === "B") return "C";
  if (category === "C") return "D";
  return "D";
}

function applyWattFloor(wkgCategory, ftpW, mins) {
  const floors = {
    A: mins.A.ftpW,
    B: mins.B.ftpW,
    C: mins.C.ftpW,
    D: 0,
  };
  let category = wkgCategory || "D";
  while (category !== "D" && floors[category] != null && (ftpW == null || ftpW < floors[category])) {
    category = dropCategory(category);
  }
  return category;
}

function classifyBand(metrics, mins, useWatts) {
  const fromFtpWkg = categoryFromMetric(metrics.ftpWkg, {
    A: mins.A.ftpWkg,
    B: mins.B.ftpWkg,
    C: mins.C.ftpWkg,
  });
  const fromMap = categoryFromMetric(metrics.mapWkg, {
    A: mins.A.mapWkg,
    B: mins.B.mapWkg,
    C: mins.C.mapWkg,
  });
  const fromWkg = higherCategory(fromFtpWkg, fromMap);
  const category = useWatts ? applyWattFloor(fromWkg, metrics.ftpW, mins) : fromWkg;

  return {
    category,
    fromFtpWkg,
    fromFtpW: useWatts
      ? categoryFromMetric(metrics.ftpW, {
          A: mins.A.ftpW,
          B: mins.B.ftpW,
          C: mins.C.ftpW,
        })
      : null,
    fromMap,
  };
}

function developmentEligible(category, metrics, devLimits) {
  const cap = devLimits?.[category];
  if (!cap || cap.ftpWkgMax == null) return false;
  if (metrics.ftpWkg == null || metrics.ftpWkg >= cap.ftpWkgMax) return false;
  if (cap.ftpWMin != null && (metrics.ftpW == null || metrics.ftpW < cap.ftpWMin)) return false;
  if (metrics.mapWkg != null && cap.mapWkgMax != null && metrics.mapWkg >= cap.mapWkgMax) return false;
  return true;
}

function canRaceDivisions(category) {
  const rank = CATEGORY_RANK[category] ?? 0;
  return CATEGORIES_HIGH_TO_LOW.filter((letter) => CATEGORY_RANK[letter] >= rank);
}

function isFemaleGender(gender) {
  const g = String(gender || "").toLowerCase();
  return g === "f" || g === "w" || g === "female" || g === "woman" || g === "women";
}

function extractRiderMetrics(rider) {
  const ftpW = toNumber(rider?.zFTP ?? rider?.zpFTP);
  const weight = toNumber(rider?.weight);
  const ftpWkg = ftpW != null && weight ? ftpW / weight : null;
  const officialMapW = toNumber(rider?.zMAP ?? rider?.power?.zMAP ?? rider?.power?.MAP);
  const officialMapWkg = officialMapW != null && weight ? officialMapW / weight : toNumber(rider?.zMAPWkg);
  const estimatedMapW = toNumber(rider?.power?.w300);
  const estimatedMapWkg = toNumber(rider?.power?.wkg300) ?? (estimatedMapW != null && weight ? estimatedMapW / weight : null);

  const mapIsOfficial = officialMapWkg != null;
  return {
    name: rider?.name || null,
    zwiftId: rider?.riderId ?? rider?.zwiftId ?? null,
    gender: rider?.gender || rider?.sex || null,
    weight: round(weight),
    ftpW: round(ftpW, 0),
    ftpWkg: round(ftpWkg),
    mapW: round(mapIsOfficial ? officialMapW : estimatedMapW, 0),
    mapWkg: round(mapIsOfficial ? officialMapWkg : estimatedMapWkg),
    mapSource: mapIsOfficial ? "zMAP" : estimatedMapWkg != null ? "5min_estimate" : "missing",
    zpCategory: rider?.zpCategory || null,
  };
}

function classifyRider(metrics, limits) {
  const officialMapMetrics = {
    ...metrics,
    mapWkg: metrics.mapSource === "zMAP" ? metrics.mapWkg : null,
  };
  const open = classifyBand(officialMapMetrics, limits.open, true);
  const women = classifyBand(officialMapMetrics, limits.women, false);
  const openWithEstimate = classifyBand(metrics, limits.open, true);
  const womenWithEstimate = classifyBand(metrics, limits.women, false);
  const female = isFemaleGender(metrics.gender);

  const openDev = developmentEligible(open.category, officialMapMetrics, limits.development.open);
  const womenDev = developmentEligible(women.category, officialMapMetrics, limits.development.women);

  return {
    primaryBand: female ? "women" : "open",
    open: {
      category: open.category,
      estimatedCategory: openWithEstimate.category,
      developmentEligible: openDev,
      canRace: canRaceDivisions(open.category),
      drivers: {
        zFTP_W: open.fromFtpW,
        zFTP_Wkg: open.fromFtpWkg,
        zMAP_Wkg: open.fromMap,
      },
    },
    women: {
      category: women.category,
      estimatedCategory: womenWithEstimate.category,
      developmentEligible: womenDev,
      canRace: canRaceDivisions(women.category),
      drivers: {
        zFTP_Wkg: women.fromFtpWkg,
        zMAP_Wkg: women.fromMap,
      },
    },
  };
}

function buildSummary(metrics, placement) {
  const band = placement.primaryBand === "women" ? placement.women : placement.open;
  const other = placement.primaryBand === "women" ? placement.open : placement.women;
  const bandLabel = placement.primaryBand === "women" ? "Women's" : "Open";
  const name = metrics.name || "Rytteren";
  const ftp = `${metrics.ftpW ?? "?"} W / ${metrics.ftpWkg ?? "?"} W/kg`;
  const mapLabel = metrics.mapSource === "zMAP" ? "zMAP" : "5-min (zMAP-estimat)";
  const map = metrics.mapWkg != null ? `${metrics.mapW ?? "?"} W / ${metrics.mapWkg} W/kg` : "ukendt";
  const dev = band.developmentEligible ? "ja" : "nej";
  const raceUp = band.canRace.join("/");
  const zp = metrics.zpCategory
    ? metrics.zpCategory === band.category
      ? ` Matcher ZwiftRacing pace group ${metrics.zpCategory}.`
      : ` ZwiftRacing pace group viser ${metrics.zpCategory} (kan afvige hvis zpFTP ikke er officielt zFTP).`
    : "";
  const showOtherBand = isFemaleGender(metrics.gender) || !metrics.gender;
  const alt = !showOtherBand
    ? ""
    : placement.primaryBand === "open"
      ? ` Women's ville være ${other.category}.`
      : ` Open ville være ${other.category}.`;
  const mapCaveat =
    metrics.mapSource === "5min_estimate" && band.estimatedCategory && band.estimatedCategory !== band.category
      ? ` Officiel zMAP mangler; 5-min estimat kunne løfte til ${band.estimatedCategory}.`
      : "";

  return (
    `${name}: ${bandLabel} ${band.category} (zFTP ${ftp}, ${mapLabel} ${map}). ` +
    `Kan køre ${raceUp}. Development ${band.category}: ${dev}.` +
    alt +
    mapCaveat +
    zp
  );
}

async function fetchRiderByZwiftId(zwiftId) {
  const response = await axios.get(`https://www.dzrracingseries.com/api/zr/rider/${zwiftId}`);
  return response.data;
}

async function lookupZrlCategory({ zwiftId }) {
  const [rider, limitInfo] = await Promise.all([
    fetchRiderByZwiftId(zwiftId),
    loadZrlLimits(),
  ]);

  if (!rider || !rider.name) {
    return {
      success: false,
      message: `No rider data found for ZwiftID ${zwiftId}.`,
    };
  }

  const metrics = extractRiderMetrics(rider);
  if (metrics.ftpW == null || metrics.ftpWkg == null) {
    return {
      success: false,
      message: `Found ${rider.name}, but zFTP/weight is missing so ZRL category cannot be calculated.`,
      metrics,
    };
  }

  const placement = classifyRider(metrics, limitInfo.limits);
  const summary = buildSummary(metrics, placement);

  return {
    success: true,
    summary,
    zrl: {
      season: limitInfo.limits.season,
      source: limitInfo.source,
      usedFallbackLimits: limitInfo.usedFallback,
      metrics,
      placement,
      notes: [
        "ZRL uses Zwift pace groups from zFTP and zMAP at the start line. This is an estimate from current rider data.",
        metrics.mapSource === "5min_estimate"
          ? "Official zMAP was not in the rider payload, so 5-minute power is used as an estimate. zMAP can still move the rider up a category."
          : null,
        "Open category is set by the higher of zFTP W/kg and zMAP W/kg, then limited by the zFTP watt floor. Watts alone do not promote a rider.",
        "A rider may race their own category or any higher standard division. Development is only for riders under that category's DEV caps.",
      ].filter(Boolean),
    },
  };
}

module.exports = {
  FALLBACK_LIMITS,
  parseZrlKnowledge,
  classifyRider,
  extractRiderMetrics,
  lookupZrlCategory,
  loadZrlLimits,
};
