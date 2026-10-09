# Lorca local WebSocket contract for BB

Verified 2026-10-09 by source inspection. Baseline: `egoist/lorca` commit `2e360b0611a4ddd845090b2c5802a0af421f5855`. Paths/line numbers below refer to this SHA unless marked fork. Read AGENTS.md, ARCHITECTURE.md, protocols.md and runtime.md. No live model calls, production account reads, or service mutations performed.

## Transport and connection

- Native endpoint `ws://127.0.0.1:4862/ws`; server binds IPv4 loopback. Production default home `~/.lorca`, development desktop `~/.lorca-dev` with 4863. CLI flags `--home`, `--port` override `LORCA_HOME`, `LORCA_PORT`, which override defaults. Treat the home/port pair as one explicit configuration. Source config.rs:7–24.
- Every HTTP route refuses **any Origin header**, including `Origin: null`, and Host must case-insensitively equal `127.0.0.1:<actual port>` or `localhost:<actual port>` (403 otherwise). `/ws` additionally requires exact `Authorization: Bearer <trimmed contents of home/serve-token>` (401 otherwise). No query-token auth. Browser JavaScript cannot connect directly; use a trusted native/main bridge. Never reveal token, keys, arbitrary paths, or generalized filesystem APIs to renderer. Sources ws.rs:82–117; config.rs:74–82; serve_ready.rs:136–169.
- `/` returns plain `lorca` as readiness probe, still restricted by Host/Origin. A launcher may use `lorca serve --ready-stdout --port 0 --home <isolated home>` and parse stdout `{event:"ready",port:number}`; normal logs are stderr. Token is created by CLI only after successful bind and persists through restarts. Source ws.rs:46–79.
- Request: `{id: <any JSON value>, method: string, params?: any}`. Use unique numeric/string request IDs; params defaults null. Response: `{id, result: any}` OR `{id,error:{message:string}}`. A successful result can be null. Malformed JSON/request gets `{id:null,error:{message:"bad request: …"}}`. Unknown method errors `unknown method <method>`. This is not JSON-RPC 2.0 and has no `jsonrpc` field, error code, subscribe method, or capability negotiation.
- Events: `{event:string,data:any}` immediately after connection. RPCs execute concurrently; events and results interleave and results may arrive out of order. Maintain a pending-ID map. There is no delivery sequence, revision, resume cursor or mutation deduplication guarantee. On disconnection reject pending calls; do not blindly replay sends/mutations. A send timeout means outcome unknown. Reconnect with fresh connection generation, read the token again, and bootstrap. Source ws.rs:120–176.
- Server broadcast lag emits a `snapshot` event automatically. Sender output channel capacity 256. Existing native client permits 256 MiB response frames because snapshots aggregate every chat. Sources ws.rs:122,166–168; desktop/client.go:99–108.

## Initial state and roster

`hello {}` returns:
```
{version, has_identity, is_identity_device, device_id: string|null,
 relay_url:string|null, relay_connected:boolean, relay_update_required:boolean,
 relay_error:null|{message:string,unknown_machine:boolean}}
```
`bootstrap {}` returns the snapshot below, and starts background model-catalog and marketplace refreshes (at most hourly). It need not be preceded by hello. Source api.rs:88–104.

Snapshot (`bootstrap` result and `snapshot` event data):
```
{version, has_identity, is_identity_device, identity_id:string|null,
 this_device_id:string|null, relay_url:string|null, relay_connected,
 relay_update_required, relay_error,
 devices:Device[], bots:Bot[], chats:SnapshotChat[], routines:unknown[],
 reviews:unknown[], tasks:unknown[], auto_review:AutoReview,
 providers:ProviderStatus[], models:Model[], running_chat_ids:string[],
 running_turns:{job_id,chat_id,bot_id,routine_id:string|null}[],
 attention:unknown, budgets:unknown[]}
```
`hello.device_id` and `bootstrap.this_device_id` are intentionally different names. Newer fields should be optional in a tolerant decoder because the user's fork is older. Source app.rs:1875–1926.

