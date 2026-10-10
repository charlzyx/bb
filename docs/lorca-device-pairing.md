# Lorca device pairing: protocol and native boundary

## Pinned source and delivery status

This pairing-specific review targets [`egoist/lorca` `64bf5e186064688f441e88a78bda6ee2e607c221`](https://github.com/egoist/lorca/commit/64bf5e186064688f441e88a78bda6ee2e607c221), observed as `main` on 2026-10-10 at approximately 06:14 UTC. The commit timestamp is 2026-10-10T06:04:57Z; its [Cargo version remains 0.1.11](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/Cargo.toml#L14-L15). This is a source revision, not a separate official protocol version.

The dots invitation/join feature is **in implementation**. This document defines the verified upstream contract and required native safeguards; it does not claim the feature, its tests, desktop runtime or CI has passed. Research used public source only. Development verification is limited to synthetic fixtures and mocked RPC; no real pairing code, credential, device enrollment or daemon mutation is needed.

The broader [protocol audit](lorca-protocol-audit.md) remains pinned to `3cc900f`. This pairing review does not re-audit all later chat, settings or relay changes. The direct `3cc900f` to `64bf5e1` diff of `pairing.rs` adds `channels: []` to the joining device metadata without changing the pairing request shapes below.

## Authority and roles

- **A, invitation device:** a computer already holding an account machine file. It offers a code to another device.
- **B, joining device:** a device with no current account machine file. It enters the code and receives access to the account.
- There is **no pending-device approval/rejection API**. `pair.accept` means B joins; it does not mean A approves a displayed request. Once A receives the first valid sealed request, it automatically attests B and sends the account data-encryption key in a reply sealed to B.
- The joined device receives account access, including encrypted chat data and the account's provider credentials. It does not receive the identity master secret through pairing. Computers become eligible Runners according to their OS; phones are devices but not Runners.

Sources: [identity architecture](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/docs/architecture/identity.md), [automatic attestation and reply](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/pairing.rs#L129-L189).

### Device inventory and Runner role

There is one Device entity. Runner is a role of that entity, not a second fleet or a separate enrollment. The current `devices_out` wire has `id`, `name`, `model`, `os`, `os_version`, `machine_key`, `is_this_device`, `status`, `last_seen`, `plugins`, `channels`, `version` and `update`; unknown machines additionally have `unknown:true`, blank names/system metadata and a smaller field subset. There is **no `role` or `is_runner` wire field**. Existing safe projections may retain a bounded subset; do not forward raw plugin/channel/update detail merely to build a device list. [Device projection](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/app.rs#L2080-L2124).

The official role rule is explicitly OS-derived: `macos|linux|windows` are Runners; `ios|ipados|android` are non-running devices. The daemon and official Mac, Go and phone models use that rule. Unknown OS is never a Runner. dots may centralize this interpretation in native as a derived `role:"runner"|"device"|"unknown"`, with `unknown:true` or unrecognized/missing OS mapping to unknown, so UI does not repeat the rule. This is a client DTO field, not a newly discovered upstream capability flag. [Rust rule](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/model.rs#L111-L115), [Mac model](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/macos/Sources/Lorca/Model/Models.swift#L357-L438), [identity role contract](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/docs/architecture/identity.md#devices-and-runners).

Show all devices in the device inventory. Bot execution-target pickers select only Runners, including offline ones; being an eligible Runner does not prove it is online or able to run a particular provider. Plugin/MCP management is Runner-scoped. A selected phone or unknown device should explain that it cannot run bots instead of creating a second Runner group. [Mac Runner selector](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/macos/Sources/Lorca/Model/AppStore.swift#L563-L566), [new-bot picker](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/macos/Sources/Lorca/Sheets/NewBotViewController.swift#L67-L72), [desktop plugin scope](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/desktop/settings_plugins.go#L50-L71).

The official device pane still says “Runner · runs bots with its own credentials,” but the current credential mechanism is account-wide encrypted provider synchronization. Prefer wording such as “Runner · 使用账户的服务商凭据运行智能体” and “设备 · 不运行智能体.” Plugin/MCP sign-ins and bot-requested secret storage can remain Runner-local; those must not be conflated with account provider credentials. [Existing role label](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/macos/Sources/Lorca/Settings/DeviceSettingsViewControllers.swift#L476-L481), [account credential scope](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/docs/architecture/identity.md#account-credentials).

## Local RPC contract

All methods use the existing authenticated local WebSocket request/response envelope. The following are main-process capabilities, not additions to unrestricted renderer RPC.

| Method | Parameters | Result and semantics |
| --- | --- | --- |
| `pair.start` | `{}` | `{nonce:string,pairing_string:string}`. Creates a new invitation; does not replace previous invitations. |
| `pair.status` | `{nonce:string}` | `{state:"waiting"}`, `{state:"completed",device:{id:string,name:string,os:string,model:string}}`, or `{state:"failed",error:string}`. Reads the local pending map only. |
| `pair.cancel` | `{nonce:string}` | `null`. Removes that local waiter and launches best-effort asynchronous relay mailbox deletion. |
| `pair.accept` | `{pairing_string:string,device_name?:string}` | Eventually `{id:string,name:string,os:string,identity_id:string}`. Starts joining; a newer call cancels the previous pending accept. |
| `pair.abort` | `{}` | `null`. Cancels the daemon's current global accept wait, without a nonce or ownership check. |
| `sync.account` | `{}` | `{providers:ProviderStatus[]}` after waiting up to 30 seconds for an initial account pull. The wait's success boolean is discarded; this result is not a complete-sync assertion. Raw provider statuses must stay out of the ordinary renderer. |
| `device.unpair` | `{id:string}` | `null`. Revokes a device, or forgets the local identity when the ID names this device. Documented for recovery context; outside this invitation/join implementation. |

Sources: [dispatcher](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/api.rs#L137-L209), [status and cancellation](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/pairing.rs#L193-L243), [status enum](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/app.rs#L103-L116), [account wait](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/sync.rs#L418-L442).

`pair.start` requires a configured relay URL and an existing machine file (`has_identity`). If not yet registered, it attempts registration; obtaining a relay token may also register an identity device again. A device without the identity master key additionally requires relay protocol 2 or newer. The `relay_connected` snapshot boolean is not a precondition: these HTTP operations attempt to contact the relay independently. Starting an invitation is therefore a state-changing operation, not a harmless preview. [Preconditions and creation](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/pairing.rs#L78-L126).

`pair.accept` rejects an existing identity before starting. It does not intentionally replace a current account. An omitted, empty or all-whitespace device name falls back to host facts. Returned device strings are untrusted display data; do not treat arbitrary `os` as a Runner or interpolate names into markup. [Join entry and metadata](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/pairing.rs#L217-L265).

## Pairing string and secret boundary

The canonical generated value is:

```text
lorca://pair?relay=<percent-encoded URL>&id=<identity public key>&ek=<ephemeral public key>&n=<nonce>
```

The public keys are base64url-encoded 32-byte keys. The relay creates a random 16-byte base64url nonce. The URI contains no master secret or account DEK, but possession of the complete live code authorizes joining the account. Treat the entire URI, nonce and derived QR image as sensitive capability material. They must not enter chat messages, ordinary renderer state, generic event payloads, logs, analytics, error strings, screenshots, persisted preferences or command-line arguments. The existing local `serve-token` is separate and must never be displayed.

The daemon parser is permissive: it accepts an arbitrary prefix containing `pair?`, duplicate fields with the last value winning, and does not impose an overall input-length or relay-scheme restriction. A dots secure editor must be stricter: bounded input, exact supported URI shape and fields, no duplicate fields/control characters, valid key/nonce encodings, and explicit relay destination validation before sending. Review the relay origin and target identity in the isolated confirmation. HTTPS is the safe default; any supported local HTTP development exception must be explicit and bounded. Reject userinfo and hidden query/fragment credentials rather than silently showing only a benign-looking origin. These are client restrictions, not guarantees supplied by Lorca.

Sources: [URI parser and generation](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/pairing.rs#L22-L105), [relay nonce and lifetime](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/relay/src/routes.rs#L742-L746), [key encoding](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/keys.rs#L14-L24).

## Lifecycle and truthful completion

### Invitation on A

1. User explicitly confirms that the code grants a new device account access. Main rereads/fences the current account, local device, relay and connection, then calls `pair.start` once.
2. The isolated window may display/copy the code. Poll the owned nonce with `pair.status`; upstream native apps use 1.5-second intervals. Do not make concurrent unbounded polls.
3. A's daemon receives one sealed request, validates the machine key/metadata match, registers or attests B, then posts the sealed reply.
4. It updates the local roster, optimistically marks B online, emits `pair.completed`, and sets local status to completed. This proves registration and reply publication, **not** that B retrieved the reply, opened its sync socket or downloaded its chats.
5. Hide and discard the code once used; refresh the safe device inventory. Describe account access and connectivity separately.

The optional raw event is `{event:"pair.completed",data:{nonce,device:{id,name,os,model}}}`. Polling is sufficient and avoids expanding generic event forwarding. The event is emitted before the background task updates `pair.status`, so an immediate status read may still say waiting. [Initiator order](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/pairing.rs#L109-L124), [attestation and event](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/pairing.rs#L152-L189).

### Joining on B

1. Only an unpaired local daemon may enter the user-confirmed joining flow. Enter the code in the isolated window, never in the general settings renderer.
2. `pair.accept` generates a machine key and posts a sealed request. `{event:"pair.posted",data:{nonce}}` means only that the request reached the relay.
3. It polls for the sealed reply for up to ten minutes, checks the reply's identity against the code, parses the DEK, saves the machine, sets the relay, clears/initializes local account state and starts normal synchronization.
4. It emits `identity.changed {has_identity:true}` and `snapshot` before returning the RPC result. Independent WebSocket tasks mean frame arrival order must not be assumed. The native flow must permit this one expected identity transition instead of treating its own success as a generic account-fence failure.
5. Before showing joined, reconcile the returned `identity_id` and device ID against fresh bootstrap on the same transport generation and expected account. The expected identity ID is the first eight bytes of SHA-256 of the **public-key string's UTF-8 bytes**, encoded as 16 lowercase hex characters. Other identity changes invalidate the flow.

A narrowly scoped main-only request timeout must accommodate this longer operation; do not globally relax normal RPC deadlines or automatically resend after timeout. An optional `sync.account` may help refresh provider availability, but no response here proves all history has synchronized. [Join and persistence](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/pairing.rs#L245-L319), [identity ID](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/keys.rs#L101-L104), [event shapes](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/events.rs#L66-L72).

## Expiry, cancellation and unknown outcomes

- Invitations are one-use: a mailbox accepts only its first request. A second receives 409; missing/expired/cancelled mailboxes receive 404. The relay mailbox expires after ten minutes; A independently times out its wait after ten minutes. A countdown is an estimate, not an exact expiration timestamp returned by `pair.start`.
- Closing the official invitation sheet with **Done** keeps the code alive. **Cancel** calls `pair.cancel`. dots must state its chosen close behavior explicitly; closing a window or WebSocket alone does not end daemon pairing tasks.
- `pair.cancel` is not revocation of an enrolled device. It removes the local waiter and asynchronously attempts mailbox deletion, ignoring that deletion's failure. Cancellation can race with registration; `null` does not prove no device was registered.
- `pair.abort` has no nonce, operation ID or per-WebSocket owner. It cancels whichever accept is current in the daemon. A newer accept likewise replaces an earlier one. Automatic abort after reconnect or account change could cancel another client's attempt. Any offered explicit abort must explain its daemon-wide scope and must not claim to revoke a device already registered by A.
- `pair.cancel`'s background task rereads the **current** relay and machine and may obtain/register a token. Upstream `forget_identity` does not clear the pairing/accepting slots. Only attempt one automatic owned-nonce cleanup while connection generation, account epoch, local device and relay remain unchanged. Otherwise hide the code and report uncertainty; never carry an old nonce into a new account context.
- A lost `pair.start` response leaves no known nonce; there is no list/recover-invitations API. Report unknown outcome and no automatic replay. A late response can be handled only under the original scope fence. Losing `pair.accept` acknowledgement also requires fresh identity reconciliation, not another join.
- `pair.status` exposes free-text errors, not stable error codes. Unknown nonce is also `failed`. Do not claim reliable typed distinctions between consumed, expired, cancelled and failed states, and do not forward arbitrary daemon errors to the ordinary renderer.
- Device unpairing is a separate action. It prevents future relay authentication for that machine key; it cannot prove deletion of previously copied data or provider credentials. It is not an implicit rollback for this flow.

Sources: [single-request mailbox](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/relay/src/db/sqlite.rs#L1012-L1019), [join errors and timeout](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/pairing.rs#L266-L286), [cancel/abort](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/pairing.rs#L193-L243), [identity forget](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/app.rs#L608-L656), [WebSocket dispatch lifetime](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/ws.rs#L149-L176), [device revocation](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/sync.rs#L672-L712).

## Native implementation requirements

Availability is a dots client policy decision, not an RPC capability probe. Pairing accepts an existing loopback bridge in token mode or explicitly selected compatibility mode. Defaults remain token-authenticated; there is no automatic downgrade. Relays may use HTTPS, or HTTP with a numeric RFC1918/127 IPv4 address or IPv6 loopback/ULA address. Public HTTP, DNS names (including localhost), link-local addresses, IPv4-mapped IPv6 and nonstandard IPv4 spellings are rejected. The isolated native confirmation discloses persistent account and Runner access, missing local serve-token validation where applicable, and HTTP transport risks before any pair mutation. The main renderer receives availability reasons, never codes or arbitrary relay addresses. Account, relay, endpoint, authentication mode, generation, nonce and frame fences remain checked. A disabled entry does not imply the daemon lacks pair RPCs; no invitation is generated to probe capability.

Upstream encrypts the pairing request and DEK reply with sealed boxes, but HTTP has no TLS protection: relay bearer credentials and metadata may still be observed or manipulated. The inspected daemon HTTP client does not prohibit redirects, and its proxy settings can affect destinations. Numeric input admission therefore does not prove every subsequent daemon request stays on the LAN. No actual account pairing was performed by these tests.

- A dedicated main-owned flow, with one active dots operation and exact trusted-frame IPC. Keep pairing methods out of the generic renderer allowlist.
- An ephemeral, sandboxed, context-isolated window with no Node integration, navigation, remote assets, arbitrary network requests, downloads or newly granted permissions. Input and output of codes stay in this window; copying is an explicit user action handled by main.
- The ordinary renderer receives only capability availability, bounded status and sanitized device metadata. No pairing string, nonce, QR, relay credential, account key or raw error crosses that boundary. Existing safe inventory supplies all device types rather than only Runners.
- Explicit confirmation before invitation creation or joining. Revalidate after confirmation. Identity creation/restoration, device unpair, account deletion and relay editing remain separate unsupported actions in this iteration.
- Endpoint/generation, account epoch, relay and local-device fences across awaits. No mutation replay. The expected joining transition is narrowly bound to the confirmed target account; any different account or transport transition invalidates it.
- Closing, cancellation, timeout and failed cleanup have truthful distinct outcomes. Clear secret display promptly, including on renderer loss; do not equate hiding the code with revoking access.
- Programmatic/CLI entry points must use the same native validation and outcome rules. Do not accept capability strings as ordinary command-line arguments or print them in routine status/error output; an intentional interactive secret surface needs its own explicit boundary.

## Upstream native reference flows

- macOS invitation: [start, polling, QR/copy, completion, Cancel and Done](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/macos/Sources/Lorca/Sheets/NewBotViewController.swift#L374-L447).
- Windows/Linux invitation: [native sheet](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/desktop/sheet_pairing.go#L29-L144).
- macOS join: [onboarding accept and initial account check](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/macos/Sources/Lorca/Onboarding/OnboardingWindowController.swift#L854-L888).
- Phone joins by scan/paste/deep link: [pairing screen](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/mobile/app/pair.tsx#L42-L152), [engine's posted/abort/accept handling](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/mobile/src/core/engine.ts#L1113-L1133).

## Required synthetic verification

Before calling the implementation complete, exercise exact-frame rejection, validation and no-secret projection; repeated clicks and one-operation admission; start/accept timeout and no replay; same-scope late nonce cleanup versus changed account/relay/connection; cancellation racing completion; unknown/failed status; expected identity events both before and after the response; mismatching join identity/device; close/crash/expiry; and code erasure. Verify sandbox, resource allowlists and clipboard behavior with synthetic fixture data only. Real device pairing, relay registration, credential access and user-computer testing require separate authorization and are not evidence produced by this source review.
