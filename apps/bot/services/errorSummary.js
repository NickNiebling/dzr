// Only code locations and counts leave the process. Never persist console arguments: they can
// contain Discord messages, coaching data, HTTP headers or entire upstream responses.
const MAX_SOURCES = 50;

function mergeSummaries(first, second) {
  if (!first && !second) return null;
  const groups = new Map();
  let total = 0;
  let omitted = 0;
  let firstAt;
  let lastAt;
  for (const summary of [first, second]) {
    if (!summary) continue;
    total += summary.total;
    omitted += summary.omitted;
    if (!firstAt || summary.firstAt < firstAt) firstAt = summary.firstAt;
    if (!lastAt || summary.lastAt > lastAt) lastAt = summary.lastAt;
    for (const { source, count } of summary.groups) {
      if (groups.has(source)) groups.set(source, groups.get(source) + count);
      else if (groups.size < MAX_SOURCES) groups.set(source, count);
      else omitted += count;
    }
  }
  return { total, firstAt, lastAt, groups: [...groups].map(([source, count]) => ({ source, count })), omitted };
}

function formatErrorSummary(summary) {
  const stamp = (iso) => `<t:${Math.floor(Date.parse(iso) / 1000)}:f>`;
  const lines = [
    `**Daglig fejlopsummering — DZR-botten**`,
    `${summary.total} fejllogninger siden seneste opsamling.`,
    `Første: ${stamp(summary.firstAt)} · Seneste: ${stamp(summary.lastAt)}`,
    "",
  ];
  let shown = 0;
  for (const { source, count } of [...summary.groups].sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))) {
    const line = `• ${count} × \`${source}\``;
    // Leave room for the overflow count and the explanation; Discord allows 2000 characters.
    if (lines.join("\n").length + line.length > 1550) break;
    lines.push(line);
    shown += count;
  }
  if (shown < summary.total) lines.push(`• ${summary.total - shown} øvrige fejllogninger`);
  lines.push("", "Placeringer er relative til apps/bot. Detaljer findes i Render-loggen; rå fejltekster deles ikke her.");
  return lines.join("\n");
}

module.exports = { MAX_SOURCES, mergeSummaries, formatErrorSummary };
