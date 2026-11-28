const { classifyRider, extractRiderMetrics, hasOfficialZrlMetrics, loadZrlLimits, FALLBACK_LIMITS } = require("./zrlCategory");

const LADDER_EMOJI = {
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

function getLadder(rider) {
  for (const rank of [rider?.race?.max30, rider?.race?.max90]) {
    const { rating, mixed } = rank ?? {};
    if (!Number.isFinite(rating)) continue;
    const number = Number.isInteger(mixed?.number) ? mixed.number : null;
    const category = typeof mixed?.category === "string" ? mixed.category.trim() || null : null;
    const emoji = LADDER_EMOJI[category?.toLowerCase()];
    const rankLabel = [number, category].filter(value => value != null).join(" – ");
    const label = rankLabel ? `${rankLabel} (${rating.toFixed(0)})` : rating.toFixed(0);
    return { number, category, rating, label: emoji ? `${emoji} ${label}` : label };
  }
  return { number: null, category: null, rating: null, label: "Unranked" };
}

async function getRiderStatsCategories(rider) {
  const { race: liveRating, category: liveCategory } = rider.velo ?? {};
  const rating = Number.isFinite(liveRating) ? liveRating : null;
  const name = typeof liveCategory?.name === "string" ? liveCategory.name.trim() || null : null;
  const number = Number.isInteger(liveCategory?.number) ? liveCategory.number : null;
  const veloLabel = rating == null ? "Unavailable" : name ? `${name} (${rating.toFixed(0)})` : rating.toFixed(0);

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
    velo: { number, category: name, rating, label: veloLabel },
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
