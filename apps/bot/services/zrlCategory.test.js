const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyRider, extractRiderMetrics, parseZrlKnowledge, FALLBACK_LIMITS } = require("./zrlCategory");

test("official zFTP and zMAP confirm Open B DEV", () => {
  const metrics = extractRiderMetrics({ weight: 70, zFTP: 245, zMAP: 301 });
  assert.deepEqual([metrics.ftpW, metrics.ftpWkg, metrics.ftpSource], [245, 3.5, "zFTP"]);
  assert.deepEqual([metrics.mapW, metrics.mapWkg, metrics.mapSource], [301, 4.3, "zMAP"]);

  const placement = classifyRider(metrics, FALLBACK_LIMITS);
  assert.equal(placement.primaryBand, "open");
  assert.equal(placement.open.category, "B");
  assert.equal(placement.open.developmentEligible, true);
});

test("Women’s category and DEV caps apply to the primary Women’s band", () => {
  const metrics = extractRiderMetrics({ gender: "female", weight: 60, zFTP: 240, zMAPWkg: 4.9 });
  const placement = classifyRider(metrics, FALLBACK_LIMITS);

  assert.equal(placement.primaryBand, "women");
  assert.equal(placement.women.category, "A");
  assert.equal(placement.women.developmentEligible, true);
  assert.equal(placement.open.category, "B");
  assert.equal(placement.open.developmentEligible, false);
});

test("an official metric at the DEV cap leaves the standard category", () => {
  const metrics = extractRiderMetrics({ weight: 70, zFTP: 245, zMAPWkg: 4.53 });
  const { open } = classifyRider(metrics, FALLBACK_LIMITS);

  assert.equal(open.category, "B");
  assert.equal(open.developmentEligible, false);
});

test("a 5-minute estimate cannot confirm DEV or drive the standard category", () => {
  const metrics = extractRiderMetrics({ weight: 75, zFTP: 266, power: { MAP: 320, w300: 405 } });
  const { open } = classifyRider(metrics, FALLBACK_LIMITS);

  assert.equal(metrics.mapSource, "5min_estimate");
  assert.equal(open.category, "B");
  assert.equal(open.estimatedCategory, "A");
  assert.equal(open.developmentEligible, null);
});

test("zpFTP cannot confirm DEV even when official zMAP is available", () => {
  const metrics = extractRiderMetrics({ weight: 70, zFTP: null, zpFTP: 245, power: { zMAP: 301 } });
  const { open } = classifyRider(metrics, FALLBACK_LIMITS);

  assert.equal(metrics.ftpSource, "zpFTP");
  assert.equal(metrics.mapSource, "zMAP");
  assert.equal(open.category, "B");
  assert.equal(open.developmentEligible, null);
});

test("empty, null and zero values leave power metrics missing", () => {
  const metrics = extractRiderMetrics({ weight: 70, zFTP: 0, zpFTP: null, zMAP: "", zMAPWkg: 0 });
  const placement = classifyRider(metrics, FALLBACK_LIMITS);

  assert.deepEqual([metrics.ftpW, metrics.ftpWkg, metrics.ftpSource], [null, null, "missing"]);
  assert.deepEqual([metrics.mapW, metrics.mapWkg, metrics.mapSource], [null, null, "missing"]);
  assert.equal(placement.open.developmentEligible, null);
  assert.equal(placement.women.developmentEligible, null);
});

test("partial knowledge limits cannot replace the standard ZRL rules", () => {
  const content = JSON.stringify({
    standard: { open_divisions: { A: { zFTP: ">=250 W and >=4.2 W/kg" } } },
  });

  assert.equal(parseZrlKnowledge(content), null);
});