- SnapshotChat = ChatMeta + `unread_count:number`, optional `usage`, `messages:Message[]`, `has_more:boolean`. It contains newest **60** messages per chat, oldest first.
- ChatMeta = `{id,kind:"dm"|"group",title:string|null,bot_ids:string[],owner_bot_id?:string,description?:string,is_pinned:boolean,created_at:number}`. Dates are UNIX **seconds** (floating-point), not JS milliseconds. One DM per bot, named after the bot; groups contain 1–6 bots.
- `roster.changed` data is `{devices,bots,chats,routines,auto_review,providers,models}`. Its chats are ChatMeta + unread_count + optional usage, with **no messages or has_more**. Replace roster lists, but preserve cached messages and paging state for retained chats. Missing chat IDs mean removal. Source events.rs:21–22,81–89.
- Buffer events during bootstrap, apply snapshot, then replay events for that connection generation. Drop late callbacks from old sockets. Existing desktop follows this pattern. Source desktop/model/store.go:365–393,502–511.
- For later snapshot merges preserve loaded older pages only when the first incoming message is found in the existing ordered list; prepend the preceding old prefix, replace snapshot-covered tail, keep prefix paging state. Do not retain chats across identity change. Source desktop/model/store.go:396–440.

Device wire fields: `{id,name,model,os,os_version,machine_key,is_this_device,status:"online"|"offline",last_seen:number,plugins:PluginStatus[],version?:string|null,update?:unknown|null,unknown?:true}`. `machine_key` is a display abbreviation, not a credential. Only os macos/linux/windows runs bots; an unknown device has empty name/os. Source app.rs:1832–1868; model.rs:108–111.

Bot: `{id,name,description,symbol_name,accent,runner_id,provider,model?:string,thinking?:string,avatar?:Attachment,workdir?:string,permissions?:unknown,instructions:string,created_at:number}`. `instructions` is compatibility data, usually empty; description is the current behavioral field. Do not infer credentials from provider selection. Source model.rs:114–149.

Provider statuses carry `{kind,is_connected,detail,base_url?,name?,api?,models?}` with masked detail. Catalog Model = `{provider,id,name,levels:string[],decides:boolean}`; preserve model order and use supported levels. AutoReview = `{is_enabled,rules:[{id,text,behavior:"allow"|"ask",tool?}],provider?,models?:Record<string,string>}`.

## Chat and bot RPCs

There is no `chats.list`, `chats.get`, `messages.list`, `chat.send` or `permission.respond`. Use bootstrap/roster and the exact plural names below.

- `chats.create {id?,kind?:"group",bot_ids:string[],title?,owner_bot_id?,description?}` → `{chat: ChatMeta+unread_count+usage?}`. Defaults group. Unknown non-dm kind normalizes group. Takes first six supplied IDs; every retained bot must exist. Zero bots errors `A chat needs at least one bot`. Existing requested chat ID returns existing chat. Owner falls back to first member. Source api.rs:302–321; app.rs:1243–1282.
- `chats.dm {bot_id,id?}` → `{chat}`. Returns the existing one DM for the bot when present, ignoring preferred new id. `chats.create {kind:"dm",bot_ids:[bot_id],id?}` is equivalent. Source api.rs:323–326; app.rs:1285–1308.
- `chats.rename {chat_id,title:string|null}` → null. Trims title; absent/non-string/blank clears. DM errors `Only group chats can be renamed`.
- `chats.set_description {chat_id,description:string|null}` → null. Same trimming/clearing; group only.
- `chats.pin {chat_id,pinned?:boolean}` → null. Omitting bool toggles (explicit bool avoids accidental double-toggle).
- `chats.set_owner {chat_id,bot_id}` → null. Group only; bot must be a member.
- `chats.add_bot {chat_id,bot_id}` → null. Only group, under six members, and no duplicate; otherwise membership silently unchanged. It still creates a "joined the chat" notice, so the UI should prevalidate.
- `chats.remove_bot {chat_id,bot_id}` → null. Group only and must retain at least one member; removes/reassigns owner if needed, otherwise silently unchanged.
- `chats.mark_read {chat_id}` → null. Do when visible and focused, not simply mounted in background.
- `ui.watching {chat_id:string|null}` → null. Visible foreground chat for phone-push suppression. Server clears when any socket disconnects, so use a single persistent main bridge connection per app.
- `chats.delete {chat_id}` → null. Stops local work, deletes local chat/messages, and queues relay group/attachment deletion. Not a reversible archive. Emits chat.removed then roster.changed. Does not fail if ID is unknown.
Sources api.rs:431–489,566–569,197–201; app.rs:1310–1366.

