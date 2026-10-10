# dots — a Lorca protocol client

[简体中文说明](README.zh-CN.md) · The interface defaults to Simplified Chinese; user/tool content and protocol identifiers retain their original text.

An additive, chat-first desktop surface in the BB fork. It uses BB's existing shared components and theme, with the local Lorca CLI as the backend.

**Status: experimental integration.** See [current verification status](../../docs/lorca-verification.md). Upstream BB remains available and unchanged. Lorca owns identity, encryption, relay sync, models, permissions, tools, and Runner execution. This app neither replaces that backend nor talks directly to a model provider.

## Run

Use Node 22.19+ in a fresh checkout. The focused toolchain has its own frozen lock and avoids installing unrelated BB mobile/server dependencies:

```sh
git clone --branch feat/lorca-desktop https://github.com/charlzyx/bb.git
cd bb
node apps/lorca/scripts/focused.mjs install
node apps/lorca/scripts/focused.mjs check
node apps/lorca/scripts/focused.mjs desktop
```

`check` runs tests, TypeScript and the production build through Turbo. The first explicit `desktop` launch downloads the official Electron runtime if it is missing. The focused installer does not overwrite an existing root node_modules directory; use a fresh checkout or the ordinary workspace commands in that case.

An existing full BB development checkout can use `pnpm exec turbo run build --filter=@bb/lorca` and `pnpm --filter @bb/lorca desktop` when its dependencies are available.

Start and configure your Lorca CLI separately. The desktop connects to `ws://127.0.0.1:4862/ws` and reads the existing `~/.lorca/serve-token` in its main process. It does not create or restore an identity, copy any account, launch a Runner, or change your relay configuration.

For an isolated development CLI:

```sh
LORCA_HOME="$HOME/.lorca-dev" LORCA_PORT=4863 node apps/lorca/scripts/focused.mjs desktop
```

Select the matching loopback endpoint in Connection settings. The home is launch-time configuration; it is never editable by untrusted transcript content. Use the same home and port as your CLI.

### Older charlzyx Lorca fork

The pinned fork compatibility reference has no local WebSocket authentication. To deliberately connect to an installation verified to have that behavior:

```sh
LORCA_ALLOW_LEGACY=1 node apps/lorca/scripts/focused.mjs desktop
```

This is **explicit local compatibility connection (no token validation)** and is visibly labeled in the app. It remains loopback-only. There is no automatic fallback after a missing token or authentication failure. An unauthenticated daemon itself allows unauthenticated local requests; this UI cannot add authentication to that daemon. Prefer local token authentication when supported by the installed daemon. These connection choices describe behavior, not official protocol generations; a release number alone does not establish the installed binary’s authentication behavior.

### Browser preview

```sh
node apps/lorca/scripts/focused.mjs dev
```

Open `http://127.0.0.1:5178/?demo=1` for a synthetic preview with in-memory settings changes. It does not read your account, make model calls, or schedule anything. The ordinary browser route displays desktop-connection guidance. A webpage cannot connect directly to the authenticated Lorca CLI: it rejects Origin headers and requires a bearer token that never belongs in a renderer.

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

Read [Settings and runtime inventory](../../docs/lorca-settings.md) for the pinned-reference capability matrix, native redaction contract, and which preferences are editable. Connection and appearance are local session preferences. Runtime inventory remains a sanitized daemon report, not a health test. The separate [editable settings contract](../../docs/lorca-editable-settings.md) covers bot-wide model/Runner changes, controlled provider/MCP configuration and explicit account-wide approval policy updates. Persistent changes use native confirmation and session-bound revision checks; secrets never enter the ordinary renderer. MCP file writes/reload can also apply unrelated pending on-disk changes and start programs absent from the cached inventory. Native confirmation discloses the whole-file scope; the daemon has no preview/CAS endpoint.

The pinned daemon has one direct conversation per bot. “开始聊天” opens or creates that DM; supplying a new preferred chat ID does not force a separate DM. Existing history remains. Independent group creation is a different upstream operation and is not offered as a workaround for separate direct sessions.

## Avatar resources

Bot avatars are derived from the actual bot roster; group conversations combine bot appearances and bot messages resolve their author. The pinned protocol has no separate user avatar, so user messages use a person fallback. A dedicated main-process capability reads only an observed bot's already-cached image beneath the selected Lorca home, validates its path/format/byte and pixel limits, and re-encodes a small PNG. It exposes no native path, attachment key or arbitrary filesystem reader. Missing/unsupported resources fall back without failing chat; avatar display never registers a device or initiates a relay download. Select a custom daemon home with `LORCA_HOME` at launch.

The selected Ghost artwork supplies the native app/About/Dock icon, using the approved macOS-style continuous-corner mask and seven ICNS resolutions from 16 to 1024 pixels. Its composition and colors are preserved. The sidebar, empty state, favicon and secure-settings brand use the same artwork; actual bot/user avatars are unchanged. See [artwork attribution and reproduction](artwork/NOTICE.md). Rebuild the isolated development bundle to update its icon; an old bundle is unchanged.

## Scope

