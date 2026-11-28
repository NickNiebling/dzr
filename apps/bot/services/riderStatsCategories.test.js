const test = require("node:test");
const assert = require("node:assert/strict");
const { getLadder, getRiderStatsCategories } = require("./riderStatsCategories");

test("Ladder prefers the vELO1 Max30 to a higher Max90", () => {
  const rider = {
    race: {
      max30: { rating: 1867.6, mixed: { number: 3, category: "Emerald" } },
      max90: { rating: 2160, mixed: { number: 2, category: "Ruby" } },
    },
  };

  assert.deepEqual(getLadder(rider), {
    number: 3,
    category: "Emerald",
    rating: 1867.6,
    label: "🟢 3 – Emerald (1868)",
  });
});

test("Ladder falls back to vELO1 Max90 when the Max30 rating is missing", () => {
  const rider = {
    race: {
      max30: { rating: null, mixed: { number: 9, category: "Copper" } },
      max90: { rating: 1140, mixed: { number: 6, category: "Gold" } },
    },
  };

  assert.deepEqual(getLadder(rider), {
    number: 6,
    category: "Gold",
    rating: 1140,
    label: "🥇 6 – Gold (1140)",
  });
});

test("Ladder is Unranked without either vELO1 window rating", () => {
  const rider = {
    race: { current: { rating: 1868, mixed: { number: 3, category: "Emerald" } } },
    velo: { max30: { rating: 710, open: { number: 3, name: "Emerald" } } },
  };

  assert.deepEqual(getLadder(rider), {
    number: null,
    category: null,
    rating: null,
    label: "Unranked",
  });
});

test("Ladder keeps the Max30 rating when its category details are missing", () => {
  assert.deepEqual(getLadder({ race: { max30: { rating: 1868 }, max90: { rating: 2160 } } }), {
    number: null,
    category: null,
    rating: 1868,
    label: "1868",
  });
});

test("Rider Stats keeps the ZRL category provisional and excludes estimated metrics", async () => {
  const { zrl, zFTP, zMAP } = await getRiderStatsCategories({
    zpCategory: "B",
    zpFTP: 245,
    weight: 70,
    power: { w300: 301 },
  });

  assert.deepEqual(zrl, { category: "B", developmentEligible: null, label: "🟢 B (ZwiftPower est.)" });
  assert.deepEqual(zFTP, { watts: null, wkg: null });
  assert.deepEqual(zMAP, { watts: null, wkg: null });
});

test("Rider Stats formats live vELO with the API category number and its emoji", async () => {
  const { velo } = await getRiderStatsCategories({
    velo: { race: 712.6, category: { number: 3, name: "Emerald" }, max30: { race: 750 } },
  });
  assert.deepEqual(velo, { number: 3, category: "Emerald", rating: 712.6, label: "🟢 3 – Emerald (713)" });
});

test("Rider Stats leaves vELO2 blank when only a legacy rating exists", async () => {
  const { velo } = await getRiderStatsCategories({ race: { current: { rating: 1725 }, max30: { rating: 1868 } } });
  assert.deepEqual(velo, { number: null, category: null, rating: null, label: "" });
});
