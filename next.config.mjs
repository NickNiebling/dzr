import path from 'path'
import { fileURLToPath } from 'url'

/** @type {import('next').NextConfig} */
const projectRoot = path.dirname(fileURLToPath(import.meta.url))
// Roads are opened by world id, so Next cannot see the path. The snapshot has to be traced.
const sauceFiles = ['./data/sauce/**/*']

const nextConfig = {
  // A package-lock.json in a parent folder would otherwise become the Turbopack root.
  turbopack: {
    root: projectRoot,
  },
  // Next writes an AGENTS.md on dev startup unless this is off.
  agentRules: false,
  outputFileTracingIncludes: {
    '/api/route-profile': sauceFiles,
    '/api/route-profile/route': sauceFiles,
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

export default nextConfig
