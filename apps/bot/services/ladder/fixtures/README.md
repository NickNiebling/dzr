The roster fixtures are anonymised projections of authenticated Ladder pages inspected on
2026-11-13, after the existing backend login flow proved access to `/team/n/82`.

Verification covered the complete current roster on DZR team 82 (11 members) and opponent
team 102 (10 members). On both pages, `#pane-roster` contained one `.newPowerTable`, with
exactly the same profile ids as the embedded `Ladder.roster` array. Every entry's
`LadderTeam` matched the team id. All 21 profile pages linked explicitly to a ZwiftPower
`profile.php?z=...` URL whose numeric id matched that profile. No fixture signups were used.

Both complete rosters arrived in the initial HTML. Inspection found no pagination,
load-more requests, or separate former-member section inside the roster tab. Other tabs,
captains, commented-out mobile cards and match history are excluded from membership.
Unexpected pagination or lazy loading is rejected until that format can be verified;
these fixtures do not claim a paginated live format was observed.

Names, team ids, profile ids, athlete UUIDs and power values are synthetic. The fixtures
retain the observed tab/table/row/link shapes and 90-day power-cell attributes, with
irrelevant columns, scripts and personal data removed. Expected counts are also recorded
in `roster-counts.json`. The external-link fixture preserves only verified link shapes.
