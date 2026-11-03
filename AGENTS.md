# DZR contribution rules

- PRs must originate from a branch in their target repository (checked by CI).
- Zwift event links must omit the literal `/eu` path segment. Remove only that
  segment; preserve everything else. Run `npm run check:zwift-links`. Only
  parser-test input lines may use `// zwift-link-check: allow-input`.
