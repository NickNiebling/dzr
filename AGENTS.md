# DZR contributor instructions

## Repository and pull request workflow

- The user's fork is `NickNiebling/dzr` (`origin`). Upstream is `T00few2/dzr`
  (`upstream`). Verify these identities before any push or PR operation.
- At the start of every new task, inspect the working tree and fetch upstream.
  Sync the fork's `main` with `upstream/main` by fast-forward before branching.
  Preserve existing work; never force-push or overwrite a divergent branch.
- Always create the initial review PR inside `NickNiebling/dzr`, from a branch
  in that same fork to its `main`. A general request to make a PR means this.
- Never push changes or open a PR in `T00few2/dzr` until the user explicitly
  requests upstream promotion. Review approval alone is not that request.
- When upstream promotion is explicitly requested, create a branch directly in
  `T00few2/dzr` and open the upstream PR from that upstream branch. Never open
  an upstream PR whose head branch belongs to a fork.
- Do not merge a review PR or deploy changes without the user's instruction.

## Zwift event links

Remove only the literal `/eu` path segment from Zwift event links. Preserve all
other bytes, including `/uk`, `/eu-de`, tag paths, event IDs, scheme, host, query
parameters and fragments. Do not broaden this into URL canonicalization.

Run `npm run check:zwift-links` before proposing changes. CI runs the same check
across the repository. Parser tests may retain `/eu` links as input examples;
annotate only those lines with `// zwift-link-check: allow-input`.
