import { useState } from "react";
import { settingsZh } from "../locale/settings.zh-CN";
import { editorZh } from "../locale/editor.zh-CN";
import { BotSettingsPanel, ProvidersPanel } from "./settings/BotSettingsPanel";
import { AutoReviewPanel } from "./settings/AutoReviewPanel";
import { DevicesPanel, PairingAction } from "./settings/DevicesPanel";
import { useAutoReviewDraft } from "./settings/auto-review-draft";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import {
  SettingsBadge,
  SettingsDetailRow,
  SettingsRowList,
  SettingsSection,
  SettingsWithControl,
} from "../../../app/src/components/ui/settings-section";
import { SettingsFrame, type SettingsPage } from "./settings/SettingsFrame";
import {
  InventoryEmpty,
  McpPanel,
} from "./settings/RuntimePanels";
import type {
  LorcaConnection,
  LorcaShellActions,
  RuntimeSettings,
} from "./types";

export function validateEndpoint(value: string): string | null {
  const match = /^ws:\/\/(127\.0\.0\.1|localhost):([0-9]{1,5})\/ws$/.exec(
    value,
  );
  if (
    !match ||
    value.length > 160 ||
    Number(match[2]) < 1 ||
    Number(match[2]) > 65535
  ) {
    return settingsZh.invalidEndpoint;
  }
  return null;
}

function EndpointForm({
  initialEndpoint,
  onSaveEndpoint,
  connecting,
}: {
  initialEndpoint: string;
  connecting: boolean;
  onSaveEndpoint: LorcaShellActions["onSaveEndpoint"];
}) {
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function saveEndpoint() {
    if (saving || connecting) return;
    const value = endpoint.trim();
    const problem = validateEndpoint(value);
    setError(problem);
    setSaved(false);
    if (problem) return;
    setSaving(true);
    try {
      await onSaveEndpoint(value);
      setSaved(true);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : settingsZh.endpointSaveError,
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <label htmlFor="lorca-endpoint">{settingsZh.endpointLabel}</label>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void saveEndpoint();
        }}
      >
        <Input
          id="lorca-endpoint"
          value={endpoint}
          placeholder="ws://127.0.0.1:PORT/ws"
          spellCheck={false}
          disabled={saving || connecting}
          aria-invalid={Boolean(error)}
          aria-describedby="lorca-endpoint-help"
          onChange={(event) => {
            setEndpoint(event.target.value);
            setSaved(false);
            setError(null);
          }}
        />
        <p className="lorca-input-help" id="lorca-endpoint-help">
          {settingsZh.endpointHelp}
        </p>
        {error && (
          <p className="lorca-field-error" role="alert">
            {error}
          </p>
        )}
        <div className="lorca-settings-form-actions">
          <Button size="sm" type="submit" disabled={saving || connecting}>
            {saving || connecting
              ? settingsZh.connectingProgress
              : settingsZh.connectForSession}
          </Button>
          {saved && (
            <span role="status">
              <Icon name="Check" /> {settingsZh.connected}
            </span>
          )}
        </div>
      </form>
    </>
  );
}

