# Sentry: gradual rollout

Organization: `danish-zwift-racers`. No account credentials or DSNs belong in git.
This branch starts from upstream main; it does not include the earlier Firestore
error-digest prototype. Errors only initially: tracing, replay, profiling and log
stream ingestion are outside this first rollout.

## Step 1 — SDK connection and local verification

Install dependencies with `npm ci` in the repository root. Create `.env.local`
(ignored by git) containing `NEXT_PUBLIC_SENTRY_DSN` from the website project's
Client Keys page. Set `NEXT_PUBLIC_SENTRY_ENVIRONMENT=development` locally.
`NEXT_PUBLIC_` values are compiled into the browser, so a DSN is a public ingestion
address, not an auth token. We still keep its value out of git. Never put an API
token in a `NEXT_PUBLIC_` variable.

Run `npm run sentry:smoke` for an intentional, sanitized connection-check event.
Confirm the event in Sentry with the development environment selected. This CLI
check proves transport only, not Next's framework wiring; test the app in step 2.
Without a DSN the SDK is disabled and ordinary local development/CI still works.

The shared privacy hook keeps only error type, stack locations, level, time,
release, environment and service. It removes original error messages, request,
user, contexts, extras and breadcrumbs. Details remain in hosting logs. This is
an intentionally conservative starting point: useful error messages can be added
later with reviewed, stable error codes. `sendDefaultPii: false` alone is not enough.

## Variables outside git

| Location | Name | Purpose |
| --- | --- | --- |
| root `.env.local` / Vercel | `NEXT_PUBLIC_SENTRY_DSN` | Website browser and server ingestion |
| root `.env.local` / Vercel | `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Browser environment: development, preview or production |
| Vercel / root `.env.local` | `SENTRY_ENVIRONMENT` | Server override; otherwise VERCEL_ENV or development |
| Vercel build only | `SENTRY_AUTH_TOKEN` | Optional private source-map upload credential; never public/runtime/browser |
| Vercel build only | `SENTRY_PROJECT` | Website project slug for source maps |
| local/build | `SENTRY_RELEASE` | Optional release override outside Vercel |

Use separate website and bot projects in one organization if possible. An onboarding
run code identifies setup progress; it is neither a DSN nor a runtime credential.
No Sentry account/project has been created or changed by these files.
