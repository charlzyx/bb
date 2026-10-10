# Editable Lorca settings: source contract

Acceptance target: upstream [`egoist/lorca` main at `b975eb6056b01bf7f2058b5c5e9ffc22e9930eea`](https://github.com/egoist/lorca/commit/b975eb6056b01bf7f2058b5c5e9ffc22e9930eea), observed and source-reviewed on 2026-10-10 (commit timestamp 2026-10-09T23:23:54Z). Its [workspace package version is 0.1.11](https://github.com/egoist/lorca/blob/b975eb6056b01bf7f2058b5c5e9ffc22e9930eea/Cargo.toml#L14-L15). Acceptance is upstream-only; a version string alone does not identify another build's source or capabilities.

This document describes the selected daemon settings capabilities and native editor security contract. See [Settings and runtime inventory](lorca-settings.md) for the client surface and [verification](lorca-verification.md) for tested behavior. Source comparison is not a live-service or binary-runtime test. A documented method does not mean every control is implemented in this client.

**N** below refers only to this pinned upstream commit. Rust paths are under `crates/cli/src/` unless stated otherwise. No live account, model, credential or service calls were used for this review.

### Public source index

All line references below use the acceptance commit, not a moving default branch.

| Source | Pinned upstream reference (N) |
| --- | --- |
| RPC dispatch | [source](https://github.com/egoist/lorca/blob/b975eb6056b01bf7f2058b5c5e9ffc22e9930eea/crates/cli/src/api.rs) |
| Snapshot and state writes | [source](https://github.com/egoist/lorca/blob/b975eb6056b01bf7f2058b5c5e9ffc22e9930eea/crates/cli/src/app.rs) |
| Wire models | [source](https://github.com/egoist/lorca/blob/b975eb6056b01bf7f2058b5c5e9ffc22e9930eea/crates/cli/src/model.rs) |
| Provider validation and writes | [source](https://github.com/egoist/lorca/blob/b975eb6056b01bf7f2058b5c5e9ffc22e9930eea/crates/cli/src/provider_auth.rs) |
| Provider status and catalog | [source](https://github.com/egoist/lorca/blob/b975eb6056b01bf7f2058b5c5e9ffc22e9930eea/crates/cli/src/credentials.rs) |
| MCP file management | [source](https://github.com/egoist/lorca/blob/b975eb6056b01bf7f2058b5c5e9ffc22e9930eea/crates/cli/src/plugins/mcp_json.rs) |
| MCP connections and OAuth | [source](https://github.com/egoist/lorca/blob/b975eb6056b01bf7f2058b5c5e9ffc22e9930eea/crates/cli/src/plugins/mcp.rs) |
| Plugin state | [source](https://github.com/egoist/lorca/blob/b975eb6056b01bf7f2058b5c5e9ffc22e9930eea/crates/cli/src/plugins/mod.rs) |
| Auto-review evaluation | [source](https://github.com/egoist/lorca/blob/b975eb6056b01bf7f2058b5c5e9ffc22e9930eea/crates/cli/src/plugins/review.rs) |
| Remote requests | [source](https://github.com/egoist/lorca/blob/b975eb6056b01bf7f2058b5c5e9ffc22e9930eea/crates/cli/src/requests.rs) |

## Priorities and shared boundaries

1. Existing bot provider/model/thinking and explicit bot-wide Runner assignment have compatible patch RPCs in the pinned upstream implementation. A chat has no separate Runner setting.
2. Existing MCP enable/hide/reconnect plus native secure add/edit are compatible, but save/enable/reload/reconnect may execute arbitrary configured programs or contact remote services. Removal deletes associated secrets and local plugin data.
3. Auto-review enabled/rules are compatible and account-wide. The daemon also supports review-provider/model overrides; their presence is not inferred from authentication mode or a version string.
4. Provider credential edits are full credential/configuration replacements with remote validation and account-wide encrypted synchronization. They require a secure user-driven native editor; raw credential/configuration reads and mutation results must never enter the ordinary renderer.

Every RPC uses `{id,method,params}` and returns `{id,result}` or `{id,error:{message}}`. The bot/provider/auto-review/MCP settings methods documented here have no mutation idempotency key, server revision, conditional write, transactional batch or settings epoch. Other upstream features, such as playbooks, project context and template previews, have their own revision/hash checks; those APIs are outside this editor. Native generation/account fencing prevents sending to a replaced session; native opaque revision hashes plus rereads detect many stale edits but cannot make the final read/write atomic. A timeout/disconnect after sending means outcome unknown. Never replay automatically; reconcile state first. Sources N `ws.rs:120–176`, `api.rs`, `requests.rs:19–56`.

`string` accepts a nonempty string without trimming. `opt_string` ignores only missing/null/non-string/EXACT `""`, not whitespace. Unknown fields are usually ignored. Native actions must strictly validate bounded objects, exact field sets, enum values and boolean types instead of copying those permissive semantics. N `api.rs:15–20`.

## Reads used by editors

`bootstrap {}` is the read source for `bots`, `devices`, `providers`, global `models` and `auto_review`. No `auto_review.get`, `providers.list`, `devices.list` or `chats.set_runner` exists. `roster.changed` carries the same setting rosters and partial chat summaries. Bootstrap can trigger Lorca's ordinary background catalog/marketplace refresh; it does not start a chat turn. N `api.rs:94–110`, `app.rs:1927–1967`, `events.rs:21–22`.

- Global model: `{provider,id,name,levels:string[],decides:boolean}`. Preserve order: the first usable chat model is the provider default. N `app.rs:1963–1967`.
- Provider status: `{kind,is_connected,detail,review_model?,base_url?,name?,api?,models?:CustomStatusModel[]}`. Built-ins usually omit name/api/models. `detail` can contain key fragments, account email and an UNREDACTED URL; remove it and `base_url` from general renderer results. N `model.rs:9–35`, `credentials.rs:297–349`.
- Custom status model: `{id,name?,context_window?:number,max_output?:number,images?:boolean,levels:string[]}`. N `credentials.rs:93–104`, `model.rs:31–35`.
- N custom `api`: `chat-completions|responses|messages|system-one|decisions`. Decision providers/models cannot run ordinary bots. N `credentials.rs:31–69`.
- N AutoReview: `{is_enabled:boolean,rules:[{id,text,behavior,tool?:string}],provider?:string,models?:Record<string,string>}`. Missing optional provider/models is not a capability signal because default values are omitted during serialization. Default policy is enabled, empty rules. N `model.rs:152–187`.
- Runner eligibility: only devices with OS `macos|linux|windows`. Online presence is not service/process health. N `model.rs:108–111`, `app.rs:1865–1907`.

### Raw credential read, native only

`providers.api_key {kind}` → `{api_key:string|null,base_url:string|null}`. For built-in kinds only `deepseek|anthropic|opencode|opencode-go`; otherwise “Not an API-key provider”. Unknown custom kind errors. Custom values can be empty strings. This deliberately returns actual secrets. N `api.rs:825–842`.

For edits, native may preserve existing credentials using this read without echoing them into the ordinary renderer. A write-only replacement field and explicit clear/keep distinction is safer than sending masked placeholders back. A blank-field-means-keep convention is a CLIENT convention and must be merged in native; it is not Lorca's wire semantics.

## Bot model/provider and Runner assignment

`bots.update {id,...patch}` → `{bot:Bot}`; N `api.rs:269–297`.

| Patch field | Actual daemon semantics |
| --- | --- |
| `provider`, `runner_id`, `name`, `symbol_name`, `accent` | Nonempty string replaces; null/missing/empty ignored; whitespace accepted unchanged |
| `model`, `thinking` | Any string trims; empty/whitespace clears to absent/default; null/missing ignored |
| `description` | String trims; empty clears; otherwise legacy string `instructions` may supply it |
| `workdir` | String replaces without trim; all-whitespace clears; missing/null ignored |
| `avatar` | Omitted keeps; null removes; object stores/uploads path-backed image |
| `permissions` | Explicit validated policy; omitted keeps; null invalid |

Provider change does NOT automatically clear model/thinking. The existing Lorca UI explicitly sends `model:"",thinking:""` when changing provider. Select thinking only from the resolved model's offered levels; changing model may need to clear unsupported thinking. API itself does not validate provider/model pairing or disallow decision providers; native must validate catalog/connected provider state. N `docs/architecture/bots.md:3–5`, `docs/architecture/providers.md`, `api.rs:288–293`.

Runner change is `bots.update {id:botId,runner_id:deviceId}`. It changes that bot's profile in every DM/group/routine that uses it, not only the currently visible conversation. A group can have bots on different Runners. `update_bot` modifies and publishes roster, with next-turn semantics; unlike `bots.create`, it does not validate target Runner existence or OS. Native must revalidate a known eligible Runner. Prefer reject or explicitly warn when the bot has active jobs; this RPC neither migrates nor stops an in-flight job. It does not transfer the old Runner's workspace, long-term memory, installed MCP plugins or credentials stored only there. N `app.rs:1165–1181`, `docs/architecture/bots.md:36–56`; creation checks in `app.rs` `insert_bot`.

## Provider writes

Dispatcher shapes: N `api.rs:843–915`. Auth functions are feature-gated by `provider-auth`; a build without that feature answers unknown method. Results contain RAW provider statuses and must be projected before renderer delivery.

### Built-in API keys

`providers.connect_deepseek|connect_anthropic|connect_opencode|connect_opencode_go {api_key:string,base_url?:string}` → `{providers:ProviderStatus[]}`.

- Key trims and must not be blank.
- Base URL trims/trailing slash removed; omitted/blank means DEFAULT, not retain existing. Server checks only `http://`/`https://` prefix; native must do stronger URL parsing and destination review.
- Validation sends authenticated GET, then persists account-wide credentials. DeepSeek GET root `/models` (strips trailing `/anthropic`); Anthropic `/v1/models`; normal OpenCode Zen/Go use authenticated usage route, custom roots use `/v1/models`.
- 401/403 rejects ordinary keys. Zen's standard usage-route 403 is accepted because a valid Zen key need not have Go subscription; Go 403 errors “needs an active subscription.” These checks do not perform chat inference, but do transmit credentials to the selected service.
- N `provider_auth.rs:43–146`.

### Custom providers

`providers.connect_custom {kind?,name,api?,base_url,api_key?,models?:string[]}` → `{kind:string,providers:ProviderStatus[]}`.

- FULL replacement: omitted key becomes `""`; omitted or `[]` models means use all usable remote-listed models. Default missing/empty API is `chat-completions`. Do not treat this as a patch.
- Name trims, required, max 40 Unicode characters, case-insensitive unique provider display name. Explicit kind must start `custom:`; it need not already exist, so native must verify edit-vs-add target. Renaming with same kind preserves stable ID and existing created_at; adding picks `custom:<slug>` with numeric collision suffix.
- Explicit models trim/dedupe, preserve order and may contain IDs absent from returned catalog. First model is default. Empty list requires a usable remote list; otherwise “publishes no model list”/“lists no models” errors.
- Remote list validates reachability and key; then credentials saved and synchronized. HTTP 401/403 rejects; unreachable or successful non-JSON rejects. Other HTTP statuses mean “no published list”; explicit user model IDs can still save.
- N `provider_auth.rs:166–241,293–350`.

`providers.list_models {name?,api,base_url,api_key?}` → `{listed:boolean,models:CustomModel[]}`. Models here lack `levels`; fields are id/name/context_window/max_output/images. This performs an authenticated network GET with 20-second timeout, WITHOUT saving. Missing API errors (unlike connect_custom default). `listed:false` means no supported list, not necessarily failed credentials. N `api.rs:863–868`, `provider_auth.rs:236–241,325–350`.

For the messages API, the daemon strips terminal `/messages`, retaining `/v1`, and strips `/v1` when constructing the request. Round-trip normalized roots through the daemon; do not infer the exact saved URL from input. Provider names reserve both built-in and custom names. Decision APIs/models are distinct from ordinary chat models.

### Disconnect and subscription login

- `providers.disconnect {kind}` → `{providers}`. Removes built-in credential or DELETES a custom provider for the whole account. Bots retaining the kind do not get reassigned automatically. Unknown kind errors. Also cancels ongoing provider auth. Grok attempts remote refresh-token revocation asynchronously; other provider deletions do not revoke upstream API keys. N `provider_auth.rs:423–459`.
- `providers.connect_chatgpt {}` / `providers.connect_grok {}` → `{email,providers}` after successful login, up to five minutes. Starts browser OAuth and account-wide persistence. Native Runner opens its own browser; non-Runner emits `provider.auth {kind,url}`. `providers.auth.cancel {}` → null; N sign-in rejects “Sign-in cancelled”. N `api.rs:31–45,885–909`, `provider_auth.rs:403–419`.
- `models.reload {}` → `{updated,changed}` refreshes Lorca's public model catalog; no provider/model selection change. N `api.rs:917–920`.

Provider credentials sync as encrypted account blob to all paired devices, not just selected Runner. N `app.rs:444–465`. Keep destination and account-wide scope visible during user confirmation. Do not preload or log secrets in renderer, snapshots, exception text, telemetry, or CLI arguments.

## Auto-review / auto-approval

`auto_review.set {is_enabled?,rules?,provider?,models?}` → `{auto_review}`. N `api.rs:745–787`.

- `is_enabled` accepts only JSON boolean; null/missing/nonboolean ignored. **False is stricter**: every effectful plugin/shell action asks, regardless of saved allow rules. True enables exact-tool rules plus model review for other actions, not blanket approval. Read-only tools may still execute without effectful-action review.
- `rules` array REPLACES THE ENTIRE LIST; `[]` clears. Null/missing/nonarray ignored. Each entry with nonstring or whitespace-only text is skipped. Text trims. Missing/empty id gets UUID; supplied id is preserved without uniqueness enforcement. `tool` accepted only as string, including empty. Any behavior except EXACT `ask` becomes `allow`. Native must require exact allow|ask, nonempty text/IDs, unique IDs, and prevent accidental conversion/removal of unrelated entries.
- Exact-tool rule key is `plugin_id/tool`; these bypass model review for that exact tool when enabled. The text on an exact-tool rule is only a note, never an additional condition. An allow rule for `gmail/send` with text “only to myself” still allows every matching tool invocation subject to bot access policy. The editor labels this scope explicitly and rejects duplicate exact-tool IDs in a submitted replacement list. Conflicting general text rules prefer ask, but duplicate exact-tool entries resolve by first match; preserve correct order and do not manufacture duplicates. N `model.rs:191–196`, `plugins/review.rs:126–149`.
- N `provider` present: string trims; null/empty/nonstring clears override. Nonempty value must be connected; missing keeps. This chooses account review provider; no chat provider mutation.
- N `models` object is PARTIAL per-provider patch. Each string trims and sets override; null/empty/nonstring deletes that key; omitted keys persist. Nonobject ignored. Server does not validate provider keys/model IDs here. Model may be decision model for review.
- Saves/publishes synced roster, not a local UI preference. No read revision/CAS. Do not use an empty rules array while only toggling enabled; omit rules to preserve. To edit/remove one rule, fetch current full list, apply targeted change and send exact replacement with stale-state checks. Concurrent changes after the final read remain a protocol limitation.
- N `app.rs:1096–1116`, `model.rs:152–187`, `plugins/review.rs:126–149`.

## MCP management

Dispatch and management parameter/result semantics: N `plugins/mcp_json.rs:1346–1461`, `api.rs:734–738`.

Common `runner_id?`: missing/null/nonstring/empty means local; exact local device ID also local; nonlocal ID uses sealed relay request. Validate target Runner natively. `name` selects file entry NAME, not generated plugin ID; string trims, empty errors. Unknown extra fields ignored.

| Method | Parameters besides runner_id | Result and important semantics |
| --- | --- | --- |
| `mcp.save` | `{name,config,previous_name?}` | get-shaped. config is ONE server object, full replacement. previous_name must be supplied even unchanged to edit; absent/blank means add and existing name conflicts |
| `mcp.remove` | `{name}` | null. Deletes entry, connection, secrets/notes, plugin directory and exact tool-prefix review rules |
| `mcp.set_enabled` | `{name,enabled:boolean}` | get-shaped. Required exact boolean; disable keeps entry/sign-in/catalog but stops active plugin; re-enable may clear catalog and connect |
| `mcp.hide_tool` | `{name,tool:string,hidden:boolean}` | get-shaped. Tool nonempty but not trimmed; need not exist and may be pattern. Exposure-only change does not reconnect. Hidden tools still returned in detail |
| `mcp.reconnect` | `{name,fresh?:boolean}` | get-shaped. fresh defaults TRUE even nonboolean; false reuses pool. Disabled/invalid errors; connection failure generally returned as status:error within successful result |
| `mcp.reload` | `{}` | list-shaped. Applies disk changes, can launch changed/new servers. Invalid file retains loaded servers and returns error; missing file is valid empty config |
| `mcp.sign_in` | `{name,wait?:boolean}` | default `{message}` initiation; wait:true may return get-shaped on completion. Browser opens on TARGET Runner, not requesting device. No auth URL in this result |
| `mcp.sign_out` | `{name}` | get-shaped. Works disabled; forgets OAuth token, connection/codes/notes. Does NOT revoke at service or remove inline Authorization headers |
| `mcp.parse` | `{text:string}` only; runner_id ignored | `{servers:[{name:string|null,config:object|null,problem:string|null}]}`. JSONC/document/fragment parser, no writes/network, but echoes secrets |

Get-shaped: `{path,server:{name,id,transport:"http"|"stdio"|null,enabled,config,problem,status,signs_in,signed_in,tool_count:number|null,tools}}`. List-shaped: `{path,error,servers:[same rows without tools]}`. ALL config is raw, including unknown keys/secrets. Inactive/problematic status can be null; tool count null differs from known zero. Tools include hidden entries; visible count excludes hidden. N `mcp_json.rs:1051–1115`.

Tool: `{name,title:string|null,description,read_only:boolean,hidden:boolean,capability?:"read"|"draft"|"write"}`. Plugin state also includes insufficient_access and expiry-aware needs_auth. Outer signed_in means token exists, so true can coexist with needs_auth. Do not infer healthy auth from this boolean alone. N `plugins/mcp.rs:1605–1630`, `plugins/mod.rs:550–596`.

Save/rename: validates config and duplicate/generated-ID/marketplace clashes, atomically replaces file, updates runtime; new/changed enabled servers clear cached catalog/connection and connect asynchronously under serve. Different-ID rename migrates secrets/directory/tool-prefixed review rules; some migration failures only warn. Save success is not connection success. N `mcp_json.rs:1138–1178,1275–1343`. Remove recursively removes directory, with ignored deletion errors; do not promise full secure erasure. `1181–1188,1323–1343`.

**Pending disk edits are outside the cached preview.** `mcp.list` and `mcp.get` show the loaded runtime configuration. Save, remove, enable/disable and hide-tool first reread the current disk file, then take the whole resulting document into the runtime and reconcile all differences. Therefore even disabling/removing one entry can also apply unrelated externally edited entries and start their programs. Reload similarly applies disk contents that were not shown by the list. Native inventory hashes cannot detect these pending disk changes, even with a second read immediately before mutation. Confirmations must explain this broader file-wide effect; a cached server list is not a preview of everything that will execute. A strict per-entry, conflict-free guarantee requires a daemon-side disk preview/revision/conditional-write API. N `mcp_json.rs:1118–1208,1215–1245,1277–1287,1414–1421`.

Canonical server config supports stdio `command,args,env,cwd`, HTTP `url,headers`, enabled/disabled, timeout, toolExposure, oauth and unknown fields. It canonicalizes aliases but preserves unknown keys. Raw URLs/commands/args/headers/env/OAuth clientSecret may all be sensitive. Native secure edit must merge unchanged config and use explicit keep/replace/clear semantics; masked placeholders are never valid replacement secrets. OAuth absent/true normally enables optional discovery unless Authorization header supplied; oauth:false disables; explicit object enables even alongside that header. N `mcp_json.rs:250–565`.

Remote timeout is 150 seconds for reconnect, 20 seconds for everything else, INCLUDING sign_in(wait:true). Local OAuth wait is up to 330 seconds. Timed-out remote mutations/auth are NOT cancelled and can complete later. Prefer remote wait:false and reconcile. OAuth completion is bound to connection/config/signout generations to reject stale sign-in completions. Do not retry auth/mutations to hide ambiguity. N `mcp_json.rs:28–30,1376–1403,1435–1449`, `requests.rs:19–56`, `plugins/mcp.rs:1098–1101,1131–1137,1196–1225`.

## Changes reviewed for this acceptance target

Compared with the previous inspected upstream commit `2e360b0611a4ddd845090b2c5802a0af421f5855`, WebSocket authentication, configuration paths, provider credentials/authentication, and MCP dispatch/connection implementations are unchanged. The selected `bots.update`, provider, `auto_review.set`, and MCP parameter/result contracts remain compatible. No implementation expansion is required by these deltas.

- Bootstrap and `roster.changed` add `shared_links` and `playbooks`. A shared-link URL contains its template decryption key in the fragment; these fields must remain outside ordinary renderer projections. The existing native allowlisted projections drop them. Sources N `app.rs:1949–1952`, `events.rs:22`, [`templates/links.rs:43–56`](https://github.com/egoist/lorca/blob/b975eb6056b01bf7f2058b5c5e9ffc22e9930eea/crates/cli/src/templates/links.rs#L43-L56).
- Auto-review now recognizes event-triggered work using the owner's configured task, excluding service payloads as authority. Routine feedback retains the original authorization prompt rather than expanding permission through revised task text. These are daemon-side review behavior changes, not settings RPC changes. Sources N `plugins/review.rs:481–512`, `model.rs:683–685`.
- The new templates, playbooks, projects, events, workflows and feedback APIs are outside the client allowlist. Their functionality is not added by this contract refresh. In particular, revision checks in those feature APIs do not provide CAS for this editor's settings methods.

## Implementation consequences

- One strict named action DTO per mutation, native target lookup and fresh-read revision checks, explicit user-facing consequence confirmation, final session/account check, one send, no replay.
- Confirmation rendering must show consequential target/value/rule changes in full and visibly escape bidirectional/invisible display controls; preserve the actual submitted user data. JSON stringification alone does not escape Unicode bidirectional controls.
- Do not widen renderer request to arbitrary provider/MCP APIs. Retain raw reads only in native memory for the short-lived edit and never return raw mutation result. Cancel/clear secure edit state on account/connection change.
- Keep explicit differences between “saved,” “connected,” “signed in,” “tool catalog known,” and “action outcome unknown.” A successful MCP response can describe an unhealthy server.
- Do not expose additional upstream features before their capability and security contract have been checked. Auth mode alone is not feature negotiation; unknown optional fields and version labels can be misleading.
- Synthetic tests should cover blank/omitted/null distinctions, full replacement preserving unrelated raw fields, duplicate names, invalid provider/model/Runner, group-wide bot effects, nullable catalog fields, malicious diagnostic/config strings, races during confirmation, and unknown mutation outcomes. No real providers, relays or credentials are needed.

## Historical research only

Earlier development compared upstream [`2e360b0611a4ddd845090b2c5802a0af421f5855`](https://github.com/egoist/lorca/tree/2e360b0611a4ddd845090b2c5802a0af421f5855) with fork [`charlzyx/lorca 72478382674be5d3a06e0a365c7eb089d3e62db5`](https://github.com/charlzyx/lorca/tree/72478382674be5d3a06e0a365c7eb089d3e62db5). Those manifest labels were 0.1.11 and 0.1.10 respectively. This was a comparison of pinned source implementations, not official “new” and “old” protocol editions or a release compatibility matrix. The fork is no longer an acceptance target and its compatibility surface is not being expanded. Existing technical `legacy` labels, where retained, are client compatibility identifiers rather than Lorca release names.

## Local audit corrections

A send acknowledgement is evaluated independently of concurrent stop/history errors, so a successful send does not retain its draft as if it failed. Discarded attachment selections release only opaque native handles, never filesystem data; account/session changes retain their existing fences.

MCP reconnect now explicitly requests `fresh:true`: it drops the cached connection and establishes a new one with the saved configuration/credentials, may restart a program and affect in-flight calls, and does not initiate OAuth grants. A completed RPC is still not a health guarantee. Disabling an existing server does not revalidate its saved configuration as a new connection or echo its URL/credentials; this lets the user disable a broken existing entry. New/edited connections retain stricter URL validation.

Known limitation: when the daemon reports a cached MCP configuration error, this client disables MCP editing/reload. Repair and reload through the Lorca host, then refresh the client. The client does not claim that a read-only Refresh loads changed disk configuration.
