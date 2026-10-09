# BB for Lorca

An additive, chat-first desktop surface in the BB fork. It uses BB's existing shared components and theme, with the local Lorca CLI as the backend.

**Status: experimental integration.** See [current verification status](../../docs/lorca-verification.md). Upstream BB remains available and unchanged. Lorca owns identity, encryption, relay sync, models, permissions, tools, and Runner execution. This app neither replaces that backend nor talks directly to a model provider.

## Run

From the repository root, use Node 22.19+ and pnpm 9.15:

```sh
pnpm install
pnpm exec turbo run build --filter=@bb/lorca
pnpm --filter @bb/lorca desktop
```

Start and configure your Lorca CLI separately. The desktop connects to `ws://127.0.0.1:4862/ws` and reads the existing `~/.lorca/serve-token` in its main process. It does not create or restore an identity, copy any account, launch a Runner, or change your relay configuration.

For an isolated development CLI:

```sh
LORCA_HOME="$HOME/.lorca-dev" LORCA_PORT=4863 pnpm --filter @bb/lorca desktop
```

Select the matching loopback endpoint in Connection settings. The home is launch-time configuration; it is never editable by untrusted transcript content. Use the same home and port as your CLI.

### Older charlzyx Lorca fork

The pinned older fork has no local WebSocket authentication. To deliberately connect to that version:

```sh
LORCA_ALLOW_LEGACY=1 pnpm --filter @bb/lorca desktop
```

This is **explicit legacy mode** and is visibly labeled in the app. It remains loopback-only. There is no automatic fallback after a missing token or authentication failure. The older daemon itself allows unauthenticated local requests; this UI cannot add authentication to that daemon. Prefer the newer authenticated Lorca CLI when practical.

### Browser preview

```sh
pnpm --filter @bb/lorca dev
```

Open `http://127.0.0.1:5178/?demo=1` for a read-only synthetic preview. It does not read your account, make model calls, or schedule anything. The ordinary browser route displays desktop-connection guidance. A webpage cannot connect directly to the authenticated Lorca CLI: it rejects Origin headers and requires a bearer token that never belongs in a renderer.

## Architecture

```text
BB shared UI → typed controller/store → context-isolated preload
                                         ↓ narrow IPC
                                  Electron main process
                                         ↓ local WS + bearer
                                  Lorca CLI → encrypted relay / Runner
```

The preload exposes a small allowlisted chat API. Identity secrets, provider credentials, tokens, arbitrary filesystem paths, and shell execution APIs are not exposed to the renderer. Native file picking uses opaque handles, resolved to local files only in the main process. No account data is persisted in browser storage by this app.

Read [Protocol and compatibility](../../docs/lorca-protocol.md) for exact RPC mappings, snapshot/event semantics, pinned source versions, and security assumptions.

## Scope

| Feature | Status |
| --- | --- |
| BB typography, theme, shared buttons/icons/drawers/timeline | Reused source |
| Existing bot roster and conversations | Supported |
| New direct chat with an existing bot | Supported |
| Text send and complete-message streaming updates | Supported |
| Stop and queued direct-chat Send now | Supported |
| Older history pagination | Supported |
| Multi-job working state | Supported |
| Permission allow once / explicit always / deny | Supported for ordinary action cards |
| Native selected-file attachments | Supported via main-process bridge |
| Existing group transcript and sending | Supported |
| Create/manage groups or bots | Use Lorca's existing app/CLI |
| Identity creation, restore, pairing, provider sign-in | Use Lorca's existing app/CLI |
| Access-management and OAuth permission cards | Displayed; complete in Lorca |
| Download/open attachment bytes | Metadata displayed; use Lorca |
| Interactive terminals/browser sessions | Activity displayed; controls remain in Lorca |
| Reviews, tasks, budgets, routines, MCP settings | Remain owned by Lorca; dedicated UI not included |
| Bundled CLI, signed installer, automatic updates | Not packaged in this experimental integration |

The renderer controller is the programmatic surface for the same operations used by UI. The existing Lorca CLI is the command-line surface for account/runtime operations. This integration does not add a second implementation of those operations to BB's server or host daemon.

## Programmatic and command-line surface

The same `LorcaBridge` exported by `native/bridge.cjs` is used by the desktop and `bb-lorca` command; both share endpoint validation, the RPC allowlist, authentication, request correlation, and no-replay behavior. The renderer SDK is `src/core/bridge.ts` and `LorcaController`, used directly by the UI.

```sh
pnpm --filter @bb/lorca cli --help
pnpm --filter @bb/lorca cli hello
pnpm --filter @bb/lorca cli chats.messages '{"chat_id":"YOUR_CHAT_ID","limit":60}'
```

A CLI command performs only the explicitly named request. Chat mutation commands can start real work and should be run deliberately; help does not connect. The ordinary BB CLI/server remains unchanged.

## Verification

```sh
pnpm exec turbo run test typecheck build --filter=@bb/lorca
```

Tests use deterministic protocol fixtures and isolated local mock WebSockets with fake tokens. They must never contact a real relay or model provider. Synthetic UI screenshots are under `docs/lorca-screenshots/`. The verification report records exactly what ran and any remaining limits.

## License

BB is MIT licensed, copyright © 2026 Michael Yong. The repository root LICENSE is retained; shared BB components are imported directly rather than copied without attribution. Lorca source was inspected to implement the wire contract; its Rust runtime and identity/crypto implementation are not copied or rewritten here.
