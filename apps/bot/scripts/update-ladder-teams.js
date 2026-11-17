// Explicit maintenance command; the running bot never fetches or rewrites its team catalog.
const fs = require("node:fs/promises");
const path = require("node:path");
const axios = require("axios");
const { parseSummaryTeams } = require("../services/ladder/ladderParser");

const SUMMARY_URL = "https://ladder.cycleracing.club/summary";
const SNAPSHOT_PATH = path.join(__dirname, "../services/ladder/knownTeams.json");

async function fetchSummary() {
  const { data } = await axios.get(SUMMARY_URL, {
    timeout: 30000,
    responseType: "text",
    transformResponse: (body) => body,
  });
  return data;
}

async function updateKnownTeams({ load = fetchSummary, outputPath = SNAPSHOT_PATH, now = new Date() } = {}) {
  // Parse and validate everything before replacing the previous usable snapshot.
  const teams = parseSummaryTeams(await load()).map(({ id, name }) => ({ id, name }));
  const snapshot = { source: SUMMARY_URL, updatedAt: now.toISOString(), teams };
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, outputPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
  return snapshot;
}

if (require.main === module) {
  updateKnownTeams().then((snapshot) => {
    console.log(`Updated ${snapshot.teams.length} known Ladder teams from ${snapshot.source}. Review and commit knownTeams.json.`);
  }).catch((error) => {
    console.error(`Ladder team catalog was not updated: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { updateKnownTeams };
