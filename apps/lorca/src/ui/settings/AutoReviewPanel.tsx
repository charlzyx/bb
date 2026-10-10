import { useId, useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import {
  SettingsRow,
  SettingsRowList,
  SettingsSection,
  SettingsWithControl,
} from "../../../../app/src/components/ui/settings-section";
import { approvalZh } from "../../locale/approval.zh-CN";
import type {
  SettingsAction,
  SettingsActionResult,
  SettingsEditor,
} from "../types";

type RuleDraft = {
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

export function AutoReviewPanel({
  editor,
  disabled,
  onAction,
}: {
  editor: SettingsEditor | undefined;
  disabled: boolean;
  onAction: (action: SettingsAction) => Promise<SettingsActionResult>;
}) {
  const panelId = useId();
  const [isEnabled, setIsEnabled] = useState(
    editor?.autoReview.isEnabled === true,
  );
  const [rules, setRules] = useState(() => snapshotRules(editor));
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [outcome, setOutcome] = useState<
    SettingsActionResult["status"] | "failed" | null
  >(null);
  const pendingRef = useRef(false);
  const nextRuleKey = useRef(rules.length);
  const resultRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const hasEmptyRule = rules.some((rule) => !rule.text.trim());
  const needsRefresh = outcome === "applied" || outcome === "unknownOutcome";
  const locked = disabled || pending || needsRefresh;
  const fieldsLocked = locked || reviewing;
  const dirty =
    isEnabled !== editor?.autoReview.isEnabled ||
    JSON.stringify(rulePayload(rules)) !==
      JSON.stringify(rulePayload(snapshotRules(editor)));

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
    if (hasEmptyRule) return;
    setReviewing(true);
    requestAnimationFrame(() => reviewRef.current?.focus());
  }

  async function submitChanges() {
    if (
      pendingRef.current ||
      locked ||
      !reviewing ||
      !editor ||
      editor.autoReview.status !== "ready" ||
      editor.autoReview.isEnabled === null ||
      hasEmptyRule ||
      !dirty
    ) {
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setOutcome(null);
    try {
      const result = await onAction({
        kind: "autoReview.set",
        revision: editor.revision,
        isEnabled,
        rules: rulePayload(rules),
      });
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

  if (
    !editor ||
    editor.autoReview.status !== "ready" ||
    editor.autoReview.isEnabled === null
  ) {
    return (
      <SettingsSection title={approvalZh.title} description={approvalZh.description}>
        <div className="lorca-settings-empty" role="status">
          <Icon name="Info" />
          <div>
            <h3>{approvalZh.unavailableTitle}</h3>
            <p>
              {editor?.autoReview.status === "ready"
                ? approvalZh.unknownStateDescription
                : approvalZh.unavailableDescription}
            </p>
          </div>
        </div>
      </SettingsSection>
    );
  }

  return (
    <div className="lorca-auto-review-panel" aria-busy={pending}>
      <SettingsSection title={approvalZh.title} description={approvalZh.description}>
        <SettingsWithControl
          label={approvalZh.enableLabel}
          description={
            isEnabled
              ? approvalZh.enabledDescription
              : approvalZh.disabledDescription
          }
          controlPlacement="trailing"
        >
          <Button
            type="button"
            variant={isEnabled ? "default" : "outline"}
            size="sm"
            role="switch"
            aria-checked={isEnabled}
            aria-label={approvalZh.enableLabel}
            disabled={fieldsLocked}
            onClick={() => {
              setIsEnabled((current) => !current);
              setOutcome(null);
            }}
          >
            <Icon name={isEnabled ? "CircleCheck" : "Circle"} />
            {isEnabled ? approvalZh.enabled : approvalZh.disabled}
          </Button>
        </SettingsWithControl>
      </SettingsSection>
      <SettingsSection
        title={approvalZh.rulesTitle}
        description={approvalZh.rulesDescription}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={fieldsLocked}
            onClick={() => {
              const key = nextRuleKey.current++;
              setRules((current) => [
                ...current,
                { key, text: "", behavior: "ask", tool: "" },
              ]);
              setOutcome(null);
            }}
          >
            <Icon name="Plus" />
            {approvalZh.addRule}
          </Button>
        }
      >
        {rules.length ? (
          <SettingsRowList>
            {rules.map((rule, index) => (
              <SettingsRow key={rule.key} className="lorca-approval-rule">
                <div className="lorca-approval-rule-fields">
                  <label htmlFor={`${panelId}-text-${rule.key}`}>
                    {approvalZh.ruleLabel(index + 1)} · {approvalZh.ruleText}
                    <Input
                      id={`${panelId}-text-${rule.key}`}
                      value={rule.text}
                      placeholder={approvalZh.ruleTextPlaceholder}
                      disabled={fieldsLocked}
                      aria-invalid={showValidation && !rule.text.trim()}
                      aria-describedby={
                        showValidation && !rule.text.trim()
                          ? `${panelId}-validation`
                          : undefined
                      }
                      onChange={(event) =>
                        updateRule(rule.key, { text: event.target.value })
                      }
                    />
                  </label>
                  <label htmlFor={`${panelId}-behavior-${rule.key}`}>
                    {approvalZh.ruleBehavior}
                    <div className="lorca-settings-select">
                      <select
                        id={`${panelId}-behavior-${rule.key}`}
                        value={rule.behavior}
                        disabled={fieldsLocked}
                        onChange={(event) => {
                          const behavior = event.target.value;
                          if (behavior === "ask" || behavior === "allow") {
                            updateRule(rule.key, { behavior });
                          }
                        }}
                      >
                        <option value="ask">{approvalZh.ask}</option>
                        <option value="allow">{approvalZh.allow}</option>
                      </select>
                      <Icon name="ChevronDown" />
                    </div>
                  </label>
                  <label htmlFor={`${panelId}-tool-${rule.key}`}>
                    {approvalZh.ruleTool}
                    <Input
                      id={`${panelId}-tool-${rule.key}`}
                      value={rule.tool}
                      placeholder={approvalZh.ruleToolPlaceholder}
                      spellCheck={false}
                      disabled={fieldsLocked}
                      onChange={(event) =>
                        updateRule(rule.key, { tool: event.target.value })
                      }
                    />
                  </label>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={approvalZh.removeRule(index + 1)}
                  disabled={fieldsLocked}
                  onClick={() => {
                    setRules((current) =>
                      current.filter((candidate) => candidate.key !== rule.key),
                    );
                    setOutcome(null);
                  }}
                >
                  <Icon name="Trash2" />
                </Button>
              </SettingsRow>
            ))}
          </SettingsRowList>
        ) : (
          <div className="lorca-settings-empty">
            <Icon name="ListTodo" />
            <div>
              <h3>{approvalZh.noRules}</h3>
              <p>{approvalZh.noRulesDescription}</p>
            </div>
          </div>
        )}
        {!isEnabled && (
          <p className="lorca-input-help">{approvalZh.rulesDisabled}</p>
        )}
        {showValidation && hasEmptyRule && (
          <p className="lorca-field-error" id={`${panelId}-validation`} role="alert">
            {approvalZh.emptyRuleError}
          </p>
        )}
      </SettingsSection>
      {reviewing && (
        <div
          ref={reviewRef}
          className="lorca-approval-confirmation"
          role="region"
          aria-labelledby={`${panelId}-review-title`}
          tabIndex={-1}
        >
          <h3 id={`${panelId}-review-title`}>{approvalZh.reviewTitle}</h3>
          <p>{approvalZh.reviewDescription}</p>
          <p>{isEnabled ? approvalZh.reviewEnabled : approvalZh.reviewDisabled}</p>
          {rules.length ? (
            <ol className="lorca-approval-review-list">
              {rules.map((rule) => (
                <li key={rule.key}>
                  <strong>
                    {rule.behavior === "allow" ? approvalZh.allow : approvalZh.ask}
                  </strong>
                  <p>{rule.text.trim()}</p>
                  <span>
                    {rule.tool.trim()
                      ? approvalZh.ruleScope(rule.tool.trim())
                      : approvalZh.allTools}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>{approvalZh.reviewNoRules}</p>
          )}
          <p className="lorca-input-help">{approvalZh.nativeConfirmation}</p>
        </div>
      )}
      {outcome && (
        <div
          ref={resultRef}
          className={
            outcome === "failed" || outcome === "unknownOutcome"
              ? "lorca-settings-warning"
              : "lorca-settings-boundary-note"
          }
          role={outcome === "failed" || outcome === "unknownOutcome" ? "alert" : "status"}
          tabIndex={-1}
        >
          <Icon name={outcome === "applied" ? "Check" : "Info"} />
          <p>{approvalZh[outcome]}</p>
        </div>
      )}
      <footer className="lorca-auto-review-actions">
        <p className="lorca-input-help">{approvalZh.draftNotice}</p>
        <div className="lorca-settings-form-actions">
          {reviewing ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={locked}
                onClick={() => void submitChanges()}
              >
                {pending && <Icon name="Loading" />}
                {pending ? approvalZh.submitting : approvalZh.confirm}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setReviewing(false)}
              >
                {approvalZh.cancel}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                disabled={locked || !dirty}
                onClick={reviewChanges}
              >
                {approvalZh.review}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={locked || !dirty}
                onClick={() => {
                  setIsEnabled(editor.autoReview.isEnabled === true);
                  setRules(snapshotRules(editor));
                  setOutcome(null);
                  setShowValidation(false);
                }}
              >
                {approvalZh.reset}
              </Button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
