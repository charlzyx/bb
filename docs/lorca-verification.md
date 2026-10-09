# dots client verification

Verified on 2026-10-09. This is an experimental client, not a packaged release.

## Passed

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

The local build environment still prevents browser socket creation, so runtime verification uses the normal sandboxed CI environment. No security isolation was disabled.

Repeatable scripts are included for a normal browser/desktop environment:

```sh
node apps/lorca/scripts/focused.mjs install
node apps/lorca/scripts/focused.mjs check
node apps/lorca/scripts/focused.mjs preview
node apps/lorca/tests/ui-smoke.mjs
```

The browser smoke script covers synthetic desktop/mobile light/dark states, empty/chat/approval/offline layouts, overflow, keyboard shortcuts, drawer dismissal, failed-send draft retention and late acknowledgements after edits/navigation. It makes no real agent calls. It writes screenshots to `docs/lorca-screenshots/` only when a real browser run succeeds.

`tests/electron-smoke.mjs` separately uses the real Electron main/preload/UI with an authenticated mock daemon and an isolated temporary home. It checks renderer isolation and performs exactly one synthetic send. It requires a normally installed Electron binary and a supported graphical environment, such as Xvfb on Linux; it passed in the linked CI run.

The single-Linux `.github/workflows/lorca.yml` runs the focused checks, browser smoke and authenticated Electron mock smoke with the normal sandbox, then retains synthetic screenshots as a short-lived artifact. The dedicated workflow passed in the linked run. No Actions settings were changed as part of this implementation. Inherited upstream workflows are separate and are not evidence for this Lorca client.

## Desktop settings scope

The [settings contract](lorca-settings.md) compares the pinned current and legacy protocols. The UI can connect to a canonical local endpoint and change appearance for the current app session. Runners, provider configuration, bot assignments and MCP inventory are **read-only daemon reports**, not live health checks. API keys/OAuth, grants, automatic approval policy, relay changes, Runner assignment and MCP editing remain outside this UI. Unknown cached tool counts stay unknown.

## Remaining runtime limits

- Cloud development and CI exercised no real Lorca identity, relay, model provider, native file transfer, or production service. A separate authorized macOS source-run check connected to an existing daemon and verified read-only chat/history/settings access; no new agent message was sent.
- macOS source-run verification found that the system application menu and About icon still belong to the Electron host bundle. The app window, sidebar and explicit About product name use dots. The native About product version is now explicitly 0.1.0. A new isolated local packaging script supplies dots bundle metadata and an ICNS icon; its real macOS signing, launch and native appearance are not yet verified. It uses local ad-hoc signing only, with no Developer ID or notarization, and does not change Lorca data/token lookup. See [local macOS packaging instructions](../apps/lorca/README.zh-CN.md#macos-独立本地开发包).
- The macOS packaging follow-up passed 105 local tests, TypeScript, production build and lint. Its two new packaging tests verify ICNS format, runtime-only file selection, no-overwrite behavior and command isolation using a synthetic Electron bundle; they do not execute Apple tools on Linux.
- Browser and Electron checks use synthetic fixtures; passing them does not prove compatibility with every live daemon version.

## Protocol limitation

Lorca provides no event revision or snapshot barrier. Buffered replay has terminal-state/prefix protections but cannot prove a total order for every conflicting snapshot/event pair. See [the protocol ordering limit](lorca-protocol.md#snapshot-ordering-limit). Rust remains the authority for permissions and queued-message execution.
