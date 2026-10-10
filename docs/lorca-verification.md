# dots client verification

Verified on 2026-10-10. This is an experimental client, not a packaged release.

## Desktop density and current protocol follow-up

The desktop uses a single compact 48-pixel web header and lighter, borderless content surfaces. On macOS the main window uses Electron `hiddenInset`, retains native traffic lights, and reserves their area; header whitespace is draggable while interactive controls are `no-drag`. Other platforms retain their native system window controls. The isolated secure editor keeps its native title bar and security configuration. The selected Ghost artwork is unchanged.

The [current protocol audit](lorca-protocol-audit.md) pins upstream `3cc900f521662e9cc039d85a1099767b16ef91a4` and distinguishes implemented chat behavior from missing and intentionally excluded surfaces. New secret-request cards cannot offer allow/always or submit credential values; they give a native-client handoff instruction and retain denial. New outbound draft cards remain an explicit unsupported-type notice, with no send/edit approval path. Relay status now says connected rather than claiming synchronization is complete.

This follow-up also fixes reused-DM draft retention, stale pagination after navigation, and active shell runs being incorrectly labeled complete. Foreground watching uses main-process focus/visibility and a validated visible chat ID; hidden/settings/background views clear watching. The daemon's watching slot is global, without a lease or per-client ownership, so concurrent clients can overwrite it. No real message, account configuration or credential was used in this cloud work.

The local aggregate passes 316 deterministic tests, TypeScript, production build and lint. Independent source and focused regression review covers the watcher state machine and safe renderer boundaries. CI browser/Electron results for this follow-up are recorded by its exact commit checks. macOS native drag/traffic-light appearance still requires the separate user-computer verification; Linux browser geometry and sandbox smoke do not establish that result.

## Selected Ghost app icon

The selected A / Ghost artwork replaces the native app, About and Dock icon. The sidebar, empty state, favicon and secure-settings brand use the same approved Ghost artwork; bot/user avatar semantics are unchanged. The original and seven derived sizes have recorded SHA-256 and decoded-pixel hashes; the 1024- and 32-pixel outputs match the selected preview pixel-for-pixel. The retained mask is MIT figma-squircle 1.1.0 with the preview's same parameters, described as macOS-style continuous corners rather than an Apple template. See [source, permission and reproduction](../apps/lorca/artwork/NOTICE.md).

The local aggregate passes **285 tests**, TypeScript, production build and lint. Independent checks cover PNG CRC/filter decoding, pixel/file manifests, all seven ICNS sizes, input validation before bundle creation, no overwrite, license inclusion, and exclusion of the original artwork and optional Sharp toolchain from the runtime bundle. The generator's read-only `--check` passed using the recorded Sharp version. Cloud checks do not claim that macOS native appearance has already been accepted; use the rebuilt bundle for that separate check.

## Avatar and native icon follow-up

