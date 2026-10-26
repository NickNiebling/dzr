#!/usr/bin/env node
/**
 * Copy shared sources into the app trees that need their own copy.
 *
 * Why copying rather than importing: Render builds apps/bot with `rootDir: apps/bot` and Cloud
 * Run builds apps/api the same way, so neither can resolve `require("../../packages/...")` —
 * those files are simply not in the build context. The Next.js site has no such constraint and
 * imports packages/shared directly via the @/* alias.
 *
 * Run with --check to verify without writing (used by CI). This matters more than it looks:
 * render.yaml's buildFilter only triggers on apps/bot/**, so editing a shared source alone does
 * not even rebuild the bot, and the drift would otherwise be completely silent.
 *
 *   node scripts/sync-shared.js          # write the copies
 *   node scripts/sync-shared.js --check  # fail if any copy is stale
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

/** [source relative to repo root, ...destinations] */
const TARGETS = [
  ["packages/shared/telemetry/sentryPrivacy.js", "apps/bot/services/sentryPrivacy.js"],
  ["packages/shared/constants.json", "apps/bot/constants.json", "apps/api/constants.json"],
  // JS only goes to the bot. The Flask API cannot run it and a third copy is a third place to drift.
  ["packages/shared/coach/tokenCrypto.js", "apps/bot/services/tokenCrypto.js"],
  ["packages/shared/coach/coachProfile.js", "apps/bot/services/coachProfile.js"],
  ["packages/shared/coach/coachChatNotes.js", "apps/bot/services/coachChatNotes.js"],
  ["packages/shared/coach/membership.js", "apps/bot/services/membership.js"],
  ["packages/shared/coach/memberCalendar.js", "apps/bot/services/memberCalendar.js"],
  ["packages/shared/coach/coachHowItWorks.js", "apps/bot/services/coachHowItWorks.js"],
  ["packages/shared/phenotype.js", "apps/bot/utils/phenotype.js"],
  ["packages/shared/verificationCriteria.js", "apps/bot/services/verificationCriteria.js"],
];

const checkOnly = process.argv.includes("--check");
let stale = 0;
let written = 0;

for (const [source, ...destinations] of TARGETS) {
  const sourcePath = path.join(root, source);
  if (!fs.existsSync(sourcePath)) {
    console.error(`missing source: ${source}`);
    process.exitCode = 1;
    continue;
  }
  const contents = fs.readFileSync(sourcePath);

  for (const destination of destinations) {
    const destinationPath = path.join(root, destination);
    const current = fs.existsSync(destinationPath) ? fs.readFileSync(destinationPath) : null;
    if (current && current.equals(contents)) continue;

    if (checkOnly) {
      console.error(`drift: ${destination} does not match ${source}`);
      stale += 1;
    } else {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, contents);
      console.log(`synced ${source} -> ${destination}`);
      written += 1;
    }
  }
}

if (checkOnly) {
  if (stale > 0) {
    console.error(`\n${stale} file(s) out of sync. Run: npm run sync:shared`);
    process.exit(1);
  }
  console.log("all shared copies are in sync");
} else {
  console.log(written === 0 ? "already in sync" : `${written} file(s) synced`);
}
