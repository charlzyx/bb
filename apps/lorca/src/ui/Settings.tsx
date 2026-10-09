import { useState } from "react";
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
    return "Use ws://127.0.0.1:<port>/ws or ws://localhost:<port>/ws with a port from 1 to 65535.";
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
        error instanceof Error
          ? error.message
          : "The endpoint could not be saved. Check your local Lorca runtime and try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <label htmlFor="lorca-endpoint">Lorca WebSocket endpoint</label>
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
          Used for this desktop session. Credentials stay in the native bridge;
          only a canonical local service address is accepted here.
        </p>
        {error && (
          <p className="lorca-field-error" role="alert">
            {error}
          </p>
        )}
        <div className="lorca-settings-form-actions">
          <Button size="sm" type="submit" disabled={saving || connecting}>
            {saving || connecting ? "Connecting…" : "Connect for this session"}
          </Button>
          {saved && (
            <span role="status">
              <Icon name="Check" /> Connected
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
  error?: string | null;
}) {
  const connected = demo || connection.status === "connected";
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
              ? "Refreshing runtime details…"
              : runtime
                ? "Configuration reported by Lorca"
                : "Runtime details"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading || !connected}
          >
            <Icon name={loading ? "Loading" : "FolderSync"} />
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      )}
      {error && page !== "preferences" && (
        <div className="lorca-settings-warning" role="alert">
          <Icon name="AlertCircle" />
          <div>
            <p>{error}</p>
            {runtime && <p>Showing the last loaded snapshot.</p>}
          </div>
        </div>
      )}
      {page === "connection" && (
        <>
          <SettingsSection
            title="Local runtime"
            description="Connection and identity information reported by your Lorca daemon."
            action={
              <SettingsBadge>
                {demo
                  ? "Synthetic preview"
                  : connection.status === "connected"
                    ? "Connected"
                    : connection.status === "connecting"
                      ? "Connecting"
                      : "Offline"}
              </SettingsBadge>
            }
          >
            <SettingsRowList>
              <SettingsDetailRow label="Runtime version">
                {runtime?.version || "Not reported"}
              </SettingsDetailRow>
              <SettingsDetailRow label="Identity">
                {runtime
                  ? runtime.hasIdentity
                    ? "Available on this device"
                    : "Not set up"
                  : "Not reported"}
              </SettingsDetailRow>
              <SettingsDetailRow label="Relay">
                {runtime
                  ? runtime.relayConnected
                    ? "Connected (reported)"
                    : "Offline (reported)"
                  : "Not reported"}
              </SettingsDetailRow>
              <SettingsDetailRow label="Authentication">
                {runtime
                  ? runtime.authMode === "legacy"
                    ? "Unauthenticated legacy mode"
                    : "Authenticated local bridge"
                  : "Not reported"}
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
                <span>
                  Lorca reports that a CLI update is required before the relay
                  can sync.
                </span>
              </div>
            )}
            {runtime?.authMode === "legacy" && (
              <div className="lorca-settings-warning">
                <Icon name="AlertCircle" />
                <span>
                  This session uses explicit legacy mode without token
                  authentication. Use only a trusted local daemon.
                </span>
              </div>
            )}
          </SettingsSection>
          <SettingsSection
            title="Connection endpoint"
            description="Connect this interface to the local Lorca CLI. The endpoint is session-only."
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
            <p>
              Account sign-in, credentials, and access grants are managed in
              Lorca. Credentials never appear in these settings.
            </p>
          </div>
        </>
      )}
      {page === "preferences" && (
        <>
          <SettingsSection
            title="Appearance"
            description="A local preference for the BB interface. It does not change your Lorca runtime."
          >
            <SettingsWithControl
              label="Color theme"
              description="Choose a light or dark interface."
              controlPlacement="trailing"
            >
              <div
                className="lorca-theme-switch"
                role="group"
                aria-label="Appearance"
              >
                <button
                  type="button"
                  aria-pressed={theme === "light"}
                  onClick={() => onThemeChange("light")}
                >
                  Light
                </button>
                <button
                  type="button"
                  aria-pressed={theme === "dark"}
                  onClick={() => onThemeChange("dark")}
                >
                  Dark
                </button>
              </div>
            </SettingsWithControl>
          </SettingsSection>
          <div className="lorca-settings-boundary-note">
            <Icon name={themePersistent ? "Info" : "AlertCircle"} />
            <p>
              {themePersistent
                ? "For this app session. Appearance is remembered when the view reloads; the desktop app uses an isolated, temporary session. Other runtime preferences and automatic approval rules are managed in Lorca."
                : "Local preference storage is unavailable. Appearance works for this window, but may reset when you reopen it."}
            </p>
          </div>
        </>
      )}
      {(page === "runners" || page === "mcp") &&
        (runtime ? (
          page === "runners" ? (
            <RunnersPanel runtime={runtime} />
          ) : (
            <McpPanel
              runtime={runtime}
              loading={loading}
              onRefresh={actions.onRefreshSettings}
            />
          )
        ) : (
          <SettingsSection
            title={page === "runners" ? "Runner inventory" : "MCP inventory"}
            action={<SettingsBadge>Read only</SettingsBadge>}
          >
            <InventoryEmpty
              icon={loading ? "Loading" : "Info"}
              title={
                loading
                  ? "Loading runtime details…"
                  : connected
                    ? "No runtime details available"
                    : "Connect your local runtime"
              }
              detail={
                loading
                  ? "Waiting for the Lorca daemon’s reported configuration."
                  : connected
                    ? "Refresh to request the current inventory. No status is inferred from missing data."
                    : "Connect to Lorca to inspect runners, providers, and MCP configuration."
              }
            />
            {!connected && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange("connection")}
              >
                Open connection settings
              </Button>
            )}
          </SettingsSection>
        ))}
    </SettingsFrame>
  );
}
