import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Pill } from "@bb/shared-ui/pill";
import {
  SettingsBadge,
  SettingsDetailRow,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "../../../../app/src/components/ui/settings-section";
import type { RuntimeSettings } from "../types";

function stateLabel(value: string): string {
  const label = value.replaceAll("_", " ").trim();
  return label ? label[0].toUpperCase() + label.slice(1) : "Not reported";
}

function ToolsCount({ count }: { count: number | null }) {
  return (
    <span className="lorca-runtime-tool-count">
      {count === null
        ? "Tool count not reported"
        : `${count} ${count === 1 ? "tool" : "tools"}`}
    </span>
  );
}

export function RunnersPanel({ runtime }: { runtime: RuntimeSettings }) {
  const runners = runtime.devices.filter((device) =>
    ["macos", "linux", "windows"].includes(device.os),
  );
  const otherDevices = runtime.devices.length - runners.length;
  return (
    <>
      <SettingsSection
        title="Runners"
        description="Device and plugin status reported by Lorca. This page does not test connectivity."
        action={<SettingsBadge>Read only</SettingsBadge>}
      >
        {runners.length ? (
          <SettingsRowList>
            {runners.map((device) => {
              const bots = runtime.bots.filter(
                (bot) => bot.runnerId === device.id,
              );
              return (
                <SettingsRow
                  key={device.id}
                  className="lorca-runtime-device-row"
                >
                  <div className="lorca-runtime-device">
                    <div className="lorca-runtime-device-heading">
                      <span className="lorca-runtime-device-icon">
                        <Icon name="ComputerTerminal01" />
                      </span>
                      <div>
                        <h3>{device.name || "Unnamed runner"}</h3>
                        <p>
                          {device.os || "Platform not reported"}
                          {device.version ? ` · Lorca ${device.version}` : ""}
                        </p>
                      </div>
                      {device.isThisDevice && (
                        <SettingsBadge>This device</SettingsBadge>
                      )}
                      <span className="lorca-runtime-reported-status">
                        <span
                          className={`lorca-status-dot ${device.online ? "lorca-status-connected" : "lorca-status-disconnected"}`}
                        />
                        {device.online ? "Online" : "Offline"}
                      </span>
                    </div>
                    <details className="lorca-runtime-disclosure">
                      <summary>
                        <Icon name="ChevronRight" />
                        <span>
                          {device.plugins.length}{" "}
                          {device.plugins.length === 1 ? "plugin" : "plugins"} ·{" "}
                          {bots.length} {bots.length === 1 ? "bot" : "bots"}
                        </span>
                      </summary>
                      <div className="lorca-runtime-disclosure-body">
                        <div className="lorca-runtime-id">
                          <span>Runner ID</span>
                          <code>{device.id}</code>
                        </div>
                        {device.plugins.length ? (
                          <div className="lorca-runtime-plugin-list">
                            {device.plugins.map((plugin) => (
                              <div key={plugin.id}>
                                <span>{plugin.name || plugin.id}</span>
                                <Pill variant="outline">
                                  {stateLabel(plugin.state)}
                                </Pill>
                                <ToolsCount count={plugin.toolCount} />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="lorca-runtime-muted">
                            No plugins reported by this runner.
                          </p>
                        )}
                        <p className="lorca-runtime-muted">
                          {bots.length
                            ? `Used by ${bots.map((bot) => bot.name).join(", ")}.`
                            : "No bots in this snapshot use this runner."}
                        </p>
                      </div>
                    </details>
                  </div>
                </SettingsRow>
              );
            })}
          </SettingsRowList>
        ) : (
          <InventoryEmpty
            icon="ComputerTerminal01"
            title="No runners reported"
            detail="The current Lorca snapshot contains no runner devices."
          />
        )}
      </SettingsSection>
      {otherDevices > 0 && (
        <p className="lorca-runtime-muted">
          {otherDevices} other paired{" "}
          {otherDevices === 1 ? "device is" : "devices are"} not a runner.
        </p>
      )}
      <SettingsSection
        title="Providers"
        description="Configuration reported by Lorca. No provider request or credential check is performed here."
        action={<SettingsBadge>Read only</SettingsBadge>}
      >
        {runtime.providers.length ? (
          <SettingsRowList>
            {runtime.providers.map((provider) => (
              <SettingsDetailRow
                key={provider.id}
                label={provider.name || provider.id}
              >
                <span className="lorca-provider-status">
                  <Icon name={provider.connected ? "CircleCheck" : "Circle"} />
                  {provider.connected ? "Configured" : "Not configured"}
                </span>
              </SettingsDetailRow>
            ))}
          </SettingsRowList>
        ) : (
          <InventoryEmpty
            icon="Bot"
            title="No providers reported"
            detail="Provider configuration is managed in Lorca."
          />
        )}
      </SettingsSection>
      <SettingsSection
        title="Bot configuration"
        description="Current runner, provider, and model assignments. Change assignments in Lorca."
        action={<SettingsBadge>Read only</SettingsBadge>}
      >
        {runtime.bots.length ? (
          <SettingsRowList>
            {runtime.bots.map((bot) => (
              <SettingsRow key={bot.id}>
                <div className="lorca-runtime-bot">
                  <h3>{bot.name || "Unnamed bot"}</h3>
                  <div>
                    <span>
                      <Icon name="ComputerTerminal01" />
                      {runtime.devices.find(
                        (device) => device.id === bot.runnerId,
                      )?.name ||
                        bot.runnerId ||
                        "Runner not reported"}
                    </span>
                    <span>
                      {runtime.providers.find(
                        (provider) => provider.id === bot.provider,
                      )?.name ||
                        bot.provider ||
                        "Provider not reported"}
                    </span>
                    <span>{bot.model || "Model not reported"}</span>
                  </div>
                </div>
              </SettingsRow>
            ))}
          </SettingsRowList>
        ) : (
          <InventoryEmpty
            icon="Bot"
            title="No bots reported"
            detail="Create and configure your bots in Lorca."
          />
        )}
      </SettingsSection>
    </>
  );
}

export function McpPanel({
  runtime,
  loading,
  onRefresh,
}: {
  runtime: RuntimeSettings;
  loading: boolean;
  onRefresh: (runnerId?: string) => void;
}) {
  const [selectedRunner, setSelectedRunner] = useState<string | null>(null);
  const runners = runtime.devices.filter((device) =>
    ["macos", "linux", "windows"].includes(device.os),
  );
  const selected = runners.find((device) => device.id === selectedRunner);
  const reported = runners.find((device) => device.id === runtime.mcp.runnerId);
  const fallback = runners.find((device) => device.isThisDevice) ?? runners[0];
  const inspectedRunner = selected?.id ?? reported?.id ?? fallback?.id ?? "";
  const selectedSnapshot = inspectedRunner === (runtime.mcp.runnerId ?? "");
  return (
    <>
      <SettingsSection
        title="Inspect runner"
        description="Choose which runner’s MCP configuration to view. This does not change any bot or chat assignment."
      >
        <label
          className="lorca-settings-select-label"
          htmlFor="lorca-inspect-runner"
        >
          Runner
        </label>
        <div className="lorca-settings-select">
          <select
            id="lorca-inspect-runner"
            value={inspectedRunner}
            disabled={loading || !runners.length}
            onChange={(event) => {
              setSelectedRunner(event.target.value);
              onRefresh(event.target.value);
            }}
          >
            <option value="" disabled>
              Select a runner
            </option>
            {runners.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name || device.id}
                {device.isThisDevice ? " · this device" : ""}
              </option>
            ))}
          </select>
          <Icon name="ChevronDown" />
        </div>
      </SettingsSection>
      <SettingsSection
        title="MCP servers"
        description="Daemon-reported configuration and tool availability. These statuses are not connection-test results."
        action={<SettingsBadge>Read only</SettingsBadge>}
      >
        {!selectedSnapshot ? (
          <InventoryEmpty
            icon={loading ? "Loading" : "Info"}
            title={
              loading
                ? "Loading this runner…"
                : "This runner’s inventory is unavailable"
            }
            detail={
              loading
                ? "Waiting for the local Lorca runtime."
                : "Refresh to request this runner’s latest reported configuration."
            }
          />
        ) : runtime.mcp.status === "unavailable" ? (
          <InventoryEmpty
            icon="Unavailable"
            title="MCP inventory unavailable"
            detail="This runner did not provide an MCP inventory. Check its configuration in Lorca."
          />
        ) : (
          <>
            {runtime.mcp.hasConfigError && (
              <div className="lorca-settings-warning" role="status">
                <Icon name="AlertCircle" />
                <span>
                  Lorca reports an MCP configuration error. Review the
                  configuration in Lorca.
                </span>
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
                          <h3>{server.name || "Unnamed server"}</h3>
                          <p>
                            {server.transport === "stdio"
                              ? "Local process · stdio"
                              : server.transport === "http"
                                ? "HTTP transport"
                                : "Transport not reported"}
                          </p>
                        </div>
                        <Pill variant="outline">
                          {!server.enabled
                            ? "Disabled"
                            : server.hasError
                              ? "Error reported"
                              : stateLabel(server.state)}
                        </Pill>
                      </div>
                      <div className="lorca-mcp-server-facts">
                        <ToolsCount count={server.toolCount} />
                        {server.hiddenToolCount !== null && (
                          <span>{server.hiddenToolCount} hidden</span>
                        )}
                        <span>
                          {server.enabled
                            ? "Enabled in configuration"
                            : "Disabled in configuration"}
                        </span>
                      </div>
                      {server.hasError && (
                        <p className="lorca-runtime-error">
                          The runner reports an error for this server. Open
                          Lorca for details.
                        </p>
                      )}
                    </div>
                  </SettingsRow>
                ))}
              </SettingsRowList>
            ) : (
              <InventoryEmpty
                icon="Toolbox"
                title="No MCP servers reported"
                detail="MCP servers can be configured in Lorca. This interface only displays the reported inventory."
              />
            )}
          </>
        )}
      </SettingsSection>
      <div className="lorca-settings-boundary-note">
        <Icon name="Info" />
        <p>
          Server configuration, credentials, access grants, and automatic
          approval rules are managed in Lorca. Nothing on this page changes
          them.
        </p>
      </div>
      {!selectedSnapshot && !loading && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRefresh(inspectedRunner || undefined)}
        >
          Refresh selected runner
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
