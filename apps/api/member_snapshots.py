"""One snapshot writer for scheduled and manual collection. No import-time credentials."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import logging
import time
import uuid

TZ = ZoneInfo('Europe/Copenhagen')
STATE_ID = 'member_counts_daily'
LEASE_SECONDS = 180


def utcnow():
    return datetime.now(timezone.utc)


def iso(now):
    return now.isoformat()


def local_day(now):
    return now.astimezone(TZ).date().isoformat()


def scheduled_due(now):
    local = now.astimezone(TZ)
    return (local.hour, local.minute) >= (23, 45)


class SnapshotError(Exception):
    def __init__(self, stage, message, status=502):
        super().__init__(message)
        self.stage, self.status = stage, status


class FirestoreSnapshotStore:
    def __init__(self, db):
        self.db = db
        self.ref = db.collection('bot_state').document(STATE_ID)

    def atomic(self, update):
        from firebase_admin import firestore

        @firestore.transactional
        def execute(transaction):
            state = self.ref.get(transaction=transaction).to_dict() or {}
            result, changes, snapshot = update(state)
            if snapshot is not None:
                # Replace the entire snapshot: roleCounts and clubMemberCount must agree.
                ref = self.db.collection('server_member_counts').document(snapshot['dateKey'])
                transaction.set(ref, snapshot)
            if changes is not None:
                transaction.set(self.ref, changes, merge=True)
            return result
        return execute(self.db.transaction())

    def role_id(self):
        settings = self.db.collection('system_settings').document('global').get().to_dict() or {}
        return str((settings.get('membership') or {}).get('clubMemberRoleId') or '').strip()


def collect_counts(token, guild_id, role_id, get=None):
    """Strict pagination: HTTP failures and incomplete pages never become counts."""
    if get is None:
        import requests
        get = requests.get
    if not token or not guild_id or not role_id:
        raise SnapshotError('configuration', 'Discord credentials, guild and club-member role must be configured.', 503)
    deadline = time.monotonic() + 90

    def fetch(path):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SnapshotError('discord', 'Discord collection exceeded its time limit.')
        response = get('https://discord.com/api/v10' + path,
                       headers={'Authorization': 'Bot ' + token}, timeout=min(15, remaining))
        response.raise_for_status()
        return response.json()

    roles = fetch(f'/guilds/{guild_id}/roles')
    if not isinstance(roles, list) or not any(r.get('id') == role_id for r in roles):
        raise SnapshotError('configuration', 'The configured club-member role does not exist in Discord.', 503)
    guild = fetch(f'/guilds/{guild_id}?with_counts=true')
    if not isinstance(guild, dict):
        raise SnapshotError('discord', 'Discord returned invalid guild data.')
    presence = guild.get('approximate_presence_count')
    seen, role_counts, after = set(), {role_id: 0}, '0'
    for _ in range(200):
        batch = fetch(f'/guilds/{guild_id}/members?limit=1000&after={after}')
        if not isinstance(batch, list):
            raise SnapshotError('discord', 'Discord returned an invalid member list.')
        for member in batch:
            member_id = (member.get('user') or {}).get('id')
            member_roles = member.get('roles')
            if not member_id or member_id in seen or not isinstance(member_roles, list):
                raise SnapshotError('discord', 'Discord returned incomplete or repeated member data.')
            seen.add(member_id)
            for role in set(member_roles):
                role_counts[role] = role_counts.get(role, 0) + 1
        if len(batch) < 1000:
            counts = {'memberCount': len(seen), 'clubMemberCount': role_counts[role_id],
                      'clubMemberRoleId': role_id, 'roleCounts': role_counts}
            if isinstance(presence, int) and not isinstance(presence, bool) and presence >= 0:
                counts['presenceCount'] = presence
            return counts
        after = batch[-1]['user']['id']
    raise SnapshotError('discord', 'Discord member pagination did not complete.')


def run_snapshot(store, source, collect, clock=utcnow):
    """Return (JSON body, HTTP status). Success marker and data commit atomically."""
    if source not in ('manual', 'scheduled'):
        return {'error': 'Invalid snapshot source', 'stage': 'request'}, 400
    now = clock()
    day, run_id = local_day(now), str(uuid.uuid4())
    stage = 'lock'
    claimed = False
    try:
        def claim(state):
            if source == 'scheduled':
                if not scheduled_due(now):
                    return ('not_due', None, None)
                if state.get('lastScheduledSuccessDate') == day:
                    return ('already_saved', None, None)
                if state.get('retryDate') == day and state.get('nextRetryAt', '') > iso(now):
                    return ('retry_later', None, None)
            if state.get('leaseUntil', '') > iso(now):
                return ('busy', None, None)
            return ('claimed', {'leaseOwner': run_id, 'leaseUntil': iso(now + timedelta(seconds=LEASE_SECONDS)),
                                'lastAttemptAt': iso(now), 'lastAttemptSource': source}, None)
        result = store.atomic(claim)
        if result != 'claimed':
            if result == 'busy':
                return {'error': 'Another snapshot is running. Try again shortly.', 'stage': 'lock', 'runId': run_id}, 409
            return {'status': 'skipped', 'reason': result}, 200
        claimed = True
        stage = 'configuration'
        role_id = store.role_id()
        if not role_id:
            raise SnapshotError(stage, 'Club-member role is not configured.', 503)
        stage = 'discord'
        counts = collect(role_id)
        completed = clock()
        if local_day(completed) != day:
            raise SnapshotError('date', 'Collection crossed midnight. No snapshot was backdated.', 409)
        snapshot = {**counts, 'dateKey': day, 'timestamp': iso(completed), 'estimated': False,
                    'source': source, 'runId': run_id}
        stage = 'save'

        def save(state):
            commit_time = clock()
            if local_day(commit_time) != day:
                raise SnapshotError('date', 'Saving crossed midnight. No snapshot was backdated.', 409)
            if state.get('leaseOwner') != run_id or state.get('leaseUntil', '') <= iso(commit_time):
                raise SnapshotError('lock', 'Snapshot lease expired. Please retry.', 409)
            changes = {'leaseOwner': None, 'leaseUntil': '', 'lastSuccessAt': iso(completed),
                       'lastSuccessSource': source, 'lastError': None}
            if source == 'scheduled':
                changes.update(lastScheduledSuccessDate=day, lastScheduledSuccessAt=iso(completed),
                               retryDate=day, failureCount=0, nextRetryAt='')
            return (None, changes, snapshot)
        store.atomic(save)
        return {'status': 'saved', **snapshot}, 200
    except Exception as exc:
        if isinstance(exc, SnapshotError):
            stage, message, status = exc.stage, str(exc), exc.status
        else:
            message, status = f'Snapshot failed during {stage}. Check server logs with the reference ID.', 502
        logging.exception('Member snapshot failed runId=%s stage=%s', run_id, stage)
        error = {'stage': stage, 'message': message, 'runId': run_id, 'at': iso(clock()), 'source': source}
        if claimed:
            try:
                def fail(state):
                    if state.get('leaseOwner') != run_id:
                        return (None, None, None)
                    changes = {'leaseOwner': None, 'leaseUntil': '', 'lastError': error}
                    if source == 'scheduled':
                        count = (state.get('failureCount', 0) if state.get('retryDate') == day else 0) + 1
                        delay = min(5, 2 ** min(count - 1, 3))
                        changes.update(retryDate=day, failureCount=count,
                                       nextRetryAt=iso(clock() + timedelta(minutes=delay)))
                    return (None, changes, None)
                store.atomic(fail)
            except Exception:
                logging.exception('Could not persist member snapshot failure runId=%s', run_id)
        return {'error': message, 'stage': stage, 'runId': run_id}, status
