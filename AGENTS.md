# Contributor notes

Zwift event links must use `https://www.zwift.com/events/view/<id>` everywhere:
site pages, Discord messages, API output, data and documentation. Locale and tag
paths break opening events in Zwift Companion.

Run `npm run check:zwift-links` before proposing changes. CI runs the same check
across the repository. Parser tests may keep noncanonical links as input examples;
annotate only those lines with `// zwift-link-check: allow-input`.