The avatar/icon changes on [`0d6a9f7`](https://github.com/charlzyx/bb/commit/0d6a9f7abfb4f12f681ad8ec273a5f9a9fe32b12) pass **281 deterministic tests**, TypeScript, production build and lint locally and in [CI run 38019373604](https://github.com/charlzyx/bb/actions/runs/38019373604). Fork scope and both version-lockstep runs also passed. Cached images are tested with synthetic raster data only: no remote image URL, file-path IPC or `files.path` request is added. Native reads are bound to the known bot, opaque expected avatar version, account and connection; symlinks, hardlinks, unsupported/animated raster inputs, excessive bytes/pixels and stale reads are rejected. The main process re-encodes accepted images; the renderer has its own 64-entry/8 MiB image budget and four-request limit. A failed image falls back and may retry only after a bounded explicit refresh.

The browser smoke adds desktop light/dark/group avatar views and identity/version replacement checks. The Electron smoke exercises the real native image decoder against a temporary cached PNG and verifies that synthetic embedded metadata does not reach the renderer. All of these steps actually passed in that run with `sandboxEnabled: true`. Artifact `11657692970` retains 28 synthetic PNGs for seven days. The new desktop light, dark and group avatar screenshots were downloaded and visually inspected: sidebar/header/message images agree, group stacking and person/symbol fallback are visible, and no blocking overflow was found. These fixture results do not replace the separate Mac check with its existing daemon and cached avatars.

Mac measurements found the previous app icon occupied the whole canvas. The historical four-dot mark used a 206-pixel footprint on its 256-pixel canvas and seven ICNS resolutions from 16 through 1024. That mark is superseded by the selected Ghost artwork above. No user avatar or screenshot is committed.

The pinned daemon returns a bot's existing single DM when the user starts chatting again. Copy now says “开始聊天” and explains history reuse; a regression confirms that the reused response does not overwrite loaded history or trigger a bot/history deletion. No additional live message was sent from this cloud task.

## Approval draft follow-up

[`989903a`](https://github.com/charlzyx/bb/commit/989903a91fdd51b8db826eb053e773d802049a66) passed **231 tests**, TypeScript, build and lint in [run 38017919835](https://github.com/charlzyx/bb/actions/runs/38017919835). Browser checks actually exercised renewed capability tickets with unchanged policy content, close/reopen, responsive layout remounts and unknown-outcome resubmission locks. The real Electron fixture reported `sandboxEnabled: true` with the strict process checks below. Fork scope and both version-lockstep runs also passed.

The native random ticket is a submission capability, not a configuration version. The UI compares policy content and rule order for conflicts, renews the capability without discarding an unchanged draft, and keeps the draft above responsive layout remounts. Actual account/endpoint changes still clear it. The 25 synthetic screenshots are in artifact `11657590323` (7-day retention); the desktop approval confirmation screenshot was downloaded and visually inspected. No private image or screenshot was added to the repository.

## Editable settings follow-up

The controlled settings implementation passes **178 deterministic tests**, TypeScript, production build and lint. Strict browser and Electron integration verification passed on [`f86e76e`](https://github.com/charlzyx/bb/commit/f86e76e2d3913e46e3ffa0de900b52fbfb74092b) in [CI run 38009952957](https://github.com/charlzyx/bb/actions/runs/38009952957); all verification steps ran, none were skipped.

Earlier Electron runs checked renderer sandbox preferences only: Playwright on Linux implicitly added `--no-sandbox`, so those historical runs did not establish process-level sandboxing. The current smoke explicitly sets `chromiumSandbox: true`, checks the real application command line contains no `no-sandbox` switch, and checks the secure renderer's Linux kernel `Seccomp: 2` and `NoNewPrivs: 1` state. It also attempts to open DevTools and verifies that they remain closed. These checks establish this Linux fixture run, not an exhaustive sandbox audit or verification on macOS. Production security preferences were never relaxed.

Coverage includes source-fenced isolated credential windows, no existing-secret echo, credential replacement only into a synthetic daemon, secret-free main renderer and confirmation details, stale revision/account/connection failures, exact native confirmation, full-rule policy review, MCP whole-file caveats, readback races, cancellation, TTY-only CLI writes and unknown-outcome no replay. The latest upstream target is `egoist/lorca@b975eb6056b01bf7f2058b5c5e9ffc22e9930eea`; new shared-link fragment keys and playbooks remain excluded from renderer projection, with regression coverage.

The run produced 25 synthetic PNGs in artifact `11652917905` (7-day retention). Desktop model/Runner configuration and confirmation, MCP, automatic approval and its final confirmation controls, connection settings, and the dedicated secure provider window were actually viewed after download. Chinese typography was readable and no blocking overlap was observed. No PNGs were added to the repository; these are fixture screenshots, not user data or live provider verification.

This phase does not use the user's Mac or live service. macOS native confirmation and production-provider compatibility remain to be tested later with the user. Credentials are entered only into a dedicated local sandboxed window with an ephemeral session; no existing key/raw MCP config is returned to the main renderer. Unknown default provider destinations require an explicit URL. MCP file-writing changes may apply unrelated pending on-disk edits, as documented in the editable-settings contract.

## PC audit follow-up

The subsequent audit on [`3a075ee`](https://github.com/charlzyx/bb/commit/3a075ee19cd9c767328d2a3fb798b26ec81da7e3) passes **212 tests**, types/build and lint, plus five fork-scope guard tests. It fixes:

- Successful send acknowledgements no longer inherit a concurrent stop/history error.
- Discarded attachments release opaque native handles without deleting files; same-endpoint Save preserves valid selections, and active sends retain their handles until completion.
- Late history responses/errors cannot unlock or overwrite a newer pagination request.
- Exact-tool approval rules clearly label text as a note, not a condition; duplicate exact tools are rejected. Unknown outcomes retain the policy draft and lock resubmission, with explicit readback/adoption and account-bound cleanup.
- Unknown devices with empty descriptions no longer disable every settings editor. Existing MCP entries can be disabled without interpreting their saved URL as new credentials; reconnect explicitly rebuilds the cached connection with native confirmation.
- Provider disconnect descriptions match account-wide scope and possible token revocation.

The browser smoke includes interruption, conflict, unknown-readback and successful-send/concurrent-stop regressions. [Run 38012113600](https://github.com/charlzyx/bb/actions/runs/38012113600) passed its browser and strict-sandbox Electron checks. Its desktop chat, model, MCP, approval and isolated credential-window screenshots were actually inspected after download.

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
- macOS source-run verification found that the system application menu and About icon still belong to the Electron host bundle. The app window, sidebar and explicit About product name use dots. The native About product version is now explicitly 0.1.0. A new isolated local packaging script supplies dots bundle metadata and an ICNS icon; a previous development bundle was generated and passed ad-hoc verification on the Mac. The updated optical bounds and multiresolution icon still need a rebuilt bundle and visual acceptance. It uses local ad-hoc signing only, with no Developer ID or notarization, and does not change Lorca data/token lookup. See [local macOS packaging instructions](../apps/lorca/README.zh-CN.md#macos-独立本地开发包).
- The macOS packaging follow-up passed 105 local tests, TypeScript, production build and lint. Its two new packaging tests verify ICNS format, runtime-only file selection, no-overwrite behavior and command isolation using a synthetic Electron bundle; they do not execute Apple tools on Linux.
- Browser and Electron checks use synthetic fixtures; passing them does not prove compatibility with every live daemon version.

## Protocol limitation

Lorca provides no event revision or snapshot barrier. Buffered replay has terminal-state/prefix protections but cannot prove a total order for every conflicting snapshot/event pair. See [the protocol ordering limit](lorca-protocol.md#snapshot-ordering-limit). Rust remains the authority for permissions and queued-message execution.