Bots needed for new-chat UI:
- `bots.create {id?,chat_id?,name,runner_id,description?,symbol_name?,accent?,provider?,model?,thinking?,workdir?,permissions?,avatar?}` → `{bot,chat_id}`. Automatically creates DM. Defaults provider deepseek, icon sparkles, accent indigo. runner_id must exist and be desktop OS. Avoid marketplace/template_id/greeting unless intentionally starting welcome work.
- `bots.update {id,...patch}` → `{bot}`. name/provider/runner_id/etc accepted when nonempty; description is trimmed and can clear. model/thinking/workdir clear with empty string, not necessarily null. avatar absent keeps, null removes, object stores path-backed image. permissions is validated if present. 
- `bots.delete {id}` → null; removes associated DM and any groups left without bots, cancels work. These are account mutations, not BB-only UI state.
Sources api.rs:228–299; app.rs:1123–1208,1221–1240.

## Sending, stop and Send now

`chats.send {chat_id,text?:string,message_id?:string,attachments?:OutgoingFile[],mentions?:string[],reply_to?:string}` → `{message:Message}`.

- Text trimmed; empty text plus zero attachments errors `Empty message`. `reply_to` is a **message ID string**, not the returned quote object; target must still exist in same chat and have text body, otherwise error `The message you replied to is no longer in this chat`.
- Mentions are bot IDs, and replies to bot messages influence group turn order. Send always admits a job/room exchange. It does not await model completion, and success does not mean the Runner completed or even started inference.
- Use client-chosen unique `message_id` for optimistic UI. Upsert by that ID when event arrives. **This is not an idempotency key**: repeated sends can admit repeated jobs even when the message upsert reuses an ID.
- `message.added` is emitted before RPC return. During an existing direct turn, `hear_user_message` may also emit a `message.updated` with queued=true before the response. The response returns the original message clone with queued=false/omitted. Do not let an older response overwrite a newer event. Use result only when an event has not already settled that optimistic row, or follow with bootstrap.
- Ordinary send steers the current direct turn at its next safe step; does not hard-stop it. It also dismisses unanswered permission/command questions in that chat (their action does not run). Groups run room exchanges.
Sources api.rs:327–347; runtime.rs:27–82; turns.rs:555–583.

`chats.stop {chat_id}` → null. Cancels current and queued jobs immediately and forwards job-specific cancel to other Runners; stop is independent of ordinary send. No final error/outcome is included in response. Follow job/message events. Background shell commands are intentionally left running by chat Stop; explicit terminal controls are a separate feature. Source api.rs:379–382; runtime.rs:95–110; docs/architecture/runtime.md.

`chats.send_now {chat_id,message_id}` → `{sent:boolean}`. Direct chat only (`Send now is for a direct chat`); message must be queued user text. Missing chat/message/bot errors. False means message is no longer held or its own fallback turn will read it; false is not an API failure. True means command sessions were backgrounded, current step interrupted, and queued messages become available at once. This targets an existing message, it never resends text. Routes to remote Runner with normal 20-second request timeout. Sources api.rs:383–398; turns.rs:536–552; requests.rs:17–56.

## Message and block mapping

The local wire has **one body per Message, no `blocks[]`, block IDs, block deltas, token deltas, or hidden thinking transcript**. BB creates its own presentation blocks from Body while retaining original Message IDs and semantic fields. `message.updated` carries the complete latest message, so replace content; never append the text as a delta.

```
Message = {
 id:string, chat_id:string, author:Author, body:Body,
 state:{kind:"thinking"|"streaming"|"complete"}|{kind:"failed",error:string},
 created_at:number, promoted_at?:number, queued?:boolean,
 output?:Output, notification?:"summary"|"urgent"|"quiet"
}
Author = {kind:"you"}|{kind:"bot",bot_id:string}|{kind:"system"}
```
Absent queued means false. promoted_at is later model-consumption time; UI continues to show created_at. Message IDs are opaque strings; generated ones begin msg-. Source model.rs:231–237,464–497.

