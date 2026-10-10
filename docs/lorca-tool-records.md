# Tool records in the conversation

dots presents adjacent tool messages as a compact **display group**. A group is not a model turn, a job, or evidence that its operations shared one execution context. The Lorca message protocol does not provide the association needed to make that claim.

## Display contract

- Consecutive tool records with the same author and observed activity boundary share a display group. Historical records without a boundary may share a group with adjacent historical records by the same author.
- Every non-tool entry breaks the group: user messages, assistant text, permission cards, cross-agent messages, and notices. A different author or observed boundary also breaks it. Message order is preserved.
- Completed groups begin collapsed. Running groups keep the latest running tool's reported summary visible outside the collapsed details. The client does not invent a purpose, percentage, duration, or successful result.
- Groups containing errors begin expanded and show an error summary outside the details. Users may collapse them; the error indicator remains visible. Permission cards and their actions are never placed inside a tool group.
- User expansion choices are keyed by message ID, not summary text or array index. Streaming replacements and prepended history retain choices for existing messages even when the group's first ID changes. A retained member anchors the group key; splitting a group produces distinct keys. Group, individual-detail, and anchor maps are each bounded to 4,000 entries.
- The outer conversation session is keyed by the controller's account epoch. An account change remounts that subtree and clears expansion choices even when the new account reuses a chat or message ID.
- Message-level failures take precedence over ordinary completed-tool presentation. Details contain the daemon-provided, projected content; they do not fetch raw tool arguments or results.

## What an observed boundary means

`observedBoundary` is client-local display metadata. A snapshot or an observed `job.started` / `job.finished` event advances a per-chat counter. A previously unseen `message.added` tool record receives the counter at arrival. Updating an existing message does not reassign it. Snapshot and paginated historical messages do not receive an inferred boundary; retained records may keep their existing metadata. Account changes discard the old account's metadata.

The token deliberately contains no job ID. A delayed message from an earlier job may arrive in a later observation interval. Simultaneous jobs can share an interval. Consequently this token only prevents some undesirable visual joins; it cannot prove turn ownership or reconstruct missing history. No timestamp threshold or model-generated explanation is used to fill that gap.

Source baseline: Lorca [`64bf5e186064688f441e88a78bda6ee2e607c221`](https://github.com/egoist/lorca/commit/64bf5e186064688f441e88a78bda6ee2e607c221).

- [`Message`, model.rs 649–680](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/model.rs#L649-L680) has no turn or job identifier.
- [`Message::new`, model.rs 726–739](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/model.rs#L726-L739) assigns a random message UUID, not a job-prefixed ID.
- [Tool creation, turns.rs 1381–1411](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/turns.rs#L1381-L1411) keeps the tool-call/message association internally; it does not attach job ownership to the app message.
- [`Job`, model.rs 1110–1126](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/model.rs#L1110-L1126) has a triggering message, but that field is not part of each returned message.
- [Events, events.rs 26–46](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/events.rs#L26-L46) publish message and job events separately.
- [`Message::for_app`, model.rs 699–723](https://github.com/egoist/lorca/blob/64bf5e186064688f441e88a78bda6ee2e607c221/crates/cli/src/model.rs#L699-L723) removes raw tool arguments/results and limits ordinary tool detail. Expanding a record does not restore omitted content.

## Beautiful UI reference

The interaction research used the actual [Beautiful UI](https://www.beautifului.dev/) source at [`44a274e598395ab61e7c96c26fda2758780253b7`](https://github.com/slev12397/beautiful-ui/commit/44a274e598395ab61e7c96c26fda2758780253b7):

- [ToolChips.tsx](https://github.com/slev12397/beautiful-ui/blob/44a274e598395ab61e7c96c26fda2758780253b7/components/primitives/ToolChips.tsx#L107-L249): compact header, tool rows, and expandable details.
- [TaskRows.tsx](https://github.com/slev12397/beautiful-ui/blob/44a274e598395ab61e7c96c26fda2758780253b7/components/primitives/TaskRows.tsx#L136-L268): inline working and failure indicators.
- [ThinkingState.tsx](https://github.com/slev12397/beautiful-ui/blob/44a274e598395ab61e7c96c26fda2758780253b7/components/primitives/ThinkingState.tsx#L93-L123): separate automatic and manually selected expansion states.

Those components are [MIT licensed, copyright 2026 Shane Levine](https://github.com/slev12397/beautiful-ui/blob/44a274e598395ab61e7c96c26fda2758780253b7/LICENSE). Their demonstration timers, sample results, and label-based keys are unsuitable for truthful streaming execution state. dots uses the interaction pattern as a design reference and implements its own state-driven components with existing BB UI primitives; it does not copy these source components or install the Beautiful UI package. This is not a claim of direct component adoption. Any future copied or substantially adapted source must retain its applicable license notice.

## Verification scope

`apps/lorca/tests/tool-groups.test.ts` covers display boundaries, duplicate summaries, expansion memory, historical prepend, running/error visibility, permission-card separation, escaped text, message-level failures, and the limited meaning of observed activity tokens. It uses synthetic messages and in-memory bridges. Browser interaction and published CI results are separate checks; these tests do not establish real daemon, model, or device execution.
