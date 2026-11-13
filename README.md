# DZR monorepo

Canonical GitHub repo: [`T00few2/dzr`](https://github.com/T00few2/dzr). Production site: [www.dzrracingseries.com](https://www.dzrracingseries.com).

**New contributor? Start with the [architecture guide and Mermaid diagrams](docs/architecture/README.md).** Follow the system overview and client/server technology stack into membership, bot automation, Coach, events, data, security and deployment. See the [maintenance guide](docs/architecture/maintenance.md) for keeping it current.

Three runtimes stay separate. Do not add npm workspaces (Vercel must keep using the root Next `package.json` only).

| Path | App | Host | Runtime |
|---|---|---|---|
| repo root | Next.js 16 site, `/admin`, `/members-zone`, `/join` | Vercel | Node 22 (`.nvmrc`) |
| `apps/api` | Flask jobs and integration API | Cloud Run (`zwiftpower`) | Python, `PORT` default `8080` |
| `apps/bot` | Discord club bot + optional DZR Coach | Render service `bot`, Oregon (`bot-tdnm.onrender.com`) | Node 22, `node bot.js` |

All three already deploy from this repo. Local secrets live in `.env.local` (site) and `apps/api/.env` / `apps/bot/.env`. Do not commit `service-account-key.json` or `.env` files.

## Website (this directory)

```powershell
npm install
npm run dev
```

Open http://localhost:3000

| Area | Path | Access |
|---|---|---|
| Public site | `/`, `/about`, `/racing`, event pages | Anyone |
| Join / onboarding | `/join` | Public flow (Discord → Vipps → Zwift ID) |
| Members zone | `/members-zone` | Verified-member role or paid membership via NextAuth |
| Admin | `/admin` | Discord **Admin** role |
| intervals.icu | `/intervals/connect` | Logged-in members |

Site reads `packages/shared/constants.json` through `app/lib/sharedConstants.ts`. Next webpack ignores `apps/**` so bot/API edits do not reload the site.

### Vercel

Root is a standard Next.js app. No `vercel.json` is required.

- Build: `npm run build`
- Start: `npm start`
- Node: `22`

Required site env names (set in the Vercel project; never commit values):

- Auth: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_REQUIRED_ROLE_ID`
- Coach (optional): `COACH_BOT_TOKEN`, `COACH_BOT_CLIENT_ID`, `COACH_CONNECT_SECRET`, `COACH_TOKEN_KEY`, `COACH_MEMORY_KEY`
- intervals.icu: `INTERVALS_CLIENT_ID`, `INTERVALS_CLIENT_SECRET`, optional `INTERVALS_REDIRECT_URI` (`https://www.dzrracingseries.com/api/intervals/callback`)
- Firebase client: `NEXT_PUBLIC_FIREBASE_*`
- Firebase admin: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- Jobs API: `CONTENT_API_BASE_URL`, `CONTENT_API_KEY`
- Payments: `VIPPS_*` (only if membership checkout is enabled)

`NEXTAUTH_URL` is `https://www.dzrracingseries.com` in production and `http://localhost:3000` locally.

## Flask API (`apps/api`)

```powershell
cd apps/api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

Binds `0.0.0.0:$PORT` (`8080` locally). Firebase uses Application Default Credentials on Cloud Run (`apps/api/firebase.py`). Copy env names from `apps/api/.env.example`.

Cloud Run deploys `apps/api` from this repo. The service name stays `zwiftpower`. Health check is `GET /` and returns `{"service":"dzr-api",...}`. Admin UI is on the Next site, not this service.

Required API env names: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `CONTENT_API_KEY`, `ZWIFT_USERNAME`, `ZWIFT_PASSWORD`, `ZWIFTPOWER_CLUB_ID`, `FLASK_SECRET_KEY`. Legacy commentary jobs use `DISCORD_BOT_URL`, but Render has no general-purpose posting route; [the posting path is unresolved in this checkout](docs/architecture/findings.md#incomplete-and-legacy-paths).

## Discord bot (`apps/bot`)

```powershell
cd apps/bot
npm install
node bot.js
```

Keep-alive HTTP server listens on `0.0.0.0:$PORT` (`3000` locally) and answers `GET /` with `Bot is running!`.

Render service **`bot`** (Oregon) deploys this folder from this repo:

- Root Directory: `apps/bot`
- Build: `npm ci`
- Start: `node bot.js`
- Health check: `GET /`

[`render.yaml`](./render.yaml) documents that setup. Do not Apply it as a new Blueprint; that would create a second bot. `plan: starter` is required so the Discord gateway does not sleep.

Optional second bot **DZR Coach** (silent in channels; coaching DMs only). Create a Discord application named DZR Coach, enable Message Content, invite it to the guild with scope `bot` only, then set `COACH_BOT_TOKEN` and `COACH_BOT_CLIENT_ID` on Render and Vercel. `/coach` stays on the club bot and opens a DM from DZR Coach. Without those env vars the club bot starts and skips Coach.

Required bot env names: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`. Also set `CONTENT_API_*`, `OPENAI_API_KEY`, and `COACH_CONNECT_SECRET` for the features that use them.

**Ladder previews** (`apps/bot/services/ladder`, commands `/ladder_link`, `/ladder_preview`, `/ladder_analysis`): the bot posts a preview image about 65 minutes before each ladder match, and a match-day reminder from 12:00 Copenhagen time, in the ladder channel (`LADDER_CHANNEL_ID`, default `1382817917984313404`). Teams are added with `/ladder_link`. State lives in the Firestore collection `ladder_bot` (created on first write; denied to clients in `firestore.rules`). The bot has no ladder or Zwift password: it calls the Flask API (`/ladder_page` for fixture pages, `/rider_data/<id>` for W/kg, `/zwift_profile/<id>` for racing score and category) with `CONTENT_API_KEY`, and the API signs in with the club account (`ZWIFT_USERNAME` / `ZWIFT_PASSWORD`, or `LADDER_EMAIL` / `LADDER_PASSWORD`). The route picture is the site profile (`/api/route-profile`), with powerup icons when the fixture tags name them. Deploy the API before the bot. Errors are logged to the Render logs only. `/ladder_ai` adds an AI analysis of how to ride the match (tactics and points strategy) through the same OpenAI setup as the coach. It costs tokens, so each user gets `LADDER_AI_DAILY_RUNS` fresh runs per day (default 5, `0` switches it off), and an analysis is reused for 30 minutes per match and team.

**Ladder scout**: `/ladder_scout team:<linked DZR team> opponent:<team name or Ladder team link>` privately compares both complete current squads using the existing enrichment, power cache and chart. Both fields are required; select the DZR team from `/ladder_link`. Opponent suggestions come from `/summary`, cached for 15 minutes. Numeric team links also work for unlisted teams. See [verification, limitations and release order](docs/ladder-scout.md).

DZR Coach reads training from intervals.icu. Register an OAuth app on your intervals.icu account (Settings, then the app’s Manage page). Redirect URI: `https://www.dzrracingseries.com/api/intervals/callback`. The site requests `ACTIVITY:READ,WELLNESS:READ,SETTINGS:READ,CALENDAR:WRITE`. Set `INTERVALS_CLIENT_ID` and `INTERVALS_CLIENT_SECRET` on Vercel. Set `COACH_CONNECT_SECRET` to the same value on Vercel and Render (it signs connect links and encrypts tokens). If coach profiles were encrypted before this change, copy the previous connect-secret value into `COACH_CONNECT_SECRET`, and copy any dedicated token key into `COACH_TOKEN_KEY`. Optional `COACH_MEMORY_KEY` still encrypts coach memory when set. Optional `INTERVALS_REDIRECT_URI` overrides the callback URL.

Optional: `COACH_DAILY_TOKEN_BUDGET` caps each athlete's coaching tokens per day (default 600000, `0` disables). Cached prompt tokens count at 10%, matching what OpenAI charges for them.
Optional: `COACH_FOLLOW_UPS_PER_RUN` is how many check-ins one scheduler sweep sends (default 100); any remaining are sent on the next tick, until 11:00 Copenhagen time.

DZR Coach uses OpenAI's Responses API with `store: false`: encrypted reasoning is replayed only
inside the current tool sequence and is discarded after the visible reply. The default model is
`gpt-6-luna`; `COACH_MODEL` is the rollback switch. Routing starts at
`COACH_REASONING_EFFORT=low` and analysis tools raise the answer to
`COACH_ANALYSIS_REASONING_EFFORT=medium`.

The non-Coach club assistant uses the same stateless Responses architecture and defaults to
`gpt-6-luna`. Configure it independently with
`CLUB_ASSISTANT_MODEL`, `CLUB_ASSISTANT_REASONING_EFFORT` and
`CLUB_ASSISTANT_MAX_OUTPUT_TOKENS`; changing those settings does not affect Coach.

Before changing Coach models, run `npm run eval:dry`, then a repeated live comparison from
`apps/bot`. Keep the judge fixed so candidates do not grade themselves:

```powershell
$env:COACH_EVAL_MODEL="gpt-6-luna"
$env:COACH_EVAL_JUDGE_MODEL="gpt-6.1-sol"
$env:COACH_EVAL_REPEATS="3"
npm run eval
```

### OBS streaming

Club Members use `/streaming_add` in the DZR guild to enter their YouTube/Twitch channels in a private modal. Both `/streaming_add` and `/streaming_remove` require the role configured in `system_settings/global.membership.clubMemberRoleId`. The bot returns the Lua download, installation instructions and a personal OBS key; removal revokes enrollment. `/streaming_overview [page]` gives admins a private list of members, channel links, last verified live starts, broadcast links and errors. Channel ownership is trusted; members do not connect provider accounts.

`/streaming_add_new` is the parallel browser-onboarding experiment, disabled by default. Set `STREAMING_SETUP_ENABLED=true` on the bot and restart it to register and enable the command. It uses the same Club Member checks, channel form, registration service, personal keys and generic Lua script. New members get a private registration confirmation, their newly created key and a link to `/streaming/setup`. Existing members get the guide without changing their channels or key, including when a stale `/streaming_add_new` form is submitted again. The original `/streaming_add` experience remains available with its existing key-rotation behavior.

To stop the pilot, unset the flag or set it to `false` and restart the bot. Old experimental buttons, cached commands and open forms are rejected before any registration access. Existing keys, callbacks, announcements and the original onboarding remain operational. The public guide can still be inspected directly; it does not enroll members or receive their keys. Native OBS/Discord acceptance remains an activation check, not a claim made by automated tests or by deploying the disabled experiment.

The existing Render service serves `GET /streaming/dzr-stream.lua` and authenticated `POST /streaming/obs`; no extra service or provider OAuth flow is required. Set on Render before onboarding:

| Variable | Purpose |
| --- | --- |
| `YOUTUBE_API_KEY` | YouTube Data API v3 enabled; restrict the key to that API. Required for YouTube registrations/verification. |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Twitch application credentials. Required for Twitch registrations/verification. |
| `STREAMING_PUBLIC_URL` | Optional external HTTPS bot origin; defaults to `RENDER_EXTERNAL_URL`, then `https://bot-tdnm.onrender.com`. Used in onboarding links. |
| `STREAMING_SETUP_URL` | Optional HTTPS browser-guide URL; defaults to the shared DZR site origin plus `/streaming/setup`. Set to the test website URL when running the isolated test bot. Must not contain a query, fragment or personal key. |
| `STREAMING_SETUP_ENABLED` | Bot opt-in for experimental onboarding. Only the exact value `true` enables command registration and new-flow handlers; unset, `false` and other values leave it disabled. Restart/redeploy after changing it. |
| `STREAMING_CHANNEL_ID` | Optional destination override; defaults to `1196454773558345768` (`#streaming-now`). |
| `IT_CHANNEL_ID` | Shared Discord IT destination; defaults to `1544209256100794378` (`#it`). Currently used for streaming errors. |
| `STREAMING_YOUTUBE_SEARCH_BUDGET` | Optional daily search cap; default `90`, reset at Pacific midnight. Set `0` to allow known-video verification only. |

The provider secret names are also documented in `render.yaml` with `sync: false`; set their values on the existing Render service. Grant the bot **View Channel**, **Send Messages**, **Embed Links**, and **Read Message History** in the destination, plus **View Channel** and **Send Messages** in `#it`. History recovers uncertain sends without duplicate announcements. The overview accepts Administrator or the DZR Admin role; give the latter command visibility under Server Settings → Integrations if needed. Deploy the Firestore rules together with the bot; the server-only `streaming_bot` collection needs no composite index.

For the browser guide, also set **`STREAMING_PUBLIC_URL` explicitly on Vercel** to the bot's HTTPS origin, with no path or credentials. The page uses it for the OBS callback address; `GET /api/streaming/script` uses it to fetch the existing `GET /streaming/dzr-stream.lua` distribution. This same-origin download avoids browser CORS restrictions and keeps one source for the Lua file. The page shows an unavailable message when this setting is missing or invalid. Make the website available before deploying the new bot command.

The public guide takes the member through Windows/macOS selection, permanent file placement, adding the script in OBS and copying the endpoint. Supported browsers can save into a user-selected DZR directory; other browsers receive the normal download. Existing different files are preserved. Personal keys are copied directly from the private Discord message into OBS; the website has no key field, personal link or key storage. Completing the guide does not verify a connection. **Test forbindelse** in OBS and **Kontrollér OBS-forbindelse** in Discord remain optional. A lost key can be replaced with `/streaming_add`, with a warning that saving there invalidates the previous key.

Use the [isolated fork-testing guide](docs/streaming-setup-testing.md) for the local Firestore emulator, guild-only test bot, native acceptance matrix and comparison with the original flow. It requires no additional Render service. Do not start the production bot entrypoint against a test database: it registers global commands and starts unrelated jobs.

The private onboarding guide assumes OBS Studio is already installed and configured for streaming. It explains the purpose before asking for at least one channel link, then gives separate steps for downloading `dzr-stream.lua`, finding it in **Downloads / Overførsler**, opening **Tools / Værktøjer → Scripts**, clicking **+**, and selecting the downloaded file. It maps the DZR address and personal key to the existing **DZR endpoint** and **DZR key** fields, then explains automatic detection of registered channels, optional YouTube video links, **Test forbindelse** in OBS and **Kontrollér OBS-forbindelse** back in Discord. A connection test posts no public announcement; members should check the reported signal time. Saving the channel form again rotates the key, so the new key must also be entered in OBS.

After OBS starts, the bot automatically checks every registered YouTube/Twitch channel; no platform selection is needed in OBS, including for custom RTMP/multistream services. Before any channel is found live, attempts back off by 15, 30, 60, 120, 240 and at most 300 seconds, ending after one hour from OBS start. The first verified platform is announced immediately. Other platforms are checked every 60 seconds for only five more minutes from that first verification and added to the same message when verified. An unused registered platform does not produce a timeout error after another platform was found. Heartbeats and reconnects do not extend discovery deadlines. Scheduled streams and OBS preview do not qualify. Optional per-broadcast YouTube links are checked first and bypass search when live. Stale, unavailable or upcoming links fall back to live search on the registered channel. Cached upcoming videos are checked first on later discovery attempts but never suppress live searches while no live video has been found; the upcoming search runs at most once. All searches use the shared daily cap above.

After verification, known streams are not polled for ending while OBS is live. Ending checks require an authenticated OBS `stopped` event from a known session. Other active sessions veto that stop until they explicitly stop or their last heartbeat is 150 seconds old, so a silent session orphaned by a script reload cannot block completion forever. The explicit stop is persisted while waiting; a continuing heartbeat cancels that pending authorization, and a new `started` event or a returning active source suspends ending checks. Missing heartbeats alone never authorize ending checks. If no stop event is received, the announcement intentionally remains LIVE indefinitely. Initial and additional-platform discovery still follow the limits above. A new OBS start may refresh known live links for up to five minutes, stopping on confirmation; this never marks a stream ended or reopens discovery of unused platforms.

After OBS stops, verified streams are checked immediately and every 60 seconds. A confirmed offline response starts a separate five-minute reconnect grace period; the provider is checked again before marking that platform ended. Short reconnects reuse the message and update links when the broadcast ID changes. Provider errors alone never mark a stream ended. Each card has the platform color (YouTube red, Twitch purple), actual start time, a small thumbnail when available and a neutral Discord link button. Ended cards remain with live duration; when the provider supplies no actual end time, duration is approximate and uses the received OBS stop time, excluding completion grace. Public recordings replace live buttons when available; otherwise buttons are removed. Recording checks run at completion and after 1, 5, 15, 30 and 60 minutes. Twitch recordings must match the original stream ID. All message updates disable mentions. Authenticated callback, verification and delivery errors are reported to `#it` with repeated errors coalesced.

Roll out first to one or two test streamers. Exercise Test forbindelse, a public start, a scheduled YouTube preview, single-platform use with both channels registered, staggered multistream starts, a custom RTMP service, short/long reconnects and completion with/without recordings. Verify that no ending checks run without an explicit stop or while another OBS source is still active, that script reloads followed by a real stop can complete after the old session expires, that restarting OBS suspends checks, and that a missing stop event leaves the announcement LIVE. Check the same message on Discord mobile and desktop. CI tests Lua HTTPS/libcurl on Linux; native OBS still needs this acceptance run on Windows/macOS as applicable. Existing scripts continue to work with platform values treated as optional hints. See [streaming architecture](docs/architecture/streaming.md) for the callback contract and failure handling.

Streaming tests are part of the bot suite. Install `luajit`, `libcurl` and `openssl` to run the real Lua transport test locally (or set `LUAJIT_BIN`); CI provides these. Without LuaJIT, that test is explicitly skipped. Tests do not post to Discord or read production Firestore.

## Shared constants

`packages/shared/constants.json` is the source of truth for `siteOrigin`, Discord guild/role IDs, and Firestore collection names.

- Next.js imports it via `app/lib/sharedConstants.ts`
- Copies live in `apps/bot/constants.json` and `apps/api/constants.json` because Render and Cloud Run build those folders as the project root

When you change the shared file, copy it into both app trees before deploying bot or API.

## Rollback remotes

`bot-origin` → `T00few2/bot` and `api-origin` → `T00few2/zwiftpower` remain as rollback remotes. Production deploys come from `T00few2/dzr`.
