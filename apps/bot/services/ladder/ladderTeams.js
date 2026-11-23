// Ladder teams and their channels for optakt and match-day reminders.
const { createStore } = require("./ladderStore");

const MAX_TEAMS = 10;
const store = createStore("ladderTeams", () => ({}));

function key(teamName) {
  return teamName.trim().toLowerCase();
}

// Keep the stored Firestore field while exposing optaktMin to callers.
function toTeam({ previewMinutes, ...team }) {
  if (previewMinutes !== undefined) team.optaktMin = previewMinutes;
  return team;
}

// Accepts a plain team name or a ladder URL such as https://ladder.cycleracing.club/teamView/Chonky%20Chaser.
function parseTeamName(input) {
  const text = input.trim();
  const urlMatch = text.match(/^https?:\/\/[^/]+\/(?:teamView|matchlist\/fixtures)\/([^/?#]+)/i);
  if (urlMatch) {
    try {
      return decodeURIComponent(urlMatch[1]).trim();
    } catch {
      return urlMatch[1].trim();
    }
  }
  return text;
}

// Commands run in the linked channel default to this team.
// Returns false when the team is new and the team limit has been reached.
async function link(teamName, channelId, optaktMin) {
  const teams = await store.load();
  const teamKey = key(teamName);
  if (!teams[teamKey] && Object.keys(teams).length >= MAX_TEAMS) return false;
  const team = { ...teams[teamKey], name: teamName.trim() };
  if (channelId) {
    team.channelId = String(channelId);
    for (const other of Object.values(teams)) {
      if (other.channelId === team.channelId) delete other.channelId;
    }
  }
  if (optaktMin != null) team.previewMinutes = optaktMin;
  teams[teamKey] = team;
  store.persist();
  return true;
}

async function findByChannel(channelId) {
  const team = Object.values(await store.load()).find((team) => team.channelId === String(channelId));
  return team ? toTeam(team) : null;
}

async function unlink(teamName) {
  const teams = await store.load();
  const teamKey = key(teamName);
  const existed = teamKey in teams;
  delete teams[teamKey];
  store.persist();
  return existed;
}

async function list() {
  return Object.values(await store.load()).map(toTeam);
}

async function getTeam(teamName) {
  const team = (await store.load())[key(teamName)];
  return team ? toTeam(team) : null;
}

module.exports = { MAX_TEAMS, parseTeamName, link, unlink, list, getTeam, findByChannel };
