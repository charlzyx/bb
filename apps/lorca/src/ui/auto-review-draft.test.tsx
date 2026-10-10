import assert from "node:assert/strict";
import { test } from "node:test";
import {
  autoReviewDraftFlags,
  autoReviewSubmission,
  createAutoReviewDraft,
  policySnapshot,
  reconcileAutoReviewDraft,
  type AutoReviewDraftState,
} from "./settings/auto-review-draft";
import type { SettingsEditor } from "./types";

function editor(revision = "ticket-one"): SettingsEditor {
  return {
    revision,
    models: [],
    bots: [],
    providers: [],
    canUpdateBots: false,
    canAddProvider: false,
    canManageMcp: false,
    autoReview: {
      status: "ready",
      isEnabled: false,
      rules: [
        { id: "rule-one", text: "Original note", behavior: "ask", tool: "messages/send" },
        { id: "rule-two", text: "Ask before other changes", behavior: "ask", tool: null },
      ],
    },
  };
}

function editedDraft(): AutoReviewDraftState {
  const draft = createAutoReviewDraft(policySnapshot(editor()));
  return {
    ...draft,
    isEnabled: true,
    rules: draft.rules.map((rule, index) => index === 0 ? { ...rule, text: "Private edited note" } : rule),
    reviewing: true,
    showValidation: true,
  };
}

test("Policy refresh renews a capability ticket without replacing edits or review state", () => {
  const draft = editedDraft();
  const refreshed = reconcileAutoReviewDraft(draft, policySnapshot(editor("ticket-two")));
  assert.equal(refreshed.baseline?.revision, "ticket-two");
  assert.equal(refreshed.baseline?.contentKey, draft.baseline?.contentKey);
  assert.equal(refreshed.rules, draft.rules);
  assert.equal(refreshed.isEnabled, true);
  assert.equal(refreshed.reviewing, true);
  assert.equal(refreshed.showValidation, true);
  assert.equal(refreshed.outcome, null);
  assert.equal(draft.baseline?.revision, "ticket-one");
  const snapshot = policySnapshot(editor("ticket-two"));
  assert.equal(autoReviewDraftFlags(refreshed, snapshot, false).conflict, false);
  const action = autoReviewSubmission(refreshed, snapshot, false);
  assert.ok(action && action.kind === "autoReview.set");
  assert.equal(action.revision, "ticket-two");
  assert.equal(action.isEnabled, true);
  assert.equal(action.rules[0].text, "Private edited note");
});

for (const outcome of ["unknownOutcome", "applied", "failed", "cancelled"] as const) {
  test(`A renewed ticket never clears ${outcome} state`, () => {
    const draft = { ...editedDraft(), reviewing: false, outcome };
    const refreshed = reconcileAutoReviewDraft(draft, policySnapshot(editor("ticket-next")));
    assert.equal(refreshed.baseline?.revision, "ticket-next");
    assert.equal(refreshed.outcome, outcome);
    assert.equal(refreshed.rules, draft.rules);
    assert.equal(refreshed.isEnabled, true);
    if (outcome === "unknownOutcome" || outcome === "applied") {
      assert.equal(autoReviewDraftFlags(refreshed, policySnapshot(editor("ticket-next")), false).locked, true);
      assert.equal(autoReviewSubmission({ ...refreshed, reviewing: true }, policySnapshot(editor("ticket-next")), false), null);
    }
  });
}

test("A refresh while a mutation is pending preserves the pending draft and review", () => {
  const draft = { ...editedDraft(), pending: true };
  const refreshed = reconcileAutoReviewDraft(draft, policySnapshot(editor("pending-readback-ticket")));
  assert.equal(refreshed.pending, true);
  assert.equal(refreshed.reviewing, true);
  assert.equal(refreshed.rules, draft.rules);
  assert.equal(refreshed.baseline?.revision, "pending-readback-ticket");
});

const mutations: [string, (value: SettingsEditor) => void][] = [
  ["enabled state", (value) => { value.autoReview.isEnabled = true; }],
  ["rule ID", (value) => { value.autoReview.rules[0].id = "different-id"; }],
  ["rule text", (value) => { value.autoReview.rules[0].text = "Other client's note"; }],
  ["rule whitespace", (value) => { value.autoReview.rules[0].text += " "; }],
  ["behavior", (value) => { value.autoReview.rules[0].behavior = "allow"; }],
  ["tool", (value) => { value.autoReview.rules[0].tool = "messages/delete"; }],
  ["nullable tool", (value) => { value.autoReview.rules[1].tool = ""; }],
  ["rule order", (value) => { value.autoReview.rules.reverse(); }],
  ["rule removal", (value) => { value.autoReview.rules.pop(); }],
  ["empty rules", (value) => { value.autoReview.rules = []; }],
];
for (const [field, mutate] of mutations) {
  test(`A changed ${field} preserves the dirty baseline for conflict handling`, () => {
    const draft = editedDraft();
    const incoming = editor("new-capability-ticket");
    mutate(incoming);
    const snapshot = policySnapshot(incoming);
    assert.notEqual(snapshot?.contentKey, draft.baseline?.contentKey);
    assert.equal(reconcileAutoReviewDraft(draft, snapshot), draft);
    assert.equal(draft.baseline?.revision, "ticket-one");
    assert.equal(autoReviewDraftFlags(draft, snapshot, false).conflict, true);
    assert.equal(autoReviewSubmission(draft, snapshot, false), null);
  });
}

test("Unavailable readback does not erase private edits or uncertainty", () => {
  const draft = { ...editedDraft(), outcome: "unknownOutcome" as const };
  assert.equal(reconcileAutoReviewDraft(draft, null), draft);
  assert.equal(autoReviewDraftFlags(draft, null, false).locked, true);
  assert.equal(autoReviewSubmission(draft, null, false), null);
  const unsupported = editor();
  unsupported.autoReview.status = "unavailable";
  assert.equal(reconcileAutoReviewDraft(draft, policySnapshot(unsupported)), draft);
});

test("Only a clean idle draft automatically adopts changed configuration", () => {
  const baseline = policySnapshot(editor());
  const draft = createAutoReviewDraft(baseline);
  const incoming = editor("changed-ticket");
  incoming.autoReview.isEnabled = true;
  const snapshot = policySnapshot(incoming);
  assert.equal(reconcileAutoReviewDraft(draft, snapshot).baseline, snapshot);
  for (const state of [
    { ...draft, reviewing: true },
    { ...draft, pending: true },
    { ...draft, outcome: "unknownOutcome" as const },
  ]) assert.equal(reconcileAutoReviewDraft(state, snapshot), state);
});

test("A newly mounted account scope never inherits the previous private draft", () => {
  const previousScope = { ...editedDraft(), outcome: "unknownOutcome" as const, pending: true };
  const nextScope = createAutoReviewDraft(null);
  assert.equal(nextScope.baseline, null);
  assert.deepEqual(nextScope.rules, []);
  assert.equal(nextScope.outcome, null);
  assert.equal(nextScope.pending, false);
  assert.equal(previousScope.rules[0].text, "Private edited note");
  const incoming = policySnapshot(editor("new-account-ticket"));
  const ready = reconcileAutoReviewDraft(nextScope, incoming);
  assert.equal(ready.rules[0].text, "Original note");
  assert.equal(ready.baseline?.revision, "new-account-ticket");
});
