# DZR contribution rules

- PRs must originate from a branch in their target repository (checked by CI).
- Zwift event links must omit the literal `/eu` path segment. Remove only that
  segment; preserve everything else. Run `npm run check:zwift-links`. Only
  parser-test input lines may use `// zwift-link-check: allow-input`.

## Fork workflow

- When working in `NickNiebling/dzr`, always fetch and sync the fork with
  `T00few2/dzr` (`upstream/main`) before starting changes or creating a PR branch.
- Fast-forward the fork’s `main` when possible; preserve fork-only commits when
  histories diverge. Base new work on the synchronized branch.
