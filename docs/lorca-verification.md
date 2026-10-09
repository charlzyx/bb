# Lorca integration verification

Verified on 2026-10-09. This is an experimental client, not a packaged release.

## Passed

- Focused frozen-lock dependency installation, including a fresh offline reinstall
- Turbo test, TypeScript and production renderer build: **59 tests passed**
- Native bridge suite repeated 100 consecutive times: **2,000 tests passed**
- Native JavaScript syntax checks and command-line help without connecting
- Root lockfile consistency checked with pnpm 9 frozen/offline resolution in a detached manifest-only workspace
- Existing root dependency resolutions preserved; only the Lorca importer and required new lock records added
- Turbo lint: zero warnings and zero errors
- Diff whitespace checks

The tests cover request correlation, authentication and Origin behavior, explicit legacy mode, schema drift, unknown mutation outcomes, no replay, account/connection races, opaque file-selection races, bootstrap buffering, message replacement, queued acknowledgements, pagination, multi-job state, markdown safety, approval capability controls, attachment display, and BB theme/utility compilation.

All protocol tests use deterministic fixtures, isolated local mock WebSockets and temporary fake tokens. No live user account, relay, model call or production service was tested or modified.

## Browser and Electron verification

The dedicated [Lorca CI run on 7eaea19](https://github.com/charlzyx/bb/actions/runs/37977149584) passed all steps, including real Chromium browser smoke and real Electron main/preload/UI against an authenticated mock daemon. Its eleven synthetic screenshots were downloaded and visually inspected at desktop and mobile widths; the run’s `lorca-synthetic-screenshots` artifact contains the original PNGs (requires GitHub sign-in; retained for 7 days). Desktop chat, approval, empty state, and Electron bridge views showed no obvious overflow. The mobile settings capture waits for the endpoint input and settled drawer. Its recaptured image shows the complete settings content. The Electron screenshot confirms named bot headers and a synthetic send/reply through the actual native bridge.

The screenshots cover desktop light/dark chat, empty state, approval, disconnected state, mobile light/dark chat, empty state, chats/settings drawers, and the actual Electron bridge. PNGs are not committed to this repository. To regenerate them, use the smoke commands below in a supported browser environment.

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

## Remaining runtime limits

- No real Lorca identity, relay, model provider, native file transfer, or production service was exercised.
- macOS packaging, signing, and a real macOS desktop launch remain unverified.
- Browser and Electron checks use synthetic fixtures; passing them does not prove compatibility with every live daemon version.

## Protocol limitation

Lorca provides no event revision or snapshot barrier. Buffered replay has terminal-state/prefix protections but cannot prove a total order for every conflicting snapshot/event pair. See [the protocol ordering limit](lorca-protocol.md#snapshot-ordering-limit). Rust remains the authority for permissions and queued-message execution.
