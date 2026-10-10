import { settingsZh } from "../../locale/settings.zh-CN";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Pill } from "@bb/shared-ui/pill";
import {
  SettingsBadge,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "../../../../app/src/components/ui/settings-section";
import type { RuntimeSettings, SettingsAction, SettingsActionResult } from "../types";
import { editorZh } from "../../locale/editor.zh-CN";
import { SettingsActionControl } from "./SettingsActionControl";

const runtimeStateLabels = new Map(Object.entries(settingsZh.runtimeStates));

function stateLabel(value: string): string {
  return (
    runtimeStateLabels.get(value) ??
    (value.trim() ? value : settingsZh.notReported)
  );
}

function ToolsCount({ count }: { count: number | null }) {
  return (
    <span className="lorca-runtime-tool-count">
      {count === null
        ? settingsZh.toolCountNotReported
        : settingsZh.toolCount(count)}
    </span>
  );
}

export function DevicesInventory({ runtime, selectedDeviceId, onSelectDevice }: { runtime: RuntimeSettings; selectedDeviceId?: string; onSelectDevice?: (id: string) => void }) {
  return (
    <SettingsSection title={settingsZh.pairedDevices} description={settingsZh.pairedDevicesDescription} action={<SettingsBadge>{settingsZh.readOnly}</SettingsBadge>}>
      {runtime.devices.length ? (
        <SettingsRowList>
          {runtime.devices.map((device) => {
            const runner = device.role === "runner";
            const bots = runtime.bots.filter((bot) => bot.runnerId === device.id);
            return (
              <SettingsRow key={device.id} className="lorca-runtime-device-row" data-selected={selectedDeviceId === device.id || undefined}>
                <div className="lorca-runtime-device">
                  <div className="lorca-runtime-device-heading">
                    <span className="lorca-runtime-device-icon"><Icon name={device.role === "device" ? "Smartphone" : "ComputerTerminal01"} /></span>
                    <div>
                      <h3>{onSelectDevice ? <button className="lorca-device-name" type="button" onClick={() => onSelectDevice(device.id)} aria-pressed={selectedDeviceId === device.id}>{device.name || settingsZh.unnamedDevice}</button> : device.name || settingsZh.unnamedDevice}</h3>
                      <p>{device.os || settingsZh.platformNotReported}{device.version ? ` · ${device.version}` : ""}</p>
                    </div>
                    {device.isThisDevice && <SettingsBadge>{settingsZh.thisDevice}</SettingsBadge>}
                    <span className="lorca-runtime-reported-status">
                      <span className={`lorca-status-dot ${device.online ? "lorca-status-connected" : "lorca-status-disconnected"}`} />
                      {device.online ? settingsZh.online : settingsZh.offline}
                    </span>
                  </div>
                  <p className="lorca-device-role">{runner ? settingsZh.runnerRole : device.role === "device" ? settingsZh.deviceRole : settingsZh.unknownDeviceRole}</p>
                  {runner && (selectedDeviceId === undefined || selectedDeviceId === device.id) && <details key={device.id} className="lorca-runtime-disclosure" open={selectedDeviceId === device.id}>
                    <summary><Icon name="ChevronRight" /><span>{settingsZh.pluginAndBotCount(device.plugins.length, bots.length)}</span></summary>
                    <div className="lorca-runtime-disclosure-body">
                      {device.plugins.length ? <div className="lorca-runtime-plugin-list">
                        {device.plugins.map((plugin) => <div key={plugin.id}><span>{plugin.name || plugin.id}</span><Pill variant="outline">{stateLabel(plugin.state)}</Pill><ToolsCount count={plugin.toolCount} /></div>)}
                      </div> : <p className="lorca-runtime-muted">{settingsZh.noRunnerPlugins}</p>}
                      {bots.length ? <div className="lorca-runtime-plugin-list">
                        {bots.map((bot) => <div key={bot.id}><span>{bot.name || settingsZh.unnamedBot}</span><span className="lorca-runtime-muted">{runtime.providers.find((provider) => provider.id === bot.provider)?.name || bot.provider || settingsZh.providerNotReported} · {bot.model || settingsZh.modelNotReported}</span></div>)}
                      </div> : <p className="lorca-runtime-muted">{settingsZh.noRunnerBots}</p>}
                    </div>
                  </details>}
                </div>
              </SettingsRow>
            );
          })}
        </SettingsRowList>
      ) : <InventoryEmpty icon="ComputerTerminal01" title={settingsZh.noDevices} detail={settingsZh.noDevicesDescription} />}
    </SettingsSection>
  );
}

export function McpPanel({
  runtime,
  loading,
  onRefresh,
  onAction,
  disabled = false,
  deviceId,
}: {
  runtime: RuntimeSettings;
  loading: boolean;
  onRefresh: (runnerId?: string) => void;
  onAction?: (action: SettingsAction) => Promise<SettingsActionResult>;
  disabled?: boolean;
  deviceId?: string;
}) {
  const runners = runtime.devices.filter((device) => device.role === "runner");
  const fallback = runners.find((device) => device.id === runtime.mcp.runnerId) ?? runners.find((device) => device.isThisDevice) ?? runners[0];
  const inspectedDevice = deviceId === undefined ? fallback : runtime.devices.find((device) => device.id === deviceId);
  const inspectedRunner = inspectedDevice?.role === "runner" ? inspectedDevice.id : "";
  const selectedSnapshot = inspectedRunner === (runtime.mcp.runnerId ?? "");
  const editor = runtime.editor;
  const canManage = Boolean(editor?.canManageMcp && onAction && selectedSnapshot && runtime.mcp.status === "ready" && runners.find((device) => device.id === inspectedRunner)?.online);
  const runnerName = runners.find((device) => device.id === inspectedRunner)?.name || inspectedRunner;
  const managementBlocked = disabled || loading || !selectedSnapshot;
  if (!inspectedRunner) return <InventoryEmpty icon="Info" title={inspectedDevice?.role === "device" ? settingsZh.requiresRunner : settingsZh.unknownRunnerRole} detail={settingsZh.chooseRunnerForSettings} />;
  return (
    <>
      <SettingsSection title={settingsZh.runnerPlugins} description={settingsZh.runnerPluginScope(runnerName)} action={<SettingsBadge>{settingsZh.readOnly}</SettingsBadge>}>
        {inspectedDevice?.plugins.length ? <SettingsRowList>{inspectedDevice.plugins.map((plugin) => <SettingsRow key={plugin.id}><div className="lorca-plugin-inventory-row"><span>{plugin.name || plugin.id}</span><Pill variant="outline">{stateLabel(plugin.state)}</Pill><ToolsCount count={plugin.toolCount} /></div></SettingsRow>)}</SettingsRowList> : <p className="lorca-runtime-muted">{settingsZh.noRunnerPlugins}</p>}
      </SettingsSection>
      {canManage && editor && onAction && <div className="lorca-admin-buttons">
        <SettingsActionControl action={{ kind: "mcp.configure", revision: editor.revision, runnerId: inspectedRunner }} label={editorZh.addMcp} onAction={onAction} disabled={managementBlocked} />
        <SettingsActionControl action={{ kind: "mcp.reload", revision: editor.revision, runnerId: inspectedRunner }} label={editorZh.reloadMcp} confirmation={editorZh.reloadMcpScope(runnerName)} onAction={onAction} disabled={managementBlocked} />
      </div>}
      {!editor?.canManageMcp && <p className="lorca-admin-unavailable">{editorZh.unsupported}</p>}
      <SettingsSection
        title={settingsZh.mcpServers}
        description={settingsZh.mcpServersDescription}
        action={!canManage ? <SettingsBadge>{settingsZh.readOnly}</SettingsBadge> : undefined}
      >
        {!selectedSnapshot ? (
          <InventoryEmpty
            icon={loading ? "Loading" : "Info"}
            title={
              loading
                ? settingsZh.loadingRunner
                : settingsZh.runnerInventoryUnavailable
            }
            detail={
              loading
                ? settingsZh.waitingLocalRuntime
                : settingsZh.refreshRunnerInventory
            }
          />
        ) : runtime.mcp.status === "unavailable" ? (
          <InventoryEmpty
            icon="Unavailable"
            title={settingsZh.mcpInventoryUnavailable}
            detail={settingsZh.mcpInventoryUnavailableDescription}
          />
        ) : (
          <>
            {runtime.mcp.hasConfigError && (
              <div className="lorca-settings-warning" role="status">
                <Icon name="AlertCircle" />
                <span>{settingsZh.mcpConfigurationError}</span>
              </div>
            )}
            {runtime.mcp.servers.length ? (
              <SettingsRowList>
                {runtime.mcp.servers.map((server, index) => (
                  <SettingsRow key={`${server.name}:${index}`}>
                    <div className="lorca-mcp-server">
                      <div className="lorca-mcp-server-heading">
                        <span className="lorca-runtime-device-icon">
                          <Icon name="Toolbox" />
                        </span>
                        <div>
                          <h3>{server.name || settingsZh.unnamedServer}</h3>
                          <p>
                            {server.transport === "stdio"
                              ? settingsZh.localProcessTransport
                              : server.transport === "http"
                                ? settingsZh.httpTransport
                                : settingsZh.transportNotReported}
                          </p>
                        </div>
                        <Pill variant="outline">
                          {!server.enabled
                            ? settingsZh.disabled
                            : server.hasError
                              ? settingsZh.errorReported
                              : stateLabel(server.state)}
                        </Pill>
                      </div>
                      <div className="lorca-mcp-server-facts">
                        <ToolsCount count={server.toolCount} />
                        {server.hiddenToolCount !== null && (
                          <span>
                            {settingsZh.hiddenToolCount(server.hiddenToolCount)}
                          </span>
                        )}
                        <span>
                          {server.enabled
                            ? settingsZh.enabledInConfiguration
                            : settingsZh.disabledInConfiguration}
                        </span>
                      </div>
                      {server.hasError && (
                        <p className="lorca-runtime-error">
                          {settingsZh.serverError}
                        </p>
                      )}
                      {canManage && editor && onAction && <div className="lorca-admin-buttons lorca-mcp-admin-actions">
                        <SettingsActionControl action={{ kind: "mcp.configure", revision: editor.revision, runnerId: inspectedRunner, name: server.name }} label={editorZh.configure} onAction={onAction} disabled={managementBlocked} />
                        <SettingsActionControl action={{ kind: "mcp.setEnabled", revision: editor.revision, runnerId: inspectedRunner, name: server.name, enabled: !server.enabled }} label={server.enabled ? editorZh.disable : editorZh.enable} confirmation={editorZh.mcpScope(runnerName, server.name, server.enabled ? editorZh.disable : editorZh.enable)} onAction={onAction} disabled={managementBlocked} />
                        <SettingsActionControl action={{ kind: "mcp.reconnect", revision: editor.revision, runnerId: inspectedRunner, name: server.name }} label={editorZh.reconnect} confirmation={editorZh.mcpScope(runnerName, server.name, editorZh.reconnect)} onAction={onAction} disabled={managementBlocked || !server.enabled} />
                        <SettingsActionControl action={{ kind: "mcp.remove", revision: editor.revision, runnerId: inspectedRunner, name: server.name }} label={editorZh.remove} confirmation={editorZh.removeMcpScope(runnerName, server.name)} onAction={onAction} disabled={managementBlocked} />
                      </div>}
                    </div>
                  </SettingsRow>
                ))}
              </SettingsRowList>
            ) : (
              <InventoryEmpty
                icon="Toolbox"
                title={settingsZh.noMcpServers}
                detail={settingsZh.noMcpServersDescription}
              />
            )}
          </>
        )}
      </SettingsSection>
      <div className="lorca-settings-boundary-note">
        <Icon name="Info" />
        <p>{editorZh.mcpBoundary}</p>
      </div>
      {!selectedSnapshot && !loading && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRefresh(inspectedRunner || undefined)}
        >
          {settingsZh.refreshSelectedRunner}
        </Button>
      )}
    </>
  );
}

export function InventoryEmpty({
  icon,
  title,
  detail,
}: {
  icon: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="lorca-settings-empty">
      <Icon name={icon} />
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    </div>
  );
}
