import copy
from datetime import datetime, timedelta
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from member_snapshots import run_snapshot, collect_counts, local_day, scheduled_due, iso, SnapshotError


def at(value):
    return datetime.fromisoformat(value)


class Store:
    def __init__(self):
        self.state, self.snapshots = {}, {}
        self.role = 'club'
        self.fail_write = False

    def role_id(self):
        return self.role

    def atomic(self, update):
        result, changes, snapshot = update(copy.deepcopy(self.state))
        if snapshot is not None and self.fail_write:
            raise RuntimeError('database unavailable')
        if changes:
            self.state.update(changes)
        if snapshot is not None:
            self.snapshots[snapshot['dateKey']] = snapshot
        return result


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        self.now = at('2026-10-24T21:46:00+00:00')
        self.counts = {'memberCount': 725, 'clubMemberCount': 189, 'clubMemberRoleId': 'club', 'roleCounts': {'club': 189}}
        self.collect = Mock(return_value=self.counts)
        self.clock = lambda: self.now

    def run_job(self, source='scheduled'):
        return run_snapshot(self.store, source, self.collect, self.clock)

    def test_manual_does_not_suppress_scheduled_and_retries_are_idempotent(self):
        self.now = at('2026-10-24T10:00:00+00:00')
        self.assertEqual(self.run_job('manual')[1], 200)
        self.assertNotIn('lastScheduledSuccessDate', self.store.state)
        self.now = at('2026-10-24T21:46:00+00:00')
        self.assertEqual(self.run_job()[0]['status'], 'saved')
        self.assertEqual(self.run_job()[0]['reason'], 'already_saved')
        self.assertEqual(self.collect.call_count, 2)
        self.assertEqual(len(self.store.snapshots), 1)
        self.assertEqual(self.store.state['lastScheduledSuccessDate'], '2026-10-24')

    def test_failure_preserves_snapshot_retries_and_only_marks_success_after_commit(self):
        self.run_job('manual')
        previous = copy.deepcopy(self.store.snapshots)
        self.store.fail_write = True
        self.assertEqual(self.run_job()[0]['stage'], 'save')
        self.assertEqual(self.store.snapshots, previous)
        self.assertNotIn('lastScheduledSuccessDate', self.store.state)
        self.assertEqual(self.run_job()[0]['reason'], 'retry_later')
        self.store.fail_write = False
        self.now += timedelta(minutes=1)
        self.assertEqual(self.run_job()[0]['status'], 'saved')
        self.assertIsNone(self.store.state['lastError'])

    def test_missing_configuration_and_discord_failure_do_not_write_zero(self):
        self.store.role = ''
        self.assertEqual(self.run_job('manual')[0]['stage'], 'configuration')
        self.collect.assert_not_called()
        self.store.role = 'club'
        self.collect.side_effect = RuntimeError('Discord unavailable')
        self.assertEqual(self.run_job('manual')[0]['stage'], 'discord')
        self.assertEqual(self.store.snapshots, {})

    def test_overlapping_manual_run_and_expired_lease(self):
        self.store.state.update(leaseOwner='other', leaseUntil=iso(self.now + timedelta(minutes=1)))
        self.assertEqual(self.run_job('manual')[1], 409)
        self.collect.assert_not_called()
        self.now += timedelta(minutes=2)
        self.assertEqual(self.run_job('manual')[0]['status'], 'saved')

    def test_lease_loss_cannot_overwrite_newer_run(self):
        def collect(role):
            self.store.state.update(leaseOwner='new-owner')
            return self.counts
        self.collect.side_effect = collect
        self.assertEqual(self.run_job()[1], 409)
        self.assertEqual(self.store.snapshots, {})
        self.assertEqual(self.store.state['leaseOwner'], 'new-owner')

    def test_crossing_midnight_is_not_backdated(self):
        self.now = at('2026-10-24T21:59:50+00:00')
        def collect(role):
            self.now += timedelta(seconds=20)
            return self.counts
        self.collect.side_effect = collect
        self.assertEqual(self.run_job()[0]['stage'], 'date')
        self.assertEqual(self.store.snapshots, {})
        self.assertEqual(self.run_job()[0]['reason'], 'not_due')

    def test_timezone_dst_and_late_start(self):
        for before, due in [('2026-10-24T21:44:00+00:00', '2026-10-24T21:45:00+00:00'),
                            ('2026-10-25T22:44:00+00:00', '2026-10-25T22:45:00+00:00')]:
            self.assertFalse(scheduled_due(at(before)))
            self.assertTrue(scheduled_due(at(due)))
        self.assertEqual(local_day(at('2026-10-24T22:01:00+00:00')), '2026-10-25')
        self.assertTrue(scheduled_due(self.now))

    def test_retry_backoff_caps_at_five_minutes_and_manual_bypasses_backoff(self):
        self.collect.side_effect = RuntimeError('unavailable')
        for minutes in [1, 2, 4, 5, 5]:
            self.run_job()
            retry = at(self.store.state['nextRetryAt'])
            self.assertEqual(retry - self.now, timedelta(minutes=minutes))
            self.now = retry
        self.collect.side_effect = None
        self.assertEqual(self.run_job('manual')[0]['status'], 'saved')


class CollectionTests(unittest.TestCase):
    def fake_get(self, pages):
        def get(url, **kwargs):
            self.assertLessEqual(kwargs['timeout'], 15)
            if 'with_counts=true' in url:
                return Mock(raise_for_status=Mock(), json=lambda: {'approximate_presence_count': 42})
            value = pages.pop(0)
            if isinstance(value, Exception):
                raise value
            return Mock(raise_for_status=Mock(), json=lambda: value)
        return get

    def test_complete_pagination_and_true_zero(self):
        first = [{'user': {'id': str(i)}, 'roles': ['club']} for i in range(1000)]
        result = collect_counts('token', 'guild', 'club', self.fake_get([[{'id': 'club'}], first, [{'user': {'id': '1000'}, 'roles': []}]]))
        self.assertEqual(result['presenceCount'], 42)
        self.assertEqual(result['memberCount'], 1001)
        self.assertEqual(result['clubMemberCount'], 1000)
        zero = collect_counts('token', 'guild', 'club', self.fake_get([[{'id': 'club'}], [{'user': {'id': '1'}, 'roles': []}]]))
        self.assertEqual(zero['clubMemberCount'], 0)

    def test_failed_later_page_cannot_return_partial_counts(self):
        first = [{'user': {'id': str(i)}, 'roles': ['club']} for i in range(1000)]
        with self.assertRaises(RuntimeError):
            collect_counts('token', 'guild', 'club', self.fake_get([[{'id': 'club'}], first, RuntimeError('429')]))

    def test_invalid_roles_and_repeated_members_fail(self):
        for pages in [[[]], [[{'id': 'club'}], [{'user': {'id': '1'}, 'roles': None}]],
                      [[{'id': 'club'}], [{'user': {'id': '1'}, 'roles': []}] * 2]]:
            with self.assertRaises(SnapshotError):
                collect_counts('token', 'guild', 'club', self.fake_get(pages))


if __name__ == '__main__':
    import logging
    logging.disable(logging.CRITICAL)
    unittest.main()
