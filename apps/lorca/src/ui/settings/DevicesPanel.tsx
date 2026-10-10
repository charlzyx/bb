import { useEffect, useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  SettingsDetailRow,
  SettingsRowList,
  SettingsSection,
} from "../../../../app/src/components/ui/settings-section";
import { settingsZh } from "../../locale/settings.zh-CN";
import type { LorcaShellActions, RuntimeSettings } from "../types";
import { DevicesInventory, InventoryEmpty } from "./RuntimePanels";

type PairingMode = "invite" | "join";

export function PairingAction({ mode, onOpenPairing, disabled, compact = false }: {
  mode: PairingMode;
  compact?: boolean;
  onOpenPairing?: LorcaShellActions["onOpenPairing"];
  disabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [closed, setClosed] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const open = async () => {
    if (disabled || !onOpenPairing || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setClosed(false);
    setFailed(false);
    try {
      await onOpenPairing(mode);
      if (mounted.current) setClosed(true);
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return (
    <div className={`lorca-device-pairing-action${compact ? " lorca-device-pairing-compact" : ""}`} aria-busy={pending}>
      <Button size="sm" disabled={disabled || pending || !onOpenPairing} onClick={() => void open()}>
        {pending && <Icon name="Loading" />}
        {pending ? settingsZh.pairingOpening : mode === "invite" ? compact ? settingsZh.pairDeviceAction : settingsZh.inviteDevice : settingsZh.joinAccount}
      </Button>
      {closed && !compact && <p className="lorca-runtime-muted" role="status">{settingsZh.pairingClosed}</p>}
      {failed && <p className="lorca-field-error" role="alert">{settingsZh.pairingOpenError}</p>}
    </div>
  );
}

export function DevicesPanel({ runtime, disabled = false, demo = false, onOpenPairing, selectedDeviceId, onSelectDevice }: {
  runtime?: RuntimeSettings;
  selectedDeviceId?: string;
  onSelectDevice?: (id: string) => void;
  disabled?: boolean;
  demo?: boolean;
  onOpenPairing?: LorcaShellActions["onOpenPairing"];
}) {
  const mode: PairingMode = runtime?.hasIdentity ? "invite" : "join";
  const available = Boolean(runtime?.pairingCapabilities?.[mode] && onOpenPairing);
  return (
    <>
      <SettingsSection title={settingsZh.pairing} description={runtime ? runtime.hasIdentity ? settingsZh.inviteDeviceDescription : settingsZh.joinAccountDescription : settingsZh.waitingConfiguration}>
        <SettingsRowList>
          <SettingsDetailRow label={settingsZh.identity}>
            {runtime ? runtime.hasIdentity ? settingsZh.identityAvailable : settingsZh.notSetUp : settingsZh.notReported}
          </SettingsDetailRow>
          <SettingsDetailRow label={settingsZh.relay}>
            {runtime ? runtime.relayConnected ? settingsZh.relayConnected : settingsZh.relayOffline : settingsZh.notReported}
          </SettingsDetailRow>
        </SettingsRowList>
        <p className="lorca-connection-explanation">{settingsZh.pairingScope}</p>
        {(demo || !available) && <p className="lorca-connection-explanation">{demo ? settingsZh.pairingPreview : settingsZh.pairingUnavailable}</p>}
        <PairingAction key={mode} mode={mode} onOpenPairing={onOpenPairing} disabled={disabled || demo || !available} />
      </SettingsSection>
      {runtime ? <DevicesInventory runtime={runtime} selectedDeviceId={selectedDeviceId} onSelectDevice={onSelectDevice} /> : <SettingsSection title={settingsZh.pairedDevices}><InventoryEmpty icon="ComputerTerminal01" title={settingsZh.noDevices} detail={settingsZh.waitingConfiguration} /></SettingsSection>}
      <div className="lorca-settings-boundary-note"><Icon name="Info" /><p>{settingsZh.pairingBoundary}</p></div>
    </>
  );
}
