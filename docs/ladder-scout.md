# Ladder scout

`/ladder_scout team:<DZR team> opponent:<team name or team link>` compares the complete current squads in a private Discord reply. Both fields are required. The `team` list is the existing `/ladder_link` list. Select a concrete autocomplete result for ambiguous opponent names. No fixture, route, starting lineup or AI tactics is involved.

Supported links on `ladder.cycleracing.club` are `/team/n/{id}`, `/teamView/{name}` and `/matchlist/fixtures/{name}`. Numeric links always validate the actual team page, including teams absent from `/summary`. The search directory merges the summary's `defaultLadderData` and `playonTeams` JSON arrays and deduplicates team ids. It lives in memory for 15 minutes. Startup warms it without awaiting a network call; autocomplete returns at most 25 cached choices while sharing a single background refresh. A failed refresh retains the previous directory and backs off automatic retries for 30 seconds.

## Login and complete membership

Before inspecting rosters or developing this integration, the active session's `LADDER_EMAIL` and `LADDER_PASSWORD` were checked for presence without printing values. The existing backend form login and session fetched `/team/n/82`, which redirected to the authenticated `/teamView/Chonky%20Chaser` page. HTTP 200, `/summary` or a successful POST alone never proves access. Login now requires the protected team's roster, team id and signed-in controls, and rejects login forms and unresolved Discord verification gates.

Repeat the check in each new session, using environment variables rather than putting credentials in command arguments:

```sh
cd apps/api
python ladder.py --check-access
```

`LADDER_*` takes precedence over the existing `ZWIFT_USERNAME` / `ZWIFT_PASSWORD` fallback. Missing variables, rejected login or a login form on the protected team page causes a concrete error and a nonzero exit. Stop and start a correctly configured session before further roster investigation. Credentials and authenticated session cookies stay in the backend.

Authenticated inspection on 2026-11-13 verified DZR team 82 (11 current members) and opponent team 102 (10). Both contained one `#pane-roster .newPowerTable`, matching the entire embedded `Ladder.roster` array and its `LadderTeam` membership. Every one of the 21 profile ids was checked against an explicit ZwiftPower profile link. No prior start lists were used. The [anonymised fixtures](../apps/bot/services/ladder/fixtures/README.md) preserve the observed structures and expected counts.

The verified pages include all members in their initial HTML. No pagination, lazy loading or former-member section was present in either roster pane. The parser excludes other tabs, history and commented mobile cards; it checks the table against the embedded membership list. An unfamiliar format, incomplete membership or pagination causes a concrete error rather than a partial comparison. Paginated formats need authenticated verification before support can be added.

Every scout fetches both rosters again. Internal Ladder profile ids are resolved through explicit Zwift/ZwiftPower links on `/profile/{id}`; they are never assumed to be Zwift ids. Known Zwift ids are deduplicated, while every member without an identity is retained. Missing identity and missing power are reported separately. No usable ids produces a concrete error. `enrichRiders()` and its existing six-hour power cache then feed every member to `buildLadderChart()`. A rendering failure returns the complete comparison as a text attachment.

## Validation and release

```sh
cd apps/api
python -m unittest discover -s tests -p test_ladder.py -v
cd ../bot
node --test services/ladder/*.test.js
```

Tests cover missing credentials, rejected login, HTTP 200 login forms, session renewal, the existing signup-refresh flow, search ambiguity, the 15-minute cache and background-refresh sharing, all supported links, unlisted numeric links, complete rosters, unexpected pagination, duplicates, missing identity/power, private replies and all 20 members reaching the native chart in a 9-versus-11 comparison.

Work is reviewed in a PR to `NickNiebling/dzr` first. After the owner's approval, create the upstream PR. Upstream merge is the release trigger. Keep the backend commit before the bot commit: the deployed API must allow `/summary`, `/team/n/{id}`, `/teamView/{name}` and `/profile/{id}` before starting the new bot. The old bot remains compatible with the API changes. A merge alone does not prove the independently hosted API finished deploying; verify backend readiness before allowing the bot rollout to finish.

After release, verify a private response for each of these (with the DZR team linked through `/ladder_link`):

```text
/ladder_scout team:Chonky Chaser opponent:Eagle Fang Rhinos
/ladder_scout team:Chonky Chaser opponent:https://ladder.cycleracing.club/team/n/102
```

Local authenticated checks passed for both the name lookup and numeric-link lookup: each fetched the two current squads again, resolved all 21 identities and produced the native 11-versus-10 PNG. Those checks used the production backend Ladder client through a local read bridge, the verified DZR team as the local selection and Ladder's own power values. Normal power-cache enrichment and Discord privacy are covered by the automated interaction tests. No production Discord message or deployment was performed; repeat the two commands after release.
