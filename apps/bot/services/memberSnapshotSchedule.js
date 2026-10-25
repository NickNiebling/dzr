// The API owns persistence, retries and the shared lease (including manual runs).
function snapshotDue(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return Number(parts.hour) * 60 + Number(parts.minute) >= 23 * 60 + 45;
}

function createMemberSnapshotCheck(save, log = console) {
  let running = false;
  return async function check(now = new Date()) {
    if (running || !snapshotDue(now)) return;
    running = true;
    try {
      const result = await save();
      if (result.status === 'saved') log.log('Member snapshot saved:', result.dateKey, result.runId);
    } catch (error) {
      log.error('Member snapshot failed:', error.response?.data || error.message);
    } finally {
      running = false;
    }
  };
}

module.exports = { snapshotDue, createMemberSnapshotCheck };
