/**
 * The features the announcer can spotlight, read from the bot itself instead of a hand-kept list:
 * every member slash command and every club-assistant tool, with the description it already has
 * in code. A feature cannot ship without one, so the catalog is never out of date.
 *
 * Usage comes from assistant_dm_events (which tools answered members' DMs), so the spotlight can
 * favour features members rarely use. Commands have no usage count; the rotation covers them.
 *
 * Admins switch features off on /admin/announcer (system_settings/announcer.spotlightExcluded).
 */

/** Plumbing members never ask for by name, admin-only tools, and captain-only commands. */
const INTERNAL = new Set([
  "report_knowledge_gap",
  "ask_helper",
  "get_help_article",
  "my_onboarding_status",
  "club_overview",
  "whoami",
  "get_zwiftid",
  "set_zwiftid",
  "remove_selfrole",
  "roles_help",
  "verification_status",
  "my_team",
  "add_team_member",
  "remove_team_member",
]);

/** A tool that is the same feature as a slash command. */
const ALIASES = { start_quiz: "quiz" };

/**
 * @param {{ tools: object[], commands: object[], usage?: Record<string, number> }} input
 *   tools: OpenAI tool definitions ({ function: { name, description } });
 *   commands: slash command JSON ({ name, description, default_member_permissions });
 *   usage: tool name -> uses in the last 30 days.
 * @returns {Array<{ key, name, command, tool, description, howToUse, usedLast30Days, internal }>}
 */
function buildFeatureCatalog({ tools = [], commands = [], usage = {} }) {
  const byKey = new Map();
  const entry = (key) => {
    if (!byKey.has(key)) byKey.set(key, { key, name: key, command: null, tool: null, descriptions: [], usedLast30Days: null });
    return byKey.get(key);
  };
  for (const command of commands) {
    // Commands requiring Discord permissions (Administrator, Manage Messages, ...) are for staff.
    if (!command?.name || command.default_member_permissions != null) continue;
    const row = entry(command.name);
    row.command = `/${command.name}`;
    if (command.description) row.descriptions.push(command.description);
  }
  for (const definition of tools) {
    const name = definition?.function?.name;
    if (!name) continue;
    const row = entry(ALIASES[name] || name);
    row.tool = name;
    if (definition.function.description) row.descriptions.push(definition.function.description);
    if (usage[name] != null) row.usedLast30Days = (row.usedLast30Days || 0) + usage[name];
  }
  return [...byKey.values()]
    .map(({ descriptions, ...row }) => ({
      ...row,
      name: row.command || row.tool,
      description: descriptions.join(" ").slice(0, 900),
      howToUse: [
        row.command ? `Skriv ${row.command} på serveren.` : null,
        row.tool ? "Spørg botten i en DM eller @mention den i en kanal." : null,
      ].filter(Boolean).join(" "),
      internal: INTERNAL.has(row.key) || INTERNAL.has(row.tool),
      usedLast30Days: row.tool ? row.usedLast30Days || 0 : null,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Tool name -> uses, from assistant_dm_events docs ({ toolsUsed, test }). */
function countToolUsage(events) {
  const counts = {};
  for (const event of events) {
    if (event?.test) continue;
    for (const tool of event?.toolsUsed || []) counts[tool] = (counts[tool] || 0) + 1;
  }
  return counts;
}

module.exports = { buildFeatureCatalog, countToolUsage, INTERNAL };