export function Settings({
  onCreateAgent,
  requestedDevice,
  open,
  onOpenChange,
  page,
  onPageChange,
  connection,
  demo,
  actions,
  theme,
  onThemeChange,
  themePersistent,
  runtime,
  loading = false,
  applying = false,
  error,
}: {
  onCreateAgent?: () => void;
  requestedDevice?: { id: string; sequence: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: SettingsPage;
  onPageChange: (page: SettingsPage) => void;
  connection: LorcaConnection;
  demo: boolean;
  actions: LorcaShellActions;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
  themePersistent: boolean;
  runtime?: RuntimeSettings;
  loading?: boolean;
  applying?: boolean;
  error?: string | null;
}) {
  const [selectedBotId, setSelectedBotId] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(requestedDevice?.id ?? null);
  const [appliedDeviceRequest, setAppliedDeviceRequest] = useState(requestedDevice);
  if (requestedDevice !== appliedDeviceRequest) { setAppliedDeviceRequest(requestedDevice); if (requestedDevice) setSelectedDeviceId(requestedDevice.id); }
  const selectedDevice = selectedDeviceId === null
    ? runtime?.devices.find(device => device.isThisDevice) ?? runtime?.devices[0]
    : runtime?.devices.find(device => device.id === selectedDeviceId);
  const connected = demo || connection.status === "connected";
  const disabled = !connected || loading || applying;
  const autoReviewDraft = useAutoReviewDraft({ editor: runtime?.editor, disabled, onAction: actions.onSettingsAction });
  const refreshDevice = (device: RuntimeSettings["devices"][number] | undefined, nextPage: SettingsPage) => {
    if (nextPage === "mcp" && device?.role === "runner") actions.onRefreshSettings(device.id);
    else actions.onRefreshSettings(undefined, { includeMcp: false });
  };
  const refresh = () => refreshDevice(selectedDevice, page);
  const changePage = (nextPage: SettingsPage) => {
    onPageChange(nextPage);
    if (nextPage === "mcp" && connected) refreshDevice(selectedDevice, nextPage);
  };
  const changeDevice = (id: string) => {
    setSelectedDeviceId(id);
    if (page === "mcp" && connected) refreshDevice(runtime?.devices.find((device) => device.id === id), page);
  };
  const pairingMode = runtime?.hasIdentity ? "invite" : "join";
  const deviceControl = (
    <div className="lorca-settings-device-control">
      <div className="lorca-settings-select">
        <select aria-label={settingsZh.viewDevice} title={settingsZh.viewDeviceHelp} value={selectedDeviceId ?? selectedDevice?.id ?? ""} disabled={!runtime?.devices.length || loading} onChange={(event) => changeDevice(event.target.value)}>
          {selectedDeviceId !== null && !selectedDevice && <option value={selectedDeviceId} disabled>{loading ? "正在读取指定设备…" : "指定设备不可用"}</option>}
          {!runtime?.devices.length && selectedDeviceId === null && <option value="">{settingsZh.selectDevice}</option>}
          {runtime?.devices.map((device) => <option key={device.id} value={device.id}>{device.name || settingsZh.unnamedDevice}{device.isThisDevice ? ` · ${settingsZh.thisDevice}` : ""}</option>)}
        </select>
        <Icon name="ChevronDown" />
      </div>
      <PairingAction key={pairingMode} mode={pairingMode} compact onOpenPairing={actions.onOpenPairing} disabled={disabled || demo || !runtime?.pairingCapabilities?.[pairingMode]} />
    </div>
  );
  return (
    <SettingsFrame
      open={open}
      onOpenChange={onOpenChange}
      page={page}
      onPageChange={changePage}
      demo={demo}
      deviceControl={deviceControl}
    >
      {page !== "preferences" && (
        <div className="lorca-settings-runtime-toolbar" aria-busy={loading}>
          <span>
            {loading
              ? settingsZh.refreshingDetails
              : runtime
                ? settingsZh.reportedConfiguration
                : settingsZh.runtimeDetails}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading || !connected}
          >
            <Icon name={loading ? "Loading" : "FolderSync"} />
            {loading ? settingsZh.refreshing : settingsZh.refresh}
          </Button>
        </div>
      )}
      {error && page !== "preferences" && (
        <div className="lorca-settings-warning" role="alert">
          <Icon name="AlertCircle" />
          <div>
            <p>{error}</p>
            {runtime && <p>{settingsZh.lastSnapshot}</p>}
          </div>
        </div>
      )}
      {(page === "providers" || page === "approvals") && <p className="lorca-runtime-muted">{settingsZh.accountSettingsScope}</p>}
      {page === "connection" && (
        <>
          <SettingsSection
            title={settingsZh.localRuntime}
            description={settingsZh.localRuntimeDescription}
            action={
              <SettingsBadge>
                {demo
                  ? settingsZh.syntheticPreview
                  : connection.status === "connected"
                    ? settingsZh.connected
                    : connection.status === "connecting"
                      ? settingsZh.connecting
                      : settingsZh.offline}
              </SettingsBadge>
            }
          >
            <SettingsRowList>
              <SettingsDetailRow label={settingsZh.runtimeVersion}>
                {runtime?.version || settingsZh.notReported}
              </SettingsDetailRow>
              <SettingsDetailRow label={settingsZh.identity}>
                {runtime
                  ? runtime.hasIdentity
                    ? settingsZh.identityAvailable
                    : settingsZh.notSetUp
                  : settingsZh.notReported}
              </SettingsDetailRow>
              <SettingsDetailRow label={settingsZh.relay}>
                {runtime
                  ? runtime.relayConnected
                    ? settingsZh.relayConnected
                    : settingsZh.relayOffline
                  : settingsZh.notReported}
              </SettingsDetailRow>
              <SettingsDetailRow label={settingsZh.authentication}>
                {runtime
                  ? runtime.authMode === "legacy"
                    ? settingsZh.legacyAuthentication
                    : settingsZh.localBridgeAuthentication
                  : settingsZh.notReported}
              </SettingsDetailRow>
            </SettingsRowList>
            {connection.detail && (
              <p className="lorca-connection-explanation">
                {connection.detail}
              </p>
            )}
            {runtime?.updateRequired && (
              <div className="lorca-settings-warning">
                <Icon name="AlertCircle" />
                <span>{settingsZh.updateRequired}</span>
              </div>
            )}
            {runtime?.authMode === "legacy" && (
              <div className="lorca-settings-warning">
                <Icon name="AlertCircle" />
                <span>{settingsZh.legacyWarning}</span>
              </div>
            )}
          </SettingsSection>
          <SettingsSection
            title={settingsZh.connectionEndpoint}
            description={settingsZh.connectionEndpointDescription}
          >
            <EndpointForm
              key={`${connection.endpoint}:${open}`}
              initialEndpoint={connection.endpoint}
              connecting={connection.status === "connecting"}
              onSaveEndpoint={actions.onSaveEndpoint}
            />
          </SettingsSection>
          <div className="lorca-settings-boundary-note">
            <Icon name="Info" />
            <p>{settingsZh.credentialsBoundary}</p>
          </div>
        </>
      )}
      {page === "preferences" && (
        <>
          <SettingsSection
            title={settingsZh.appearance}
            description={settingsZh.appearanceDescription}
          >
            <SettingsWithControl
              label={settingsZh.colorTheme}
              description={settingsZh.colorThemeDescription}
              controlPlacement="trailing"
            >
              <div
                className="lorca-theme-switch"
                role="group"
                aria-label={settingsZh.appearance}
              >
                <button
                  type="button"
                  aria-pressed={theme === "light"}
                  onClick={() => onThemeChange("light")}
                >
                  {settingsZh.light}
                </button>
                <button
                  type="button"
                  aria-pressed={theme === "dark"}
                  onClick={() => onThemeChange("dark")}
                >
                  {settingsZh.dark}
                </button>
              </div>
            </SettingsWithControl>
          </SettingsSection>
          <div className="lorca-settings-boundary-note">
            <Icon name={themePersistent ? "Info" : "AlertCircle"} />
            <p>
              {themePersistent
                ? settingsZh.appearanceSessionHelp
                : settingsZh.appearanceStorageUnavailable}
            </p>
          </div>
        </>
      )}
      {page === "devices" && (
        <DevicesPanel
          runtime={runtime}
          connected={connected}
          disabled={disabled}
          demo={demo}
          onOpenPairing={actions.onOpenPairing}
          selectedDeviceId={selectedDevice?.id}
          onSelectDevice={changeDevice}
        />
      )}
      {page === "providers" && (runtime ? <ProvidersPanel runtime={runtime} disabled={disabled} onAction={actions.onSettingsAction} /> : <InventoryEmpty icon="Info" title={settingsZh.noRuntimeDetails} detail={editorZh.unsupported} />)}
      {page === "models" && onCreateAgent && <Button type="button" disabled={disabled} onClick={onCreateAgent}>新建智能体</Button>}
      {page === "models" && (runtime && selectedDevice?.role === "runner" ? <BotSettingsPanel key={`${open}:${selectedDevice.id}`} runtime={runtime} disabled={disabled} onAction={actions.onSettingsAction} selectedBotId={selectedBotId} onSelectBot={setSelectedBotId} deviceId={selectedDevice.id} /> : <InventoryEmpty icon="Info" title={selectedDevice?.role === "device" ? settingsZh.requiresRunner : settingsZh.unknownRunnerRole} detail={settingsZh.chooseRunnerForSettings} />)}
      <div hidden={page !== "approvals"}>
        <AutoReviewPanel draft={autoReviewDraft} />
      </div>
      {page === "mcp" &&
        (runtime ? (
            <McpPanel
              runtime={runtime}
              loading={loading}
              onRefresh={actions.onRefreshSettings}
              onAction={actions.onSettingsAction}
              disabled={disabled}
              deviceId={selectedDevice?.id ?? ""}
            />
        ) : (
          <SettingsSection
            title={settingsZh.mcpInventory}
            action={<SettingsBadge>{settingsZh.readOnly}</SettingsBadge>}
          >
            <InventoryEmpty
              icon={loading ? "Loading" : "Info"}
              title={
                loading
                  ? settingsZh.loadingDetails
                  : connected
                    ? settingsZh.noRuntimeDetails
                    : settingsZh.connectLocalRuntime
              }
              detail={
                loading
                  ? settingsZh.waitingConfiguration
                  : connected
                    ? settingsZh.refreshInventory
                    : settingsZh.connectForInventory
              }
            />
            {!connected && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange("connection")}
              >
                {settingsZh.openConnectionSettings}
              </Button>
            )}
          </SettingsSection>
        ))}
    </SettingsFrame>
  );
}
