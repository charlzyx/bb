import { useRef, useState, type SetStateAction } from "react";
import type { SettingsAction, SettingsActionResult, SettingsEditor } from "../types";

export type RuleDraft = {
  key: number;
  id?: string;
  text: string;
  behavior: "allow" | "ask";
  tool: string;
};

function snapshotRules(editor: SettingsEditor | undefined): RuleDraft[] {
  return (editor?.autoReview.rules ?? []).map((rule, index) => ({
    key: index,
    id: rule.id,
    text: rule.text,
    behavior: rule.behavior,
    tool: rule.tool ?? "",
  }));
}

function rulePayload(rules: RuleDraft[]) {
  return rules.map((rule) => ({
    ...(rule.id === undefined ? {} : { id: rule.id }),
    text: rule.text.trim(),
    behavior: rule.behavior,
    ...(rule.tool.trim() ? { tool: rule.tool.trim() } : {}),
  }));
}

export function policySnapshot(editor: SettingsEditor | undefined) {
  if (
    !editor ||
    editor.autoReview.status !== "ready" ||
    editor.autoReview.isEnabled === null
  ) return null;
  return {
    revision: editor.revision,
    contentKey: JSON.stringify({
      isEnabled: editor.autoReview.isEnabled,
      rules: editor.autoReview.rules.map(({ id, text, behavior, tool }) => ({ id, text, behavior, tool })),
    }),
    isEnabled: editor.autoReview.isEnabled,
    rules: snapshotRules(editor),
  };
}

export type AutoReviewDraftState = {
  baseline: ReturnType<typeof policySnapshot>;
  isEnabled: boolean;
  rules: RuleDraft[];
  reviewing: boolean;
  pending: boolean;
  showValidation: boolean;
  outcome: SettingsActionResult["status"] | "failed" | null;
};

export function createAutoReviewDraft(snapshot: ReturnType<typeof policySnapshot>): AutoReviewDraftState {
  return {
    baseline: snapshot,
    isEnabled: snapshot?.isEnabled ?? false,
    rules: snapshot?.rules ?? [],
    reviewing: false,
    pending: false,
    showValidation: false,
    outcome: null,
  };
}

export function reconcileAutoReviewDraft(draft: AutoReviewDraftState, snapshot: ReturnType<typeof policySnapshot>): AutoReviewDraftState {
  if (!snapshot) return draft;
  if (snapshot.contentKey === draft.baseline?.contentKey) {
    if (snapshot.revision === draft.baseline.revision) return draft;
    return { ...draft, baseline: { ...draft.baseline, revision: snapshot.revision } };
  }
  const dirty = draft.baseline !== null && (
    draft.isEnabled !== draft.baseline.isEnabled ||
    JSON.stringify(rulePayload(draft.rules)) !== JSON.stringify(rulePayload(draft.baseline.rules))
  );
  if (!dirty && !draft.pending && !draft.reviewing && draft.outcome === null) return createAutoReviewDraft(snapshot);
  return draft;
}

export function autoReviewDraftFlags(draft: AutoReviewDraftState, currentSnapshot: ReturnType<typeof policySnapshot>, disabled: boolean) {
  const { baseline, isEnabled, rules, reviewing, pending, outcome } = draft;
  const hasEmptyRule = rules.some((rule) => !rule.text.trim());
  const toolCounts = new Map<string, number>();
  for (const rule of rules) {
    const tool = rule.tool.trim();
    if (tool) toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
  }
  const duplicateTools = [...toolCounts].filter(([, count]) => count > 1).map(([tool]) => tool);
  const needsRefresh = outcome === "applied" || outcome === "unknownOutcome";
  const dirty = baseline !== null && (
    isEnabled !== baseline.isEnabled ||
    JSON.stringify(rulePayload(rules)) !== JSON.stringify(rulePayload(baseline.rules))
  );
  const snapshotChanged = currentSnapshot !== null && currentSnapshot.contentKey !== baseline?.contentKey;
  const conflict = snapshotChanged && !pending && !needsRefresh;
  const locked = disabled || pending || needsRefresh || conflict || !currentSnapshot;
  const fieldsLocked = locked || reviewing;

  return { hasEmptyRule, duplicateTools, needsRefresh, dirty, conflict, locked, fieldsLocked };
}