| Feature | Status |
| --- | --- |
| BB typography, theme, shared buttons/icons/drawers/timeline | Reused source |
| Existing bot roster and conversations | Supported |
| Bot avatars in chat lists, headers and messages | Existing local cache only; safe symbol/color fallback |
| Start chatting with an existing bot | Opens or creates its single DM; preserves existing history |
| Text send and complete-message streaming updates | Supported |
| Stop and queued direct-chat Send now | Supported |
| Older history pagination | Supported |
| Multi-job working state | Supported |
| Permission allow once / explicit always / deny | Supported for ordinary action cards |
| Native selected-file attachments | Supported via main-process bridge |
| Existing group transcript and sending | Supported |
| Create/manage groups or bots | Use Lorca's existing app/CLI |
| Identity creation, restore, pairing, provider OAuth sign-in | Use Lorca's existing app/CLI |
| Access-management and OAuth permission cards | Displayed; complete in Lorca |
| Download/open attachment bytes | Metadata displayed; use Lorca |
| Interactive terminals/browser sessions | Activity displayed; controls remain in Lorca |
| Desktop settings | Session endpoint/theme, sanitized inventory, existing-bot model/Runner edits, controlled provider/MCP editors, explicit auto-review policy |
| Tasks, budgets, routines, per-bot access grants and MCP OAuth/hide-tool | Dedicated editors not included |
| Bundled CLI, signed installer, automatic updates | Not packaged in this experimental integration |

The renderer controller is the programmatic surface for the same operations used by UI. The existing Lorca CLI is the command-line surface for account/runtime operations. This integration does not add a second implementation of those operations to BB's server or host daemon.

### Authentication scopes

The dots-to-daemon connection does **not** use OAuth: it uses the existing local serve-token on daemons that support local token authentication, or explicitly selected local compatibility connection (no token validation). Lorca continues to own its existing relay/device identity and encrypted synchronization protocol. References to optional OAuth sign-in in settings apply only to certain model providers or MCP services; they do not replace or alter either Lorca authentication layer.

## Programmatic and command-line surface

The same `LorcaBridge` exported by `native/bridge.cjs` is used by the desktop and `bb-lorca` command; both share endpoint validation, the RPC allowlist, authentication, request correlation, and no-replay behavior. The renderer SDK is `src/core/bridge.ts` and `LorcaController`, used directly by the UI.

```sh
node apps/lorca/scripts/focused.mjs cli --help
node apps/lorca/scripts/focused.mjs cli hello
node apps/lorca/scripts/focused.mjs cli settings
node apps/lorca/scripts/focused.mjs cli settings '{"runnerId":"YOUR_RUNNER_ID"}'
node apps/lorca/scripts/focused.mjs cli chats.messages '{"chat_id":"YOUR_CHAT_ID","limit":60}'
```

A CLI command performs only the explicitly selected operation. `settings` assembles the same sanitized inventory as the desktop from `bootstrap` and `mcp.list`; it does not reconnect MCP servers or call tools. Native SDK consumers use `SettingsInventory` from `native/settings.cjs`, call `get({runnerId?})` with the same `LorcaBridge`, and dispose the inventory when done. Chat mutation commands can start real work and should be run deliberately; help does not connect. The ordinary BB CLI/server remains unchanged.

### Controlled settings actions

```sh
node apps/lorca/scripts/focused.mjs cli settings-action '{"kind":"bot.update","botId":"YOUR_BOT_ID","model":"MODEL_ID"}'
```

This command accepts nonsecret action DTOs only, obtains a fresh native revision internally, shows the exact scope and requires typing `确认` on an interactive terminal. Redirected/non-TTY writes, supplied revision tokens and `--yes` are rejected. `provider.configure` and `mcp.configure` require the desktop's isolated editor; API keys and raw MCP configuration are never accepted as CLI arguments. Start `focused.mjs desktop` and open dots settings for those actions. Native SDK consumers reuse `SettingsEditor(bridge, inventory, {confirm, openSecureEditor})` from `native/settings-editor.cjs`; no confirmation callback means no writes. A cancellation is not success; `unknownOutcome` must be reconciled by a read before considering any manual retry.

## Verification

```sh
node apps/lorca/scripts/focused.mjs check
```

Tests use deterministic protocol fixtures and isolated local mock WebSockets with fake tokens. They must never contact a real relay or model provider. The repeatable browser smoke script is `tests/ui-smoke.mjs`; screenshots, when generated in a supported browser environment, go to `docs/lorca-screenshots/`. The verification report records exactly what ran and any remaining limits.

## BB source reuse

These are direct imports from the preserved upstream source:

- [Theme, color and typography tokens](../app/src/components/ui/theme.css)
- [Buttons, icons, pills, inputs and responsive drawer](../../packages/shared-ui/src/components/ui)
- [Settings sections, rows and badges](../app/src/components/ui/settings-section.tsx)
- [Sidebar navigation row styling](../app/src/components/sidebar/sidebarRowClasses.ts)
- [Responsive overlay focus and drawer behavior](../../packages/shared-ui/src/components/ui/responsive-overlay.tsx)
- [Conversation timeline](../app/src/components/ui/conversation.tsx)
- dots uses its own four-dot mark; upstream BB logo source and its license remain intact.

The small local Tailwind adapter uses Tailwind's public compiler and scanner APIs to compile that same theme and its utilities, with regression coverage. It avoids the unrelated Babel/source-map dependency branch that blocked the initial full-workspace install.

## License

BB is MIT licensed, copyright © 2026 Michael Yong. The repository root LICENSE is retained; shared BB components are imported directly rather than copied without attribution. Lorca source was inspected to implement the wire contract; its Rust runtime and identity/crypto implementation are not copied or rewritten here.

The current development and acceptance target is upstream egoist/lorca main at `b975eb6056b01bf7f2058b5c5e9ffc22e9930eea`, verified on 2026-10-10. Local token authentication remains the default. The retained explicit unauthenticated compatibility option is historical support, not an acceptance target or an automatic fallback.
