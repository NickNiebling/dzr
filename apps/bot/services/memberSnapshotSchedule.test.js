const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotDue, createMemberSnapshotCheck } = require('./memberSnapshotSchedule');

test('23:45 Copenhagen respects DST, late starts, and stops at midnight', () => {
  for (const [date, due] of [
    ['2026-10-24T21:44:00Z', false], ['2026-10-24T21:45:00Z', true],
    ['2026-10-24T21:58:00Z', true], ['2026-10-24T22:00:00Z', false],
    ['2026-10-25T21:45:00Z', false], ['2026-10-25T22:45:00Z', true],
    ['2026-10-25T23:00:00Z', false],
  ]) assert.equal(snapshotDue(new Date(date)), due, date);
});

test('overlapping ticks do not duplicate calls; failures allow later attempts', async () => {
  let calls = 0;
  let release;
  const now = new Date('2026-10-24T21:45:00Z');
  const check = createMemberSnapshotCheck(async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    throw new Error('timeout');
  }, { error() {}, log() {} });
  const first = check(now);
  await check(now);
  assert.equal(calls, 1);
  release();
  await first;
  const second = check(now);
  assert.equal(calls, 2);
  release();
  await second;
});
