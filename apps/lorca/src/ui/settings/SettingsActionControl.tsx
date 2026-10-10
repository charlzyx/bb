import { useEffect, useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { editorZh } from "../../locale/editor.zh-CN";
import type { SettingsAction, SettingsActionResult } from "../types";

export function useSettingsMutation(onAction: (action: SettingsAction) => Promise<SettingsActionResult>) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SettingsActionResult["status"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const reset = () => { setResult(null); setError(null); };
  const run = async (action: SettingsAction) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    reset();
    try {
      const outcome = await onAction(action);
      if (mounted.current) setResult(outcome.status);
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : editorZh.failed);
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return { pending, result, error, reset, run };
}

export function SettingsMutationStatus({ result, error }: { result: SettingsActionResult["status"] | null; error: string | null }) {
  if (error) return <p className="lorca-field-error" role="alert">{error}</p>;
  if (!result) return null;
  return <p className={`lorca-admin-result${result === "unknownOutcome" ? " lorca-runtime-error" : ""}`} role={result === "unknownOutcome" ? "alert" : "status"}>
    {result === "applied" ? editorZh.saved : result === "cancelled" ? editorZh.cancelled : editorZh.unknownOutcome}
  </p>;
}

type ActionControlProps = {
  action: SettingsAction;
  label: string;
  confirmation?: string;
  onAction: (action: SettingsAction) => Promise<SettingsActionResult>;
  disabled?: boolean;
};

export function SettingsActionControl(props: ActionControlProps) {
  return <ActionControlSession key={props.action.revision} {...props} />;
}

function ActionControlSession({ action, label, confirmation, onAction, disabled = false }: {
  action: SettingsAction;
  label: string;
  confirmation?: string;
  onAction: (action: SettingsAction) => Promise<SettingsActionResult>;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) confirmationRef.current?.focus(); }, [confirming]);
  const mutation = useSettingsMutation(onAction);
  const blocked = disabled || mutation.pending || mutation.result === "unknownOutcome" || mutation.result === "applied";
  return <div className="lorca-admin-action">
    {!confirming ? <Button ref={triggerRef} size="sm" variant="outline" disabled={blocked} onClick={() => {
      mutation.reset();
      if (confirmation) setConfirming(true);
      else void mutation.run(action);
    }}>{mutation.pending && <Icon name="Loading" />}{mutation.pending ? editorZh.saving : label}</Button> : <div ref={confirmationRef} tabIndex={-1} className="lorca-admin-confirmation" role="group" aria-label={editorZh.reviewChanges}>
      <p>{confirmation}</p>
      <div className="lorca-admin-buttons">
        <Button size="sm" disabled={blocked} onClick={() => { setConfirming(false); void mutation.run(action); }}>{editorZh.confirm}</Button>
        <Button size="sm" variant="ghost" disabled={blocked} onClick={() => { setConfirming(false); requestAnimationFrame(() => triggerRef.current?.focus()); }}>{editorZh.cancel}</Button>
      </div>
    </div>}
    <SettingsMutationStatus result={mutation.result} error={mutation.error} />
  </div>;
}