Body union:
- `{kind:"text",text:string,attachments?:Attachment[],mentions?:string[],reply_to?:{message_id,author,text}}`. Text is Markdown; quote text is plain single-line excerpt ~280 chars or attachment filenames.
- `{kind:"tool",name,summary,detail,is_running:boolean,call_id:string,arguments:null,result:null,is_error:boolean,description?,target_bot_id?,script_command?,run?:CommandRun}`. Detail is limited to first 400 Unicode characters for UI; full arguments/results stay on Runner. Empty tool names should display safe fallback. Keep name/summary/status even if rendering only a collapsed activity card.
- `{kind:"handoff",from:string,to:string,reason:string}`.
- `{kind:"notice",text:string,routine_id?:string}`.
- `{kind:"permission",plugin_id,plugin_name,tool,summary,arguments:null,decision:string,reason?,rule?,command?,link?,code?}`. Keep card and its response state. `tool:"access"` cannot grant permission through the card.
Sources model.rs:259–345,347–388,499–530.

CommandRun (bash tool card): `{command:string,state:string,session_id?,prompt?,output?,outcome?,device?,reason?,rule?,decision?,handed_over?:boolean,background?:boolean}`. States: checking, asking, running, waiting, exited, failed, stopped, denied, expired, dismissed. `asking` is a permission question; running/waiting with session_id are live commands. command is capped at 8000 chars; prompt/output are display strings, not hidden input. These use the same chats.permission endpoint while asking. Native terminal input/stop/background are separate `bash.stdin/stop/background {chat_id,message_id,text?,enter?}` APIs. Source model.rs:391–444; api.rs:788–802.

Output additive metadata: `{id,kind,name,mime,bot_id,chat_id,task_id?,version:number,previous_message_id?,url?,evidence?:{kind:"test_result"|"before_screenshot"|"after_screenshot"|"verification",summary,status:"passed"|"failed"|"unverified",command?,exit_code?}}`. Each output version is a distinct Message; do not merge across IDs just because output.id repeats. Source outputs.rs:11–79.

## Events and reducer behavior

Event data, all full objects (not JSON Patch):
- message.added / message.updated: `{chat_id,message:Message}`; idempotent upsert by message.id, preserve insertion position on updates.
- message.removed: `{chat_id,message_id}`; remove exact row.
- chat.removed: `{chat_id}`; remove chat plus working indicators.
- job.started / job.finished: `{chat_id,bot_id,job_id,routine_id?:string}`. Track a set/map by job_id. A group exchange between member turns has `bot_id:""`; one finished bot/job does not imply entire chat idle. job.finished contains **no success boolean, result, error, or final message**.
- job.thinking: `{chat_id,bot_id}`. Activity indicator only, no thinking text. Clear when next message from that bot is added or its job finishes.
- job.retry: `{chat_id,bot_id,attempt:number,max_attempts:number,delay_ms:number,error:string}`. Show retry state; do not resend original request.
- chat.usage: `{chat_id,usage}`.
- relay.status: `{connected:boolean,url:string|null,update_required:boolean,error:null|{message,unknown_machine:boolean}}`. Relay connectivity is separate from local socket connection; local chats can function offline.
- identity.changed: `{has_identity:boolean}`; rebootstrap/reset identity-dependent state.
- pair.posted `{nonce}`; pair.completed `{nonce,device}`.
- provider.auth `{kind,url}`; plugin.auth `{plugin_id,sign_in,url}`; plugin.auth.done `{plugin_id,sign_in}`. Opening auth URLs is an explicit external-navigation feature, not safe generic pass-through.
- Additional events for newer features: budgets.changed `{budgets}`, reviews.changed `{item,change}`, tasks.changed `{task}`, attention.changed `View`. Ignore unknown events safely.
Source events.rs:8–89; app.rs:917–989,1525–1588.

Usage = `{context_tokens,context_window,input_tokens,output_tokens,cache_read_tokens,cost_usd,api_cost_usd,subscription_estimate_usd,unknown_price_calls,pricing_kinds:string[],turns,model,updated_at}`. Context fields are last turn; other values accumulate. Kept locally on Runner, not universally synced. Source model.rs:637–659.

