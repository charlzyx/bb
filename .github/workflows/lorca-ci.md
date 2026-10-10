# Focused CI for the Lorca fork

Only `charlzyx/bb` uses the focused fork policy in `ci.yml`. Other repositories retain the original CI planner and runner matrix.

The fork scope job runs on standard Ubuntu, checks source NUL bytes, tests its own scope guard, and rejects changes outside the Lorca app, named integration documentation and these CI files. Root Turbo changes must be limited to `@bb/lorca` tasks. Root lockfile changes may alter the Lorca importer and add dependency records, but cannot change other importers or existing dependency records. Shared BB source changes fail this limited-scope check rather than silently receiving incomplete coverage. Future broader changes need an appropriate CI plan.

`lorca.yml` runs focused tests, typechecks, production build, lint, browser smoke and authenticated Electron mock smoke with the normal sandbox. It runs for relevant pull requests and pushes to `main`, avoiding duplicate feature-branch push/PR runs. Manual dispatch remains available. Push, PR and manual runs have separate concurrency groups, so one trigger cannot cancel another trigger's required verification. Each runtime job remains capped at 15 minutes.

Both version checks remain intact; only their runner changes to standard Ubuntu in this exact fork. No paid/private runner matrix, production model probe, deployment or credential-dependent check is started by the focused fork policy.

This is **not full BB cross-platform coverage**. A green scope or version job does not replace a passing Lorca runtime workflow. No repository branch-protection or Actions account settings are changed by these files.
