// Member snapshots use Copenhagen calendar dates. Chart helpers operate on date
// keys via UTC, so supply that local date without changing activity chart clocks.
export function memberSnapshotClock(now = new Date()): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(({ type, value }) => [type, value]))
  return new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`)
}
