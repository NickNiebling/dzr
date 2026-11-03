# DZR

- Start each task by inspecting changes and remotes, fetching upstream, and
  fast-forwarding the fork's `main` before branching. Preserve work; never force-push.
- Initial review PRs target the contributor's fork `main`. Every PR's source
  branch must belong to its target repository. Verify remotes before pushing.
- Upstream pushes/PRs require an explicit promotion request; review approval
  alone is insufficient. Merge or deploy only when instructed.
- Zwift event links: remove only literal `/eu`; preserve every other byte.
  Run `npm run check:zwift-links` before proposing changes. Only parser-test
  input lines may use `// zwift-link-check: allow-input`.