## Permission answering

`chats.permission {chat_id,message_id,decision:"allow"|"always"|"deny"}` → `{answered:boolean,url?:string,sign_in?:string}`. Parser also accepts allowed/once/denied but use canonical request strings. These are different from returned decision states `pending`, `allowed`, `always`, `denied`, `expired`, `dismissed`, `connected`, `failed`.

- Requires bot-authored card; errors Unknown message, Not a permission request, Unknown bot, or `decision is allow, always, or deny`.
- Normal waiting call resolves to answered:true, then message.updated changes card decision. answered:false means no pending question; refresh/disable card rather than invent approval.
- `tool:"access"` only permits deny; response marks dismissed. Other decisions error directing user to bot Access profile. An access card must never show actionable Allow controls.
- `always` can create persistent Auto-review rule; expose as a separate explicit user choice. Shell card should offer it only when `rule` exists. Never auto-answer a permission because it appeared on wire.
- `tool:"connect"` may start OAuth, return URL/sign_in, and ultimately emit auth events/update card. Keep URLs out of generic auto-open behavior.
- Remote Runner can be offline/unknown/no relay or time out; permission may still have been processed when connection/timeout loses reply.
Sources api.rs:768–786; plugins/mod.rs:1032–1053; plugins/mcp.rs:1348–1372,2788–2814,2915–2929; requests.rs:17–56.

## Paging and search

`chats.messages {chat_id,before?:message_id,limit?:number}` → `{messages:Message[],has_more:boolean}`.
- Default 60, clamps integer u64 to 1–200. before is exclusive **message ID**, not timestamp or opaque page token.
- Ordered by database insertion position, oldest first; an unknown before ID behaves like no cursor (newest page). Dedupe by ID and never re-sort by timestamp when paging.
- May fetch another historical page from relay if local page short and partial. A failed relay fetch sets has_more:false for this answer, so it can be transient rather than proof history is exhausted.
- Snapshot/roster must not erase previously loaded older pages. Cursor for next request is first current message ID. Preserve visible scroll anchor after prepend.
- Unknown chat errors `No such chat`.
Sources api.rs:543–565; app.rs:1618–1630; local_store.rs:468–504.

`chats.search {query,limit?}` → `{chats:[{chat_id,snippet}],messages:[{chat_id,message_id,snippet,author,created_at}]}`. Default20/max50/min1. Empty parsed terms returns empty arrays; missing empty raw query errors missing query. Searches current local store and chat title/bot metadata, not full unseen relay history. Source api.rs:490–542.

## Files, identity and configuration boundaries

OutgoingFile = `{path:string,id?:string,name?:string,mime?:string,width?:number,height?:number}`. Path must be on the **same computer as CLI**, be a regular file, ≤100 MiB. Valid proposed id begins att-, ≤48 chars, ASCII alphanumeric/hyphen; invalid id is replaced. Returned Attachment = `{id,name,mime,size:number,width?,height?}`. No upload/data/base64 field or `files.add` method exists in Lorca API. BB bridge may offer its own native chooser/upload staging, but must not allow renderer arbitrary filesystem path read. `chats.send` requires these path-backed objects, not returned Attachment records. Source files.rs:16–82.

`files.path {attachment:Attachment,named?:boolean}` → `{path:string}`. CLI validates attachment ID, fetches/decrypts relay file if absent, optionally creates sanitized filename copy under its private directory. Returned path is a native local path, **not browser URL**. Native bridge should use attachment handles and a guarded file-serving or data transfer route if display is implemented, not generic arbitrary path opens. Source api.rs:369–378; files.rs:105–147.

