import { withSentryConfig } from '@sentry/nextjs/config'
import path from 'path'
import { fileURLToPath } from 'url'

/** @type {import('next').NextConfig} */
const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const elevationFiles = [
  './node_modules/zwift-data/lib/streams/routes/**/*',
  './node_modules/zwift-data/lib/streams/segments/**/*',
  './data/sauce-route-segments.json',
]

const nextConfig = {
  // A package-lock.json in a parent folder would otherwise become the Turbopack root.
  turbopack: {
    root: projectRoot,
  },
  // Next writes an AGENTS.md on dev startup unless this is off.
  agentRules: false,
  // The profile API reads one route file by name. Next cannot see that path, so the files never reach Vercel.
  outputFileTracingIncludes: {
    '/api/route-profile': elevationFiles,
    '/api/route-profile/route': elevationFiles,
  },
  // `next dev` uses Turbopack and ignores this hook. The dev script passes --webpack so
  // edits under apps/ (the bot and API) do not rebuild the site.
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/node_modules/**', '**/apps/**'],
    }
    return config
  },
}

export default withSentryConfig(nextConfig, {
  org: 'danish-zwift-racers',
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
})