export function autoReviewSubmission(draft: AutoReviewDraftState, currentSnapshot: ReturnType<typeof policySnapshot>, disabled: boolean): SettingsAction | null {
  const flags = autoReviewDraftFlags(draft, currentSnapshot, disabled);
  if (flags.locked || !draft.reviewing || !draft.baseline || flags.hasEmptyRule || flags.duplicateTools.length > 0 || !flags.dirty) return null;
  return {
    kind: "autoReview.set",
    revision: draft.baseline.revision,
    isEnabled: draft.isEnabled,
    rules: rulePayload(draft.rules),
  };
}

export function useAutoReviewDraft({ editor, disabled, onAction }: {
  editor: SettingsEditor | undefined;
  disabled: boolean;
  onAction: (action: SettingsAction) => Promise<SettingsActionResult>;
}) {
  const [draft, setDraft] = useState(() => createAutoReviewDraft(policySnapshot(editor)));
  const { baseline, isEnabled, rules, reviewing, pending, showValidation, outcome } = draft;
  const setBaseline = (baseline: AutoReviewDraftState["baseline"]) => setDraft((current) => ({ ...current, baseline }));
  const setIsEnabled = (update: SetStateAction<boolean>) => setDraft((current) => ({ ...current, isEnabled: typeof update === "function" ? update(current.isEnabled) : update }));
  const setRules = (update: SetStateAction<RuleDraft[]>) => setDraft((current) => ({ ...current, rules: typeof update === "function" ? update(current.rules) : update }));
  const setReviewing = (reviewing: boolean) => setDraft((current) => ({ ...current, reviewing }));
  const setPending = (pending: boolean) => setDraft((current) => ({ ...current, pending }));
  const setShowValidation = (showValidation: boolean) => setDraft((current) => ({ ...current, showValidation }));
  const setOutcome = (outcome: AutoReviewDraftState["outcome"]) => setDraft((current) => ({ ...current, outcome }));
  const pendingRef = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const currentSnapshot = policySnapshot(editor);
  const { hasEmptyRule, duplicateTools, needsRefresh, dirty, conflict, locked, fieldsLocked } = autoReviewDraftFlags(draft, currentSnapshot, disabled);

  const reconciled = reconcileAutoReviewDraft(draft, currentSnapshot);
  if (reconciled !== draft) setDraft(reconciled);

  function adoptCurrent() {
    if (disabled || pending || !currentSnapshot) return;
    setBaseline(currentSnapshot);
    setIsEnabled(currentSnapshot.isEnabled);
    setRules(currentSnapshot.rules);
    setOutcome(null);
    setShowValidation(false);
    setReviewing(false);
  }

  function updateRule(key: number, update: Partial<Omit<RuleDraft, "key" | "id">>) {
    setRules((current) =>
      current.map((rule) => (rule.key === key ? { ...rule, ...update } : rule)),
    );
    setOutcome(null);
  }

  function reviewChanges() {
    if (locked || !dirty) return;
    setShowValidation(true);
    setOutcome(null);
    if (hasEmptyRule || duplicateTools.length) return;
    setReviewing(true);
    requestAnimationFrame(() => reviewRef.current?.focus());
  }

  async function submitChanges() {
    const action = autoReviewSubmission(draft, currentSnapshot, disabled);
    if (pendingRef.current || !action) return;
    pendingRef.current = true;
    setPending(true);
    setOutcome(null);
    try {
      const result = await onAction(action);
      setOutcome(result.status);
    } catch {
      setOutcome("failed");
    } finally {
      pendingRef.current = false;
      setPending(false);
      setReviewing(false);
      requestAnimationFrame(() => resultRef.current?.focus());
    }
  }

  return {
    editor, disabled, baseline, isEnabled, rules, reviewing, pending, showValidation,
    outcome, resultRef, reviewRef, hasEmptyRule, currentSnapshot, duplicateTools,
    needsRefresh, dirty, conflict, locked, fieldsLocked, adoptCurrent, updateRule,
    reviewChanges, submitChanges, setIsEnabled, setRules, setReviewing, setOutcome,
  };
}
