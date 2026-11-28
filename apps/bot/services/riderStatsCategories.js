const { classifyRider, extractRiderMetrics, hasOfficialZrlMetrics, loadZrlLimits, FALLBACK_LIMITS } = require("./zrlCategory");

const RATING_EMOJI = {
  diamond: "💎",
  ruby: "🔴",
  emerald: "🟢",
  sapphire: "🔵",
  amethyst: "🟣",
  gold: "🥇",
  silver: "🥈",
  bronze: "🥉",
  copper: "🟤",
};
const ZRL_EMOJI = { A: "🔴", B: "🟢", C: "🔵", D: "🟡" };

function summarizeRating(rating, categoryNumber, categoryName, missingLabel) {
  const number = Number.isInteger(categoryNumber) ? categoryNumber : null;
  const category = typeof categoryName === "string" ? categoryName.trim() || null : null;
  if (!Number.isFinite(rating)) return { number, category, rating: null, label: missingLabel };

  const emoji = RATING_EMOJI[category?.toLowerCase()];
  const rankLabel = [number, category].filter(value => value != null).join(" – ");
  const label = rankLabel ? `${rankLabel} (${rating.toFixed(0)})` : rating.toFixed(0);
  return { number, category, rating, label: emoji ? `${emoji} ${label}` : label };
}

function getLadder(rider) {
  const rank = [rider?.race?.max30, rider?.race?.max90].find(entry => Number.isFinite(entry?.rating));
  return summarizeRating(rank?.rating, rank?.mixed?.number, rank?.mixed?.category, "Unranked");
}

async function getRiderStatsCategories(rider) {
  const { race: liveRating, category: liveCategory } = rider.velo ?? {};

  const metrics = extractRiderMetrics(rider);
  const hasOfficialMetrics = hasOfficialZrlMetrics(metrics);
  const paceGroup = rider.zpCategory === "A+" ? "A" : rider.zpCategory;
  let category = /^[A-D]$/.test(paceGroup) ? paceGroup : null;
  let developmentEligible = null;

  if (hasOfficialMetrics) {
    const { limits } = await loadZrlLimits().catch(() => ({ limits: FALLBACK_LIMITS }));
    const placement = classifyRider(metrics, limits);
    ({ category, developmentEligible } = placement[placement.primaryBand]);
  }

  let label = "Unavailable";
  if (category) {
    label = `${ZRL_EMOJI[category]} ${category}`;
    if (developmentEligible === true) label += " DEV";
    if (!hasOfficialMetrics) label += " (ZwiftPower est.)";
  }

  return {
    ladder: getLadder(rider),
    velo: summarizeRating(liveRating, liveCategory?.number, liveCategory?.name, "Unavailable"),
    zrl: { category, developmentEligible, label },
    zFTP: {
      watts: metrics.ftpSource === "zFTP" ? metrics.ftpW : null,
      wkg: metrics.ftpSource === "zFTP" ? metrics.ftpWkg : null,
    },
    zMAP: {
      watts: metrics.mapSource === "zMAP" ? metrics.mapW : null,
      wkg: metrics.mapSource === "zMAP" ? metrics.mapWkg : null,
    },
  };
}

module.exports = { getLadder, getRiderStatsCategories };
