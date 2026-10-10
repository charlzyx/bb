import { useState } from "react";
import { settingsZh } from "../locale/settings.zh-CN";
import { editorZh } from "../locale/editor.zh-CN";
import { BotSettingsPanel } from "./settings/BotSettingsPanel";
import { AutoReviewPanel } from "./settings/AutoReviewPanel";
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
  RunnersPanel,
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
  const connected = demo || connection.status === "connected";
  const disabled = !connected || loading || applying;
  const refresh = () =>
    actions.onRefreshSettings(
      page === "mcp" ? (runtime?.mcp.runnerId ?? undefined) : undefined,
    );
  return (
    <SettingsFrame
      open={open}
      onOpenChange={onOpenChange}
      page={page}
      onPageChange={onPageChange}
      demo={demo}
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
      {page === "models" && (runtime ? <BotSettingsPanel key={String(open)} runtime={runtime} disabled={disabled} onAction={actions.onSettingsAction} selectedBotId={selectedBotId} onSelectBot={setSelectedBotId} /> : <InventoryEmpty icon="Info" title={settingsZh.noRuntimeDetails} detail={editorZh.unsupported} />)}
      {page === "approvals" && <AutoReviewPanel key={`${String(open)}:${runtime?.editor?.revision ?? "unavailable"}`} editor={runtime?.editor} disabled={disabled} onAction={actions.onSettingsAction} />}
      {(page === "runners" || page === "mcp") &&
        (runtime ? (
          page === "runners" ? (
            <RunnersPanel runtime={runtime} />
          ) : (
            <McpPanel
              runtime={runtime}
              loading={loading}
              onRefresh={actions.onRefreshSettings}
              onAction={actions.onSettingsAction}
              disabled={disabled}
            />
          )
        ) : (
          <SettingsSection
            title={
              page === "runners"
                ? settingsZh.runnerInventory
                : settingsZh.mcpInventory
            }
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
