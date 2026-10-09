# Lorca integration verification

## Development checkpoint, 2026-10-09

This branch is work in progress. The first checkpoint publishes the implementation early for review; it is not a release or a claim of production validation.

- 16 protocol/controller/state regression tests passed.
- 20 native bridge/attachment/CLI regression tests passed.
- Native JavaScript syntax checks passed.
- Tests used deterministic fixtures, isolated mock WebSockets and fake temporary tokens only.
- Full dependency installation, aggregate Turbo typecheck/build, browser screenshot QA and Electron runtime QA are pending at this checkpoint.
- The pnpm lockfile update follows dependency resolution; do not use frozen-lockfile against this interim checkpoint.
- No live user account, relay, model call or production service was tested or modified.

The protocol has no revision or snapshot barrier. See the explicit ordering limitation in [the protocol document](lorca-protocol.md). Native and controller race fixes cover account/connection replacement during file picking, file validation, chat creation and bootstrap.
