# dots client verification

Verified on 2026-10-10. This is an experimental client, not a packaged release.

## Editable settings follow-up

The controlled settings implementation passes **178 deterministic tests**, TypeScript, production build and lint. Strict browser and Electron integration verification passed on [`f86e76e`](https://github.com/charlzyx/bb/commit/f86e76e2d3913e46e3ffa0de900b52fbfb74092b) in [CI run 38009952957](https://github.com/charlzyx/bb/actions/runs/38009952957); all verification steps ran, none were skipped.

Earlier Electron runs checked renderer sandbox preferences only: Playwright on Linux implicitly added `--no-sandbox`, so those historical runs did not establish process-level sandboxing. The current smoke explicitly sets `chromiumSandbox: true`, checks the real application command line contains no `no-sandbox` switch, and checks the secure renderer's Linux kernel `Seccomp: 2` and `NoNewPrivs: 1` state. It also attempts to open DevTools and verifies that they remain closed. These checks establish this Linux fixture run, not an exhaustive sandbox audit or verification on macOS. Production security preferences were never relaxed.

Coverage includes source-fenced isolated credential windows, no existing-secret echo, credential replacement only into a synthetic daemon, secret-free main renderer and confirmation details, stale revision/account/connection failures, exact native confirmation, full-rule policy review, MCP whole-file caveats, readback races, cancellation, TTY-only CLI writes and unknown-outcome no replay. The latest upstream target is `egoist/lorca@b975eb6056b01bf7f2058b5c5e9ffc22e9930eea`; new shared-link fragment keys and playbooks remain excluded from renderer projection, with regression coverage.

The run produced 25 synthetic PNGs in artifact `11652917905` (7-day retention). Desktop model/Runner configuration and confirmation, MCP, automatic approval and its final confirmation controls, connection settings, and the dedicated secure provider window were actually viewed after download. Chinese typography was readable and no blocking overlap was observed. No PNGs were added to the repository; these are fixture screenshots, not user data or live provider verification.

This phase does not use the user's Mac or live service. macOS native confirmation and production-provider compatibility remain to be tested later with the user. Credentials are entered only into a dedicated local sandboxed window with an ephemeral session; no existing key/raw MCP config is returned to the main renderer. Unknown default provider destinations require an explicit URL. MCP file-writing changes may apply unrelated pending on-disk edits, as documented in the editable-settings contract.

## PC audit follow-up

The subsequent local audit passes **212 tests**, types/build and lint, plus five fork-scope guard tests. It fixes:

- Successful send acknowledgements no longer inherit a concurrent stop/history error.
- Discarded attachments release opaque native handles without deleting files; same-endpoint Save preserves valid selections, and active sends retain their handles until completion.
- Late history responses/errors cannot unlock or overwrite a newer pagination request.
- Exact-tool approval rules clearly label text as a note, not a condition; duplicate exact tools are rejected. Unknown outcomes retain the policy draft and lock resubmission, with explicit readback/adoption and account-bound cleanup.
- Unknown devices with empty descriptions no longer disable every settings editor. Existing MCP entries can be disabled without interpreting their saved URL as new credentials; reconnect explicitly rebuilds the cached connection with native confirmation.
- Provider disconnect descriptions match account-wide scope and possible token revocation.

The browser smoke includes interruption, conflict, unknown-readback and successful-send/concurrent-stop regressions. The `f86e76e` screenshot run above predates these audit changes; use the exact later commit's PR checks for its browser/Electron result, not that historical green run.

Fork CI now runs the actual version checks on standard Ubuntu and uses a failing scope guard for code/lockfile/Turbo changes outside this focused integration. Dedicated Lorca CI still runs build/types/tests/lint and strict-sandbox browser/Electron fixtures. This is not the upstream BB full-stack or mobile matrix. See [CI scope](../.github/workflows/lorca-ci.md).

## Earlier baseline verification

The following records describe earlier milestones, not the latest test count above.

- Focused frozen-lock dependency installation, including a fresh offline reinstall
- Turbo test, TypeScript and production renderer build: **103 tests passed**
- Earlier baseline native bridge suite repeated 100 consecutive times: **2,000 tests passed**; current settings/security changes are covered by the 103-test suite
- Native JavaScript syntax checks and command-line help without connecting
- Root lockfile consistency checked with pnpm 9 frozen/offline resolution in a detached manifest-only workspace
- Existing root dependency resolutions preserved; only the Lorca importer and required new lock records added
- Turbo lint: zero warnings and zero errors
- Diff whitespace checks

The tests cover request correlation, authentication and Origin behavior, explicit legacy mode, schema drift, unknown mutation outcomes, no replay, account/connection races, opaque file-selection races, bootstrap buffering, message replacement, queued acknowledgements, pagination, multi-job state, markdown safety, approval capability controls, attachment display, and BB theme/utility compilation.

All protocol tests use deterministic fixtures, isolated local mock WebSockets and temporary fake tokens. No live user account, relay, model call or production service was tested or modified.

## Browser and Electron verification

The dedicated [client CI run on e104400](https://github.com/charlzyx/bb/actions/runs/37982735356) passed all steps, including real Chromium browser smoke and real Electron main/preload/UI against an authenticated mock daemon. Its nineteen synthetic screenshots were downloaded; normal desktop views and 1240 × 820 settings pages were visually inspected. Narrow-screen visuals were not the acceptance priority; the run’s `lorca-synthetic-screenshots` artifact contains the original PNGs (requires GitHub sign-in; retained for 7 days). Desktop chat, approval, empty state, and Electron bridge views showed no obvious overflow. Simplified Chinese and lowercase dots branding are verified in chat, empty states, approvals, and desktop settings: Connection, Preferences (light/dark), Runners, plugin details, MCP, and unavailable inventory. CJK font coverage is checked in CI; no missing glyphs were found in the reviewed captures. IME composition does not send a message. The real Electron settings smoke confirms that private config, provider URLs/details and remote error markers never reach renderer IPC. The Electron chat screenshot confirms named bot headers and a synthetic send/reply through the native bridge.

The artifact also retains desktop chat/approval/empty/offline states, baseline narrow-screen coverage, and actual Electron chat/settings views. PNGs are not committed to this repository. To regenerate them, use the smoke commands below in a supported browser environment.

The local build environment prevents browser socket creation, so GUI verification uses CI. Earlier Playwright-launched Electron runs implicitly disabled the process sandbox despite sandboxed renderer preferences; the new explicit launch and kernel-state checks correct that verification gap without changing production security settings.

Repeatable scripts are included for a normal browser/desktop environment:

```sh
node apps/lorca/scripts/focused.mjs install
node apps/lorca/scripts/focused.mjs check
node apps/lorca/scripts/focused.mjs preview
node apps/lorca/tests/ui-smoke.mjs
```

The browser smoke script covers synthetic desktop/mobile light/dark states, empty/chat/approval/offline layouts, overflow, keyboard shortcuts, drawer dismissal, failed-send draft retention and late acknowledgements after edits/navigation. It makes no real agent calls. It writes screenshots to `docs/lorca-screenshots/` only when a real browser run succeeds.

`tests/electron-smoke.mjs` separately uses the real Electron main/preload/UI with an authenticated mock daemon and an isolated temporary home. It checks renderer isolation and performs exactly one synthetic send. It requires a normally installed Electron binary and a supported graphical environment, such as Xvfb on Linux; it passed in the linked CI run.

The single-Linux `.github/workflows/lorca.yml` runs the focused checks, browser smoke and authenticated Electron mock smoke with explicit sandbox verification, then retains synthetic screenshots as a short-lived artifact. The historical linked run predates process-level sandbox assertions; consult the current settings run for the stronger checks. No Actions settings were changed as part of this implementation. Inherited upstream workflows are separate and are not evidence for this Lorca client.

## Desktop settings scope

The [inventory contract](lorca-settings.md) and [editable settings contract](lorca-editable-settings.md) distinguish daemon reports from explicit writes. Bot model/Runner changes affect every chat using that bot. Provider credentials and MCP configuration use isolated native-controlled input; normal renderer IPC carries only safe summaries and action identifiers. Auto-review updates are account-wide, require full-rule review and never default to blanket allowance. OAuth, per-bot access grants, relay changes and MCP tool hiding remain outside this UI. New write paths are tested only with synthetic data and mock services; no real account configuration was changed during this phase.

## Remaining runtime limits

- Cloud development and CI exercised no real Lorca identity, relay, model provider, native file transfer, or production service. A separate authorized macOS source-run check connected to an existing daemon and verified read-only chat/history/settings access; no new agent message was sent.
- macOS source-run verification found that the system application menu and About icon still belong to the Electron host bundle. The app window, sidebar and explicit About product name use dots. The native About product version is now explicitly 0.1.0. A new isolated local packaging script supplies dots bundle metadata and an ICNS icon; its real macOS signing, launch and native appearance are not yet verified. It uses local ad-hoc signing only, with no Developer ID or notarization, and does not change Lorca data/token lookup. See [local macOS packaging instructions](../apps/lorca/README.zh-CN.md#macos-独立本地开发包).
- The macOS packaging follow-up passed 105 local tests, TypeScript, production build and lint. Its two new packaging tests verify ICNS format, runtime-only file selection, no-overwrite behavior and command isolation using a synthetic Electron bundle; they do not execute Apple tools on Linux.
- Browser and Electron checks use synthetic fixtures; passing them does not prove compatibility with every live daemon version.

## Protocol limitation

Lorca provides no event revision or snapshot barrier. Buffered replay has terminal-state/prefix protections but cannot prove a total order for every conflicting snapshot/event pair. See [the protocol ordering limit](lorca-protocol.md#snapshot-ordering-limit). Rust remains the authority for permissions and queued-message execution.
