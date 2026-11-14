// Ladder teams and their primary channels for previews, reminders and command defaults.
const { createStore } = require("./ladderStore");

const MAX_TEAMS = 10;
const store = createStore("ladderTeams", () => ({}));

async function load() {
  return store.load();
}

function key(teamName) {
  return teamName.trim().toLowerCase();
}

// Each team must have one primary channel. Refuse to take another team's channel away.
// Returns false when the team is new and the team limit has been reached.
async function link(teamName, channelId) {
  if (!teamName.trim() || !String(channelId || "").trim()) {
    const error = new Error("A team name and primary channel are required");
    error.userMessage = "Kør /ladder_link i holdets primære kanal og angiv et holdnavn eller hold-link.";
    throw error;
  }
  const teams = await load();
  if (!teams[key(teamName)] && Object.keys(teams).length >= MAX_TEAMS) return false;
  const other = Object.values(teams).find((team) => team.channelId === String(channelId) && key(team.name) !== key(teamName));
  if (other) {
    const error = new Error("Primary channel already belongs to another team");
    error.userMessage = `Denne kanal er allerede primær kanal for ${other.name}. Kør /ladder_link i det nye holds egen kanal, eller fjern først det eksisterende link med remove.`;
    throw error;
  }
  teams[key(teamName)] = { ...teams[key(teamName)], name: teamName.trim(), channelId: String(channelId) };
  await store.persist();
  return true;
}

async function findByChannel(channelId) {
  return Object.values(await load()).find((team) => team.channelId === String(channelId)) || null;
}

// Returns false when the team is not linked yet.
async function setPreviewMinutes(teamName, minutes) {
  const teams = await load();
  if (!teams[key(teamName)]) return false;
  teams[key(teamName)].previewMinutes = minutes;
  store.persist();
  return true;
}

async function unlink(teamName) {
  const teams = await load();
  const existed = key(teamName) in teams;
  delete teams[key(teamName)];
  store.persist();
  return existed;
}

async function list() {
  return Object.values(await load());
}

async function getTeam(teamName) {
  return (await load())[key(teamName)] || null;
}

module.exports = { MAX_TEAMS, link, unlink, list, getTeam, findByChannel, setPreviewMinutes };
