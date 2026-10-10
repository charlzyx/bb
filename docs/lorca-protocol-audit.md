# Lorca protocol coverage audit

## Target and evidence

- Upstream: [`egoist/lorca` `3cc900f521662e9cc039d85a1099767b16ef91a4`](https://github.com/egoist/lorca/commit/3cc900f521662e9cc039d85a1099767b16ef91a4), **Editable email and Slack drafts in chats (#145)**, committed 2026-10-10T04:10:57Z. `git ls-remote origin HEAD refs/heads/main` returned this exact SHA on 2026-10-10 at approximately 04:16 UTC; the commit was fetched and inspected locally.
- dots audit baseline: [`charlzyx/bb` `560ca0cc62c8f67d90e4239668aae6c02fd8fd29`](https://github.com/charlzyx/bb/commit/560ca0cc62c8f67d90e4239668aae6c02fd8fd29). Findings below distinguish that baseline from follow-on local fixes. This audit does not assert those fixes have been published or passed desktop CI.
- Upstream still declares [Cargo version **0.1.11**](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/Cargo.toml#L14-L15). The previously accepted `b975eb6` has the same package version. These are pinned source revisions, not two officially versioned WebSocket protocols.
- Review method: public source fetch, source/diff inspection, local synthetic controller regressions. No real daemon, provider/model call, account, credentials, relay registration or user-computer access.

The [detailed wire contract](lorca-protocol.md) retains explicitly labeled `b975eb6` line references. All upstream links in **this** document use `3cc900f`. Existing [editable settings documentation](lorca-editable-settings.md) remains useful for unchanged methods; this audit supplies the latest-source comparison.

## Findings and bounded priorities

| Finding at `560ca0c` | Effect | This iteration / recommendation |
| --- | --- | --- |
| No `chats.mark_read` or `ui.watching`; `unread_count` is dropped | Reading in dots does not clear the daemon/paired-device unread count; a frontmost chat may still trigger phone pushes | Implemented locally through one narrow, main-process-controlled visible-chat capability, with actual window focus/visibility, known-chat and account/generation checks; source and synthetic tests reviewed |
| History loading/error is global and is not invalidated when switching chats | An outstanding page for A blocks B's history button; A's later error appears while B is selected | Fixed locally by resetting history request generation/loading state on navigation and binding late replies/errors to selected chat/navigation; ten pagination regressions pass |
| Tool-call `is_running` is treated as terminal-session state | A returned tool call whose command remains `running` or `waiting` can show green “complete” | Fixed locally by treating `run.state` checking/running/waiting as active; this is status accuracy, not a terminal-control feature |
| New `permission.tool = secret` looks like ordinary Allow/Always permission | Buttons cannot collect the required values and produce failed/inappropriate requests | Local controller change disables Allow/Always, explains that secure input belongs in Lorca, and retains Deny. Native generic RPC still rejects `values` |
| `relay_connected` is labeled “synced” | A transport connection is mistaken for account/history sync completion | Local wording changes this to “connected”; there is no general sync-complete boolean here |
| New `draft` body is unsupported | Draft recipients/body/state are unavailable in dots | Explicit fallback directs the user to Lorca; no sending, approval, discard or “always send” API is exposed |

The first three are current chat-behavior defects, rather than reasons to expand into unrelated application features. Additional bounded gaps are listed below; they are not promises of implementation.

Baseline references: [native allowlist](https://github.com/charlzyx/bb/blob/560ca0cc62c8f67d90e4239668aae6c02fd8fd29/apps/lorca/native/bridge.cjs#L7-L67), [message/chat projection](https://github.com/charlzyx/bb/blob/560ca0cc62c8f67d90e4239668aae6c02fd8fd29/apps/lorca/native/settings.cjs#L169-L224), [message presentation](https://github.com/charlzyx/bb/blob/560ca0cc62c8f67d90e4239668aae6c02fd8fd29/apps/lorca/src/core/controller.ts#L36-L128), [navigation](https://github.com/charlzyx/bb/blob/560ca0cc62c8f67d90e4239668aae6c02fd8fd29/apps/lorca/src/core/controller.ts#L783-L801), [history loading](https://github.com/charlzyx/bb/blob/560ca0cc62c8f67d90e4239668aae6c02fd8fd29/apps/lorca/src/core/controller.ts#L954-L986).

## Upstream changes since `b975eb6`

Four commits intervene: Stop propagation (`ed6dcc1`), secret requests (`27b7a72`), routine triggers (`aa214c8`), and message drafts (`3cc900f`). Direct diff inspection finds no changes to `ws.rs`, `config.rs`, `files.rs`, `events.rs`, `credentials.rs`, `provider_auth.rs`, or `plugins/mcp_json.rs`.

The selected provider/MCP/auto-review request shapes and bot model/Runner patch fields remain compatible. Relevant additions are `permission.secret`, `chats.permission.values`, `Body::Draft`, `BotPermissions.drafts`, `bots.update.drafts`, and `secrets.list/set/delete`. Stop behavior becomes broader without changing its request/result. The event envelope is unchanged: draft cards arrive as ordinary message additions/updates, not a new event family. See [API changes](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/api.rs#L812-L831), [message model](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/model.rs#L319-L419), and [event model](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/events.rs#L10-L72).

## Transport, identity and relay

| Surface | Latest contract | dots coverage / boundary |
| --- | --- | --- |
| Local WebSocket | Loopback `/ws`; exact Bearer token from selected daemon home; reject any Origin; validate Host | Main-process token read and loopback-only endpoint; token absent from renderer; no automatic auth downgrade |
| Frames | `{id,method,params}` → `{id,result}` or `{id,error:{message}}`; events `{event,data}`; concurrent results can reorder | Pending-ID map, timeout, reconnect generation and no mutation replay. This is not JSON-RPC 2.0 |
| `hello {}` | Version, identity state, `device_id`, relay state and raw diagnostic fields | Safe subset only; no identity creation |
| `bootstrap {}` | Snapshot, plus background model/marketplace refresh checks | Safe projection; do not call it a strictly side-effect-free network-free read |
| `identity.create/restore`, `pair.*`, `identity.forget/delete`, `device.unpair` | Create/restore keys, pair/revoke devices or erase local/account state | Deliberately unsupported; use existing Lorca identity. A reconnect never initializes an account |
| `config.set {relay_url}` | Replaces/clears relay configuration; returns `{relay_url}` | Unsupported; endpoint selection changes only the local WebSocket destination, not relay config |
| `sync.account {}` / `sync.wake {}` | Wait for account provider state / wake relay sync | Unsupported; local WS, relay connectivity, identity presence and model/provider availability remain separate facts |

[`ws.rs:46–176`](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/ws.rs#L46-L176), [`api.rs:94–245`](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/api.rs#L94-L245).

A snapshot's provider `detail`/`base_url`, arbitrary relay errors, MCP config, shared template URLs with keys, and raw attachment records are not safe generic renderer data. Existing native projections intentionally strip these. Boundaries remain stricter than upstream's trusted native client. Payload/count limits are client limits, not daemon protocol guarantees; very large accounts need dedicated capacity testing.

## Chats, history and watching

| Method | Exact useful shape / semantics | dots baseline |
| --- | --- | --- |
| `chats.create` | `{id?,kind?,bot_ids,title?,owner_bot_id?,description?}` → `{chat}`; default group; group 1–6 bots | Allowlisted; new-chat UI uses existing bots |
| `chats.dm` | `{bot_id,id?}` → `{chat}`; reuses the bot's sole DM | Equivalent supported path is `chats.create {kind:"dm",bot_ids:[id]}`; returned existing ID must win over optimistic ID |
| `chats.send` | `{chat_id,text?,message_id?,attachments?,mentions?,reply_to?}` → `{message}`; accepts work, does not await answer | Text and native-picked file send supported. Chosen message ID is not an execution idempotency key |
| `chats.messages` | `{chat_id,before?:messageId,limit?:1..200}` → `{messages,has_more}`; oldest first; default/newest snapshot 60 | Older-page loading supported, with navigation race identified above |
| `chats.search` | `{query,limit?}` → `{chats:[{chat_id,snippet}],messages:[{chat_id,message_id,snippet,author,created_at}]}` | Narrow RPC/SDK/CLI support; full search/navigation UI is not implied |
| `chats.stop` | `{chat_id}` → null; request cancellation for local/remote turns | Supported; wait for subsequent state, not a fabricated successful final answer |
| `chats.send_now` | `{chat_id,message_id}` → `{sent:boolean}`; queued user message in DM only | Supported; `false` is a valid no-longer-held result, not permission to resend |
| `chats.mark_read` | `{chat_id}` → null; clears existing unread count and syncs the read mark | Missing at baseline; now implemented locally through the narrow native capability |
| `ui.watching` | `{chat_id:string|null}` → null; current visible foreground chat | Missing at baseline; now implemented locally; see lifecycle below |
| Rename/pin/description/members/owner/delete | `chats.rename`, `.pin`, `.set_description`, `.add_bot`, `.remove_bot`, `.set_owner`, `.delete` | Unsupported controls; deletion is not a reversible archive |

Sources: [`api.rs:328–590`](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/api.rs#L328-L590), [snapshot paging](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/app.rs#L1950-L2005).

A page may fetch older encrypted history from the relay. If that fetch fails, the daemon can return `has_more:false` temporarily; it is not proof the account has no older history. A later snapshot can restore availability. A roster has metadata but no message pages: preserve loaded transcript/pages for retained chats. Full `message.updated` objects replace rows; they are not text deltas. A send's result can be older than an already-received event; events must not be overwritten by that stale response.

### Required visible-chat lifecycle

`ui.watching` accepts a nonempty `chat_id`; null, absent or empty clears it. It stores one **daemon-global in-memory slot**, with **no TTL or heartbeat** and no per-socket ownership. It does not clear older unread messages itself. `chats.mark_read` clears them, saves state, emits `roster.changed`, and uploads `ClearUnread` when the count changed. While watched, newly completed/countable messages do not increment unread and publish a read mark. **Any WebSocket disconnection clears the global watched slot**, including another client's short-lived connection. These are upstream limitations; dots cannot promise exclusive watcher ownership when multiple clients share a daemon.

Sources: [`api.rs:217–222,592–595`](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/api.rs#L217-L222), [`App::mark_read/watching/upsert_message`](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/app.rs#L1565-L1665), [`ws.rs:176`](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/ws.rs#L170-L176).

The implemented local dots design is one dedicated `setWatchingChat(chatId|null)` IPC. The renderer supplies only a selected, actually presented chat ID or null; main verifies the exact main frame, known chat, current identity and transport generation, and independently checks the real window is focused, visible and not minimized. The watcher serializes/coalesces updates to the slot. On a foreground selection it sets watch and, after the watch acknowledgment while still current, sends mark-read independently so a slow read acknowledgment cannot delay clearing. On blur/hide/minimize, a covering non-chat view, renderer loss or close, it clears its possibly written watch. Reconnect/account changes invalidate prior selection and known IDs until fresh bootstrap. Late completions cannot restore a superseded watch. A failed or timed-out positive watch is treated as possibly written: it gets one bounded null compensation in the current generation, without replaying that positive watch. No initial null is sent before dots has attempted a watch, and a failed clear is not retried in a loop. Raw `ui.watching` and `chats.mark_read` remain unavailable through generic renderer RPC. Multiple clients can still overwrite or clear the daemon-global slot; there is no owner token to prove that a compensation clears only this client’s value.

Upstream reference implementations: [Go native window lifecycle](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/desktop/app.go#L278-L293), [Go watcher](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/desktop/notifier.go#L111-L126), [Go store calls](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/desktop/model/store.go#L2090-L2111), [Mac store call](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/macos/Sources/Lorca/Model/AppStore.swift#L1703-L1708).

## Messages, events and actionable cards

| Wire content | Baseline behavior | Gap / safe behavior |
| --- | --- | --- |
| Text/Markdown, author, seconds timestamp, streamed full replacements | Supported | No hidden-thinking transcript exists in this wire |
| Text `mentions` and `reply_to` quote | Outgoing fields are bridge-valid; incoming fields are projected away; no dedicated composer controls | Reply targeting/context display is partial, not full chat parity |
| Tool `summary/detail/is_running/is_error` | Collapsed tool row; daemon already trims detail to 400 characters and removes raw arguments/results | Never describe this as a complete tool-output inspector |
| Tool `run` | Command/output/reason/rule/state partially retained | `run.state` must win over tool-return state for live terminal sessions; interactive stdin/stop/background controls remain unsupported |
| Permission | Ordinary allow/deny; eligible Always invokes a persistent rule | Access/login cards direct to Lorca. New secret cards must also direct to secure Lorca input |
| Handoff | Notice preserves `from/to/reason` | `from`/`to` are bot IDs; baseline shows raw IDs rather than available bot names |
| Draft | Explicit unsupported-message notice | Safe fallback, but draft body/recipients/state are not readable in dots; no external send interface |
| Output metadata | Underlying text/attachment names survive; `message.output` is removed | Artifact version/evidence/source metadata and file preview are unavailable |
| `job.started/finished` | Job-ID-based running state | `finished` has no success/outcome field; one finished group member does not imply whole chat idle |
| `job.retry`, `job.thinking`, `chat.usage` | Ignored | Retry reason/count, thinking activity and usage missing; never automatically retry the user's send |
| `roster.changed`, message add/update/remove, chat removal, identity/relay events | Reviewed subsets supported | Settings inventory is refreshed explicitly; every roster field is not forwarded to UI |
| Auth/pair/review/task/attention/budget/project/feedback events | Ignored | Do not automatically expose URLs, capabilities or raw payloads |

[Latest message model and `for_app`](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/model.rs#L259-L419), [event definitions](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/events.rs#L10-L94). Upstream tests explicitly prove `is_running:false` while [waiting for input](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/turns.rs#L4246-L4255) or [running in the background](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/turns.rs#L4801-L4809). A denied/dismissed call may carry `is_error:true`; do not assume every non-complete run state currently appears green.

### Secret requests and drafts

A secret request is still a permission body: `tool:"secret"`, `secret:{use:"browser"|"command"|"plugin",site?,fields:[{name,label}]}`. Saving uses `chats.permission {chat_id,message_id,decision:"allow",values:{NAME:value}}`; Deny carries no values. Missing values do **not** grant the request: the Runner validates/stores them before answering. New values must never enter ordinary chat text, renderer inventory, error strings or a generic form. `secrets.list {runner_id}` returns metadata without values; `.set {runner_id,id,value}` and `.delete {runner_id,id}` remain unsupported. See [secret lifecycle](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/docs/architecture/secrets.md#answering) and [permission receiver](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/plugins/mod.rs#L1072-L1104).

Draft body: `{kind:"draft",review_id,version,state,plugin_id,account,draft:{kind,to,cc?,bcc?,subject?,body,attachments?,reply?},note?,direct}`. States include pending/approved/executing/succeeded/failed/rejected/cancelled/uncertain. Editing/sending is version-bound through `reviews.edit` then `reviews.approve`; rejection uses `reviews.reject`. `bots.update {id,drafts:false}` changes future direct sending for that bot. These are consequential external-communication/authorization actions, not ordinary text send. This iteration preserves fallback and exposes none of those writes. [Latest draft contract](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/docs/architecture/drafts.md#the-card).

### Stop does not mean all processes ended

The unchanged `{chat_id} → null` API now cancels the turn's model/tools and propagates cancellation through that turn's outstanding handoffs. A tool that will not return is cut off after about 15 seconds; an ignored cancellation may leave external work running. Background commands, idle browser profiles, already-staged drafts/reviews and an offline Runner until it reconnects can remain. dots preserves ordinary Stop but does not implement a full process/terminal manager. [Latest Stop contract](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/docs/architecture/stopping.md).

## Attachments, avatars and source links

- `chats.send.attachments` is an array of **daemon-local** `{path,id?,name?,mime?,width?,height?}`. The daemon stores up to 100 MiB per file and returns Attachment `{id,name,mime,size,width?,height?}`. dots uses native file selection, opaque selection IDs and main-only paths; up to 10 files per send. This is compatible and does not expose arbitrary paths through renderer RPC. [Outgoing file/store](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/files.rs#L16-L82).
- Incoming attachment **names only** are shown. There is no download/open/save/inline-preview API in dots. Upstream `files.path {attachment,named?:true}` returns a local path and can register/reuse a relay bearer, download encrypted bytes, decrypt and create a local/named file. It is not a no-side-effect path lookup. Any future implementation needs its own selected-message/attachment native boundary, native save/open UX and explicit resource policy. [Fetch/cache behavior](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/files.rs#L106-L146).
- Bots alone have custom avatar Attachments. dots reads only already-cached legal IDs beneath the configured daemon home and returns validated/re-encoded bounded PNG via an expected-version/account/generation-fenced capability. It never calls `files.path` for avatars. User/system fallback and combined bot appearances do not imply separate upstream user/group image fields.
- Reply source URLs generally live in Markdown text; there is no separate generic `sources[]` field in these message bodies. The upstream integration contract asks bots to retain clickable permalinks. dots currently renders safe links as a **noninteractive span with a title**, and remote images as references, so sources can be seen but not opened as links. This is an intentional external-navigation restriction and a useful chat-parity gap, not a transport parsing failure. [Upstream source semantics](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/docs/architecture/integrations.md#tool-selection-review-and-sources), [dots Markdown boundary](https://github.com/charlzyx/bb/blob/560ca0cc62c8f67d90e4239668aae6c02fd8fd29/apps/lorca/src/ui/markdown.tsx#L64-L95).

## Runner, bot, provider and MCP settings

These selected mutations remain shape-compatible with the latest source. A settings action runs through strict DTO validation, a main-owned expiring revision ticket, fresh reads before and after native confirmation, identity/connection fencing and one submission. Existing secrets do not return to ordinary renderer. The upstream methods below have **no compare-and-swap revision parameter**: these client checks reduce stale writes but cannot eliminate a write racing the final read. A daemon success acknowledges its operation, not provider/MCP health or future task success. Timeout after submit is unknown outcome, with no automatic replay.

| Area | Latest methods / fields / result | dots scope |
| --- | --- | --- |
| Inventory | `bootstrap {}`: devices/providers/bots/models/auto_review; `mcp.list {runner_id?}` | Sanitized dedicated `getSettings`; provider connected state and device online status are daemon reports, not live connection tests |
| Bot model / Runner | `bots.update {id,provider?,model?,thinking?,runner_id?}` → `{bot}` | Supported controlled edits; applies bot-wide across all chats and future work, not just selected chat. Pure Runner change does not require a connected provider |
| Bot profile / creation / Access | `bots.create`, `.delete`, `.permissions`; `.update` also accepts name/description/avatar/workdir/permissions/drafts | Not exposed by current editor. A blank model/thinking clears default; omitted/null keeps. Do not replace the whole permissions object incidentally |
| Built-in API-key providers | `providers.connect_deepseek/anthropic/opencode/opencode_go {api_key,base_url?}` → `{providers}` | Secure native editor; blank input preserves known existing credentials. Configuration can validate network access and sync account credentials |
| Custom provider | `providers.connect_custom {kind?,name,api,base_url,api_key,models:string[]}` → `{kind,providers}` | Add/edit supported for bounded API types; a blank model editor preserves an existing catalog. The raw API defaults missing `models` to an empty list. `kind` selects an existing provider |
| Credential read | `providers.api_key {kind}` → `{api_key,base_url}` | Main-only on demand; raw result never passes generic renderer RPC |
| Model discovery | `providers.list_models {name,api,base_url,api_key}` → `{listed,models}`; `models.reload {}` → `{updated,changed}` | Not generic renderer methods; editor uses sanitized available catalogs rather than promising a live probe |
| Disconnect / subscription login | `providers.disconnect {kind}` → `{providers}`; ChatGPT/Grok connect and auth.cancel | Confirmed disconnect supported; OAuth login/callback workflow unsupported |
| MCP save/edit | `mcp.save {runner_id?,name,config,previous_name?}` → `{path,server}` | Secure native patch editor merges locally, then sends full single-server replacement; unchanged-name edit still sends `previous_name` |
| MCP state/remove | `.set_enabled {name,enabled}` → get-shaped; `.remove {name}` → null | Supported with target Runner; disable keeps config/sign-in, remove also deletes plugin storage/credentials and associated rules |
| MCP reconnect/reload | `.reconnect {name,fresh:true}` → get-shaped; `.reload {}` → list-shaped | Supported subject to current capability state. Reconnect may restart processes; failure can be returned as `server.status:error` despite RPC success. Reload applies whole disk file |
| MCP detail/tool exposure/OAuth | `.get`, `.hide_tool`, `.sign_in`, `.sign_out`, `.parse`; plugin install/config/login methods | Raw detail/config/tool lists and OAuth not exposed to ordinary renderer. Plugin roster is read-only; tool counts can be null |
| Auto-review | `auto_review.set {is_enabled?,rules?,provider?,models?}` → `{auto_review}` | dots edits enabled/rules only; keeps separate review provider/model selection unchanged |

Sources: [bot mutations](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/api.rs#L250-L325), [auto-review](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/api.rs#L761-L808), [providers](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/api.rs#L850-L945), [MCP responses](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/plugins/mcp_json.rs#L1347-L1449).

Important constraints:

1. MCP list/get contains unmasked config, paths, environment variables, headers, arbitrary fields and errors. The native projection retains names/transport/enabled/state/counts/error booleans only. `mcp.list` uses the daemon's loaded config; save/toggle/remove read the current disk file, so unpreviewed edits by other clients can be applied together. Current native confirmation warns about whole-file scope. [MCP reads/writes](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/plugins/mcp_json.rs#L1095-L1209).
2. A cached MCP file error disables dots management, including reload, until the daemon state is repaired/refreshed elsewhere. This is a current recovery limitation, not proof reload is unsupported upstream.
3. Remote Runner requests normally wait 20 seconds; MCP reconnect allows 150 seconds upstream, while dots bridge defaults to 30 seconds. Slow reconnects can legitimately return unknown outcome in dots. Do not automatically repeat; refresh status before any manual retry. [Runner request timeout](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/requests.rs#L17-L55), [MCP timeout](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/plugins/mcp_json.rs#L1435-L1440).
4. Auto-review rules replace the entire list. Exact `tool` matching does not interpret the rule text as a condition; text is a note for that exact-tool override. Read-only plugin operations can bypass review. New chat message-drafting behavior precedes auto-review when the bot's drafts policy is on; changing auto-review does not switch that policy. [Tool review boundary](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/crates/cli/src/plugins/mcp.rs#L2164-L2208).
5. Moving a bot's Runner changes future execution, does not migrate active tasks, and does not copy Runner-owned secret storage; the latest daemon may ask for those secrets again on the new Runner. Account provider credentials, in contrast, sync across paired devices. [Secret storage scope](https://github.com/egoist/lorca/blob/3cc900f521662e9cc039d85a1099767b16ef91a4/docs/architecture/secrets.md#the-store).

## Explicitly outside this chat-client audit's implementation scope

Projects/shared context, IDE/workspace/terminal management, checkpoints, durable-task orchestration, routines/watches/calendar/webhooks, browser takeover, marketplace/workflow/template/playbook editing, identity enrollment/recovery, relay reconfiguration, and full secret/draft management are not automatically required just because upstream provides them. Their metadata/events stay omitted unless a separately reviewed feature needs them. This audit does not authorize those operations or broaden the renderer bridge.

The immediate acceptance work is accurate existing chat state, safe fallback for additive message kinds, bounded history navigation and foreground read/watch behavior. Full read-only draft rendering, source-link opening, attachment viewing, reply/mention UI and detailed retry/usage presentation are identifiable chat-parity candidates for later explicit scope decisions.

## Local verification status

The follow-on implementation was independently source-reviewed after the first unknown-acknowledgment watch cleanup race was fixed. The dedicated watcher tests cover initial/known-chat admission, unknown or malformed IDs, foreground transitions, serial/coalesced changes, slow mark-read, one-shot cleanup after unknown watch outcomes, reconnect/identity fences, removal and disposal. Actual `main.cjs` VM tests cover the new IPC's exact-frame check, pre-bootstrap/unknown-chat refusal, focus/hide/minimize/restore, explicit null and close on all three platform configurations. They preserve sandbox, context isolation and disabled Node integration.

Independent targeted run: **107/107 passed** across `native-watching.test.ts`, `pagination-race.test.ts`, `core.test.ts`, `attachment-lifecycle.test.ts` and `native-settings.test.ts`; the pagination file preserves its original six cases and adds four navigation/merge cases. JavaScript syntax and `git diff --check` passed. These are synthetic/local checks, not a full CI or actual desktop/daemon pass. Publication, the aggregate build/typecheck/lint result and real Electron smoke execution must be checked separately for the final commit. No private account values, actual user bot names or local credential contents were used in this document or these fixtures.
