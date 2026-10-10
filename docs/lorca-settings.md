# Lorca settings and runtime inventory

This document describes the sanitized inventory contract. Editable bot/model/Runner settings, controlled provider/MCP configuration, and account-wide auto-review policy now use a separate native transaction surface; see [editable settings](lorca-editable-settings.md). A provider marked connected remains a daemon report, not a live credential or model test. Configuration writes require explicit review and native confirmation.

Endpoint and appearance changes belong to this BB interface. They do not update Lorca's account configuration. The endpoint is kept in the native process for this session; appearance is kept across renderer reloads in the current ephemeral Electron session. Neither promises persistence after app restart. `LORCA_HOME` and legacy authentication mode are launch-time settings. Neither can be changed through renderer RPCs.

Authentication terminology: local dots→Lorca uses serve-token or explicit legacy loopback, never OAuth. Existing Lorca relay/device identity is unchanged. Optional provider/MCP OAuth is a separate service-specific login, not a new Lorca connection method.

## Source baseline and compatibility

Source inspection uses these public, pinned versions, not an assumption about any installed binary:

- [Current reference: egoist/lorca `2e360b0`](https://github.com/egoist/lorca/tree/2e360b0611a4ddd845090b2c5802a0af421f5855)
- [Older fork: charlzyx/lorca `7247838`](https://github.com/charlzyx/lorca/tree/72478382674be5d3a06e0a365c7eb089d3e62db5)

Paths below are relative to those repositories. Source verification does not require connecting to a real account or making a model call.

| Capability | Current reference | Older fork | This BB surface |
| --- | --- | --- | --- |
| Local socket authentication | Bearer token, loopback Host, no Origin | Unauthenticated local socket | Token by default; explicit legacy opt-in |
| Device, bot, provider and plugin roster | `bootstrap`, `roster.changed` | Same core fields | Sanitized read-only inventory |
| MCP configuration/status list | `mcp.list` | Same result shape | Sanitized selected-Runner inventory |
| Cached MCP tool details | `mcp.get`, with `capability` | `mcp.get`, without `capability` | Detailed tool view deferred |
| Service installed/running status | `device.service_status` | Missing | Deferred; presence is displayed instead |
| Bot's plugin tool catalog | `bots.permissions` | Missing | Deferred |
| Named plugin accounts | `service_id`, `account_name` | Missing | No account management |
| Provider review model | `review_model` | Missing | No review-model editor |
| Bot name/provider/model updates | `bots.update` | Core patch fields compatible | Deferred |
| Theme/language/send-on-return | Native desktop preferences | Native desktop preferences | BB owns its own appearance only |

There is no capability-negotiation RPC. Unknown methods return a human-readable error. Missing optional fields mean unknown or unavailable, never permission to substitute another mutation. Legacy mode is a transport choice, not proof of a particular feature set. See [the full protocol](lorca-protocol.md#charlzyx-fork-differences).

## Read-only source methods

These are daemon wire contracts. Raw results are **not** the renderer contract.

### Bootstrap and Runner roster

`bootstrap {}` returns the account snapshot. Settings consumes `version`, `has_identity`, `this_device_id`, `devices`, `providers`, `bots`, `relay_connected` and `relay_update_required`. The controller also needs `identity_id` to invalidate account-scoped state. The RPC starts Lorca's ordinary background model-catalog and marketplace refresh, at most hourly; it does not start a chat turn. [api.rs:88–104](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/api.rs#L88-L104), [app.rs:1888–1926](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/app.rs#L1888-L1926).

Each known device contains:

```text
{id, name, model, os, os_version, machine_key, is_this_device,
 status: "online" | "offline", last_seen: number,
 plugins: PluginStatus[], version: string, update: UpdateStatus | null}
```

`last_seen` is Unix seconds. `id` is a machine signing public key and `machine_key` is its abbreviation. Unknown devices have empty names/OS, `unknown:true`, no version/update and no plugins. Only `os` equal to `macos`, `linux` or `windows` denotes a Runner. Online presence is not a service health check or proof that a bot can execute. There is no separate `devices.list` or installed `plugins.list` RPC. [app.rs:1826–1868](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/app.rs#L1826-L1868), [model.rs:108–111](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/model.rs#L108-L111).

`PluginStatus` is `{id,name,description,version,icon,state,detail,source?,service_id?,account_name?}`. `source:"mcp.json"` distinguishes imported MCP servers. State can be `ready`, `needs_setup`, `needs_auth`, `insufficient_access`, `connecting` or `error`; unknown future states must not imply readiness. The free-form `detail` is discarded. Plugin roster entries have **no tool count**. [model.rs:78–105](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/model.rs#L78-L105), [plugins/mod.rs:550–581](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/plugins/mod.rs#L550-L581).

`roster.changed` contains refreshed devices, bots, providers and models alongside chat summaries. Its chat rows do not contain history; settings refresh must not replace the conversation store with this partial roster. [events.rs:21–22](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/events.rs#L21-L22).

### MCP list

`mcp.list {runner_id?:string}` returns:

```text
{path: string, error: string | null, servers: [{
  name: string, id: string, transport: "http" | "stdio" | null,
  enabled: boolean, config: object, problem: string | null,
  status: PluginStatus | null, signs_in: boolean, signed_in: boolean,
  tool_count: number | null
}]}
```

No Runner ID means the connected local device. A different ID routes an encrypted request to that Runner, with the ordinary 20-second timeout; it does not switch the native socket to another host. A non-Runner has no MCP servers. Use a validated Runner from the current snapshot. [api.rs:713–718](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/api.rs#L713-L718), [plugins/mcp_json.rs:1435–1450](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/plugins/mcp_json.rs#L1435-L1450), [requests.rs:19–24](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/requests.rs#L19-L24).

This reads the loaded configuration and saved tool catalog. It does not reconnect a server or execute tools. `tool_count:null` means no known catalog, while `0` is a known empty visible-tool list. Disabled or invalid entries can have `status:null`; enabled alone is not healthy. A failed list is unavailable, not an empty successful inventory. The list cannot determine hidden-tool count. [Current mcp_json.rs:1051–1115](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/plugins/mcp_json.rs#L1051-L1115), [fork mcp_json.rs:1046–1110](https://github.com/charlzyx/lorca/blob/72478382674be5d3a06e0a365c7eb089d3e62db5/crates/cli/src/plugins/mcp_json.rs#L1046-L1110).

### Available detail methods, deferred in this iteration

- `mcp.get {runner_id?,name}` takes the server **name**, not its ID. It returns `{path,server:{...listRow,tools}}`. Tools are `{name,title:string|null,description,read_only:boolean,hidden:boolean,capability?:"read"|"draft"|"write"}` from the saved catalog. The fork omits `capability`; `read_only:false` there means only “not marked read-only.” These are server/manifest hints, not grants or guarantees. Hidden tools are included in this detail list, but excluded from visible tool count. [Current mcp.rs:1605–1630](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/plugins/mcp.rs#L1605-L1630), [fork mcp.rs:1440–1459](https://github.com/charlzyx/lorca/blob/72478382674be5d3a06e0a365c7eb089d3e62db5/crates/cli/src/plugins/mcp.rs#L1440-L1459).
- `device.service_status {id?:string}` returns `{installed:boolean,running:boolean}` on current Lorca; no PID, log path or process control is returned. The fork lacks it. [api.rs:607–616](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/api.rs#L607-L616), [service.rs:35–40](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/service.rs#L35-L40).
- `bots.permissions {id:bot_id}` returns `{connections:[{id,name,tools}]}` from installed plugins on the bot's Runner, with hidden tools filtered out. It does not grant access. The fork lacks it. [api.rs:292–295](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/api.rs#L292-L295), [plugins/mod.rs:1022–1029](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/plugins/mod.rs#L1022-L1029).
- `plugins.detail {runner_id,plugin_id}` returns `{manifest,source,installed_at,status,variables,servers,skills,service_id?,account_name?}`. Both versions include configuration-bearing manifests and some variable values. Current server auth summaries additionally include callback port/URL. This is not a safe raw renderer API. [Current plugins/mod.rs:839–891](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/plugins/mod.rs#L839-L891), [fork plugins/mod.rs:738–786](https://github.com/charlzyx/lorca/blob/72478382674be5d3a06e0a365c7eb089d3e62db5/crates/cli/src/plugins/mod.rs#L738-L786).

## Native-to-renderer contract

The renderer calls `window.lorca.getSettings({runnerId?:string})`; it cannot request raw `mcp.*`, `plugins.detail`, provider credential methods or settings mutations through the generic chat RPC allowlist. The result is `RuntimeSettings` in `apps/lorca/src/ui/types.ts`, decoded by `src/core/settings.ts`:

```text
{
  version, hasIdentity, relayConnected, updateRequired,
  authMode: "token" | "legacy",
  devices: [{id,name,os,version,online,isThisDevice,
             plugins:[{id,name,state,toolCount:number|null}]}],
  providers: [{id,name,connected}],
  bots: [{id,name,runnerId,provider:string|null,model:string|null}],
  mcp: {status:"ready"|"unavailable",runnerId:string|null,hasConfigError,
        servers:[{name,transport:"stdio"|"http"|"unknown",enabled,state,
                  toolCount:number|null,hiddenToolCount:number|null,hasError}]}
}
```

Names and status labels are bounded display strings. Counts preserve unknown as `null`. Hidden counts remain unknown when only the list RPC is read. The DTO deliberately excludes raw config, provider URL/detail, filesystem paths and authentication material. It reports the connected daemon's snapshot and cached MCP state; Refresh does not test provider credentials, run a tool, restart a Runner, or import disk edits.

Settings assembly must stay within one native connection generation and identity epoch. A reconnect, endpoint change or same-socket `identity.changed` invalidates in-flight assembly before any subsequent RPC and before delivery. The renderer independently discards late results. General `bootstrap`, `snapshot` and `roster.changed` delivery must use the same redaction boundary; sanitizing only the Settings panel would leave another route to the same sensitive fields.

## Redaction requirements

Construct an allowlisted DTO in native code before IPC. Hiding a value in a component or deleting a few known keys is insufficient: unknown configuration keys survive on the daemon wire.

| Raw source | Excluded from Settings/renderer metadata |
| --- | --- |
| MCP list/get | `path`, entire `config`, raw file `error`, server `problem`, status `detail` |
| MCP config/manifest | `command`, `args`, `env`, `cwd`, URLs, headers, OAuth/auth objects, client secrets and arbitrary unknown keys |
| Plugin detail | Raw `manifest`, every variable `value` even when `secret:false`, auth codes/links/callbacks, command and URL |
| Provider status | `detail` and `base_url`, including masked key fragments and embedded URL credentials/query/path |
| Device/update/relay | Raw diagnostic errors and relay URLs; use booleans and fixed generic messages |
| Bot metadata | Native working-directory paths and unused permission/instruction configuration |
| Native connection | Serve token, home path, private keys, raw socket/auth error objects |

Provider `detail` is especially easy to misuse: the daemon masks an API key but appends the **unredacted base URL**, and custom providers without a key put the raw URL there directly. It can also include account email. [credentials.rs:297–349](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/credentials.rs#L297-L349).

Plugin variable secrecy depends on manifest classification; an incorrectly classified value still leaves the Runner through `plugins.detail`. The full manifest can contain literal `client_secret`, environment values or headers independently of variables. [plugins/mod.rs:75–168](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/plugins/mod.rs#L75-L168), [plugins/mod.rs:884–887](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/plugins/mod.rs#L884-L887).

Display metadata remains untrusted text, never HTML, executable configuration or an instruction to open a URL. Deliberately authored chat content is distinct from credential/configuration metadata; this boundary does not claim to remove secrets a user typed into their own messages.

## Separate controlled writes and remaining exclusions

The protocol supports persistent profile changes with `bots.update {id,...patch}` returning `{bot}`. Name/provider accept nonempty strings; description is trimmed and can clear; `model:""` and `thinking:""` restore provider defaults. Current Lorca also accepts `permissions`; both versions accept `runner_id` and `workdir`. These writes publish the roster and affect later turns. The controlled editor exposes provider/model/thinking and Runner patches only; identity, working-directory and access-management changes remain excluded. [Current api.rs:261–289](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/crates/cli/src/api.rs#L261-L289), [fork api.rs:237–261](https://github.com/charlzyx/lorca/blob/72478382674be5d3a06e0a365c7eb089d3e62db5/crates/cli/src/api.rs#L237-L261).

Other deferred operations include:

- Provider OAuth sign-in remains excluded. API-key/custom-provider configuration uses an isolated native-controlled editor; `providers.api_key` stays main-process-only and existing credentials are never echoed.
- MCP hide-tool and OAuth sign-in/out remain excluded. Save/remove/enable/reconnect/reload are explicit native-confirmed operations, never a read-only Refresh.
- Access grants and model/provider selection for automatic review remain excluded. Both pinned versions support the enabled/rules editor; newer provider/models fields are not sent.
- Working directories, device pairing/unpairing, service installation/start/stop and automatic updates. They change execution location, access or running software.
- Relay editing: `config.set {relay_url:string|null}` returns `{relay_url}` and changes the synchronization destination. `LORCA_RELAY_URL` overrides the saved value. This is different from choosing this interface's local socket endpoint.
- Device rename: `device.rename {name}` returns `{name}` and renames this device only, not an arbitrary Runner by ID.

Lorca's desktop appearance/language/send-on-return/timestamps are local `preferences.json` fields, not account RPCs. BB does not read or overwrite that file. [desktop/prefs.go:14–70](https://github.com/egoist/lorca/blob/2e360b0611a4ddd845090b2c5802a0af421f5855/desktop/prefs.go#L14-L70).

## macOS handoff and verification

Use the [application README](../apps/lorca/README.md#run) from a fresh checkout with Node 22.19+:

```sh
node apps/lorca/scripts/focused.mjs install
node apps/lorca/scripts/focused.mjs check
node apps/lorca/scripts/focused.mjs desktop
```

Start the intended Lorca CLI separately. The default is `ws://127.0.0.1:4862/ws` with the existing token in `~/.lorca/serve-token`. To use an already configured isolated daemon, pass its matching home and port at launch:

```sh
LORCA_HOME="$HOME/.lorca-dev" LORCA_PORT=4863 node apps/lorca/scripts/focused.mjs desktop
```

For the pinned older unauthenticated fork only, explicitly opt in:

```sh
LORCA_ALLOW_LEGACY=1 node apps/lorca/scripts/focused.mjs desktop
```

Legacy mode stays loopback-only and displays a warning. It is never selected automatically after token/auth failure. These commands do not create an identity, read another account's configuration, or launch a Runner. The first explicit desktop launch can download the official Electron runtime when absent.

The Settings inventory is also available through the same native SDK and `bb-lorca` CLI:

```sh
node apps/lorca/scripts/focused.mjs cli settings
node apps/lorca/scripts/focused.mjs cli settings '{"runnerId":"YOUR_RUNNER_ID"}'
```

Native SDK callers instantiate `SettingsInventory` from `native/settings.cjs` with an existing `LorcaBridge`, call `get({runnerId?})`, and call `dispose()` when finished. The explicit Settings operation performs `bootstrap` plus `mcp.list`; ordinary chat commands do not add an inventory request. See the [command-line surface](../apps/lorca/README.md#programmatic-and-command-line-surface).

Validate with deterministic fixtures and fake local tokens, including credentials hidden in nested config, URLs and errors, missing legacy fields, nullable tool counts, and identity/reconnect races. Runtime evidence and remaining macOS packaging/launch limits are recorded in [verification](lorca-verification.md); source compatibility is not a substitute for a real macOS run.
