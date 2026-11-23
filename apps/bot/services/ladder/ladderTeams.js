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
async function link(teamName, channelId, optaktMin, canManage = false) {
  const teams = await store.load();
  const teamKey = key(teamName);
  const existing = teams[teamKey];
  const linkedChannelId = channelId ? String(channelId) : existing?.channelId;

  if (existing && !canManage) {
    if (linkedChannelId !== existing.channelId || (optaktMin != null && optaktMin !== existing.previewMinutes)) {
      return { error: "admin_required" };
    }
    return { team: toTeam(existing) };
  }
  if (!existing && Object.keys(teams).length >= MAX_TEAMS) return { error: "team_limit" };

  const team = { ...existing, name: teamName.trim() };
  if (channelId) {
    team.channelId = linkedChannelId;
    for (const other of Object.values(teams)) {
      if (other !== existing && other.channelId === linkedChannelId) {
        if (!canManage) return { error: "channel_taken" };
        delete other.channelId;
      }
    }
  }
  if (optaktMin != null) team.previewMinutes = optaktMin;
  teams[teamKey] = team;
  store.persist();
  return { team: toTeam(team) };
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
