#!/usr/bin/env node
/**
 * Fail the site job on high or critical production advisories.
 *
 * npm audit itself exits non-zero for moderate findings too, and its suggested
 * fix for the unpatched picomatch advisory is to downgrade @sentry/nextjs to 8.
 */
const { execFileSync } = require("node:child_process");

const ALLOWED = new Set([
  // picomatch <=4.0.7, and 4.0.7 is still the latest release. Sentry's
  // build-time rollup plugins depend on it. There is no patched version.
  "GHSA-fc5q-39xc-vjpf",
]);

function auditReport() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    return JSON.parse(
      execFileSync(npm, ["audit", "--omit=dev", "--json"], {
        encoding: "utf8",
        shell: process.platform === "win32",
      }),
    );
  } catch (error) {
    const stdout = error.stdout ? error.stdout.toString() : "";
    if (!stdout) throw error;
    return JSON.parse(stdout);
  }
}

const report = auditReport();
const blocking = [];
for (const info of Object.values(report.vulnerabilities || {})) {
  for (const via of info.via || []) {
    if (!via || typeof via !== "object") continue;
    if (via.severity !== "high" && via.severity !== "critical") continue;
    const id = String(via.url || "").split("/").pop();
    if (ALLOWED.has(id)) continue;
    blocking.push(`${via.severity} ${via.name}: ${via.title} (${id})`);
  }
}

if (blocking.length) {
  console.error(blocking.join("\n"));
  process.exit(1);
}

console.log("No unwaived high or critical production advisories.");
