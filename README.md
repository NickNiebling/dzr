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

Required API env names: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `CONTENT_API_KEY`, `ZWIFT_USERNAME`, `ZWIFT_PASSWORD`, `ZWIFTPOWER_CLUB_ID`, `FLASK_SECRET_KEY`. Legacy commentary jobs use `DISCORD_BOT_URL`, but the current Render server exposes only a health route; [the posting path is unresolved in this checkout](docs/architecture/findings.md#incomplete-and-legacy-paths).

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

## Shared constants

`packages/shared/constants.json` is the source of truth for `siteOrigin`, Discord guild/role IDs, and Firestore collection names.

- Next.js imports it via `app/lib/sharedConstants.ts`
- Copies live in `apps/bot/constants.json` and `apps/api/constants.json` because Render and Cloud Run build those folders as the project root

When you change the shared file, copy it into both app trees before deploying bot or API.

## Rollback remotes

`bot-origin` → `T00few2/bot` and `api-origin` → `T00few2/zwiftpower` remain as rollback remotes. Production deploys come from `T00few2/dzr`.

## Sentry rollout

See [the staged Sentry setup](docs/sentry-rollout.md) for local verification,
environment variables and the commit-by-commit rollout. No DSN is required for
ordinary local development or CI.