- `identity.create {device_name?}` → `{phrase:string[],device_id}`. Generates keys and default pinned Chef bot + DM; errors if identity already exists. This is a consequential account-creation operation, not required to connect BB. Never invoke automatically or expose phrase in logs.
- `identity.restore {phrase:string,device_name?}` → `{device_id}`. Requires configured relay and no existing identity; restores remote account.
- `pair.start {}` → `{nonce,pairing_string}`; `pair.status {nonce}`, `pair.cancel {nonce}` → null; `pair.accept {pairing_string,device_name?}` result from pairing; `pair.abort {}` → null.
- `identity.forget {}` unpairs this device/clears local identity; `identity.delete {}` deletes relay identity first, then clears local data. Exclude from narrow initial UI bridge.
- `sync.account {}` waits up to30s for account sync → `{providers}`. `sync.wake {}` wakes reconnect now → null.
- `config.set {relay_url:string|null}` → `{relay_url}`. If present any non-string clears saved URL. LORCA_RELAY_URL env overrides saved setting. Prefer showing config from bootstrap; do not silently configure a production relay.
- `providers.api_key` deliberately reveals credentials for settings editing; **exclude from bridge allowlist**. Bootstrap only carries masked statuses. Same exclusion for identity key/restore/provider connect methods unless separately implemented with secure UX.
Sources api.rs:107–225,804–821; identity.rs:28–105; config.rs:111–119.

## Errors and implementation tests

Only human-readable `error.message`; no stable numeric error schema. Display safe message; distinguish wire response failure from local transport failure, permission deny from transport deny, missing identity from unconnected provider, and socket offline from relay offline.

Required deterministic coverage: Origin/auth rejection; wrong/missing token; loopback endpoint restriction; unknown RPC blocked by bridge; malformed/mismatched messages; out-of-order response IDs; event-before-send-response; streamed text replacement; bootstrap event buffering; reconnect stale generation; no mutation replay; unknown mutation outcome after timeout/drop; multi-job groups; permission pending/answered=false/access card; paging merge/cursor; identity reset; no arbitrary renderer path; absence of newer optional fields. Source tests available: crates/cli/tests/serve_ready.rs. Use isolated fake token/WS server, never real ~/.lorca or provider calls.

## charlzyx fork differences

Public fork commit `72478382674be5d3a06e0a365c7eb089d3e62db5` (HEAD read 2026-10-09). Source comparison is to pinned upstream above, not an assertion about installed user's binary.

- Fork ws.rs:29–61 binds loopback and has the same frames/concurrent dispatch, but **no bearer-token, Host, or Origin enforcement**. It has no serve-token Config methods. A token-required connector does not connect to this version unless explicit launch-time legacy mode exists. Never automatically downgrade after a 401 or missing token. If supporting old fork, require explicit `LORCA_ALLOW_LEGACY=1`, remain loopback-only, expose `authMode:"legacy-unauthenticated"` visibly, and warn that old daemon itself is unauthenticated.
- Core chats.create/dm/send/stop/send_now/delete/rename/description/owner/pin/membership/messages/search/mark_read and permission API shapes remain compatible. Basic events/body shapes compatible.
- Fork lacks upstream method families tasks, handoffs, reviews, attention, budgets, connector_limits and browser, plus outputs.list/publish, bots.permissions, device.service_status, plugins.rename. Lacks snapshot tasks/reviews/attention/budgets, Bot.permissions, Message.output/notification, expanded usage price categories. Treat additions as optional.
- Fork files.path does not implement named:true; accepts/ignores unknown param and returns stored path. Routine timezone/missed-run-policy newer additions absent. Named plugin-account additions absent.
- Do not assume commit title mentioning dots roots changes Rust CLI Config::load: this fork still uses LORCA_HOME or ~/.lorca; application bundle launcher may set a different home. Discover explicit launch config rather than guessing based on branding.

Verified source URLs:
- https://github.com/egoist/lorca/tree/2e360b0611a4ddd845090b2c5802a0af421f5855
- https://github.com/charlzyx/lorca/tree/72478382674be5d3a06e0a365c7eb089d3e62db5

## Snapshot ordering limit

Lorca has no event sequence, message revision, or snapshot barrier. Events buffered while `bootstrap` is running can precede or follow the point at which its snapshot was built. The adapter follows the native client's buffer-and-merge approach, guards stale connection/account generations, and prevents known terminal message/permission states and prefix-stream text from regressing during replay. It cannot prove a total order for arbitrary conflicting updates or a job-start event versus a snapshot that no longer lists that job. Reconnect/Refresh obtains another read-only snapshot. Rust remains the authority for whether a permission is pending and whether a queued message can be sent now. A future wire-level revision/barrier is needed for strict monotonic reconciliation; this integration does not claim that guarantee.
