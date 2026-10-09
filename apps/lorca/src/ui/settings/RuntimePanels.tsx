import { useState } from "react";
import { settingsZh } from "../../locale/settings.zh-CN";
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

export function RunnersPanel({ runtime }: { runtime: RuntimeSettings }) {
  const runners = runtime.devices.filter((device) =>
    ["macos", "linux", "windows"].includes(device.os),
  );
  const otherDevices = runtime.devices.length - runners.length;
  return (
    <>
      <SettingsSection
        title={settingsZh.runners}
        description={settingsZh.runnerStatusDescription}
        action={<SettingsBadge>{settingsZh.readOnly}</SettingsBadge>}
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
                        <h3>{device.name || settingsZh.unnamedRunner}</h3>
                        <p>
                          {device.os || settingsZh.platformNotReported}
                          {device.version ? ` · ${device.version}` : ""}
                        </p>
                      </div>
                      {device.isThisDevice && (
                        <SettingsBadge>{settingsZh.thisDevice}</SettingsBadge>
                      )}
                      <span className="lorca-runtime-reported-status">
                        <span
                          className={`lorca-status-dot ${device.online ? "lorca-status-connected" : "lorca-status-disconnected"}`}
                        />
                        {device.online ? settingsZh.online : settingsZh.offline}
                      </span>
                    </div>
                    <details className="lorca-runtime-disclosure">
                      <summary>
                        <Icon name="ChevronRight" />
                        <span>
                          {settingsZh.pluginAndBotCount(
                            device.plugins.length,
                            bots.length,
                          )}
                        </span>
                      </summary>
                      <div className="lorca-runtime-disclosure-body">
                        <div className="lorca-runtime-id">
                          <span>{settingsZh.runnerId}</span>
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
                            {settingsZh.noRunnerPlugins}
                          </p>
                        )}
                        <p className="lorca-runtime-muted">
                          {bots.length
                            ? settingsZh.usedByBots(bots.map((bot) => bot.name))
                            : settingsZh.noRunnerBots}
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
            title={settingsZh.noRunners}
            detail={settingsZh.noRunnersDescription}
          />
        )}
      </SettingsSection>
      {otherDevices > 0 && (
        <p className="lorca-runtime-muted">
          {settingsZh.otherPairedDevices(otherDevices)}
        </p>
      )}
      <SettingsSection
        title={settingsZh.providers}
        description={settingsZh.providersDescription}
        action={<SettingsBadge>{settingsZh.readOnly}</SettingsBadge>}
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
                  {provider.connected
                    ? settingsZh.configured
                    : settingsZh.notConfigured}
                </span>
              </SettingsDetailRow>
            ))}
          </SettingsRowList>
        ) : (
          <InventoryEmpty
            icon="Bot"
            title={settingsZh.noProviders}
            detail={settingsZh.noProvidersDescription}
          />
        )}
      </SettingsSection>
      <SettingsSection
        title={settingsZh.botConfiguration}
        description={settingsZh.botConfigurationDescription}
        action={<SettingsBadge>{settingsZh.readOnly}</SettingsBadge>}
      >
        {runtime.bots.length ? (
          <SettingsRowList>
            {runtime.bots.map((bot) => (
              <SettingsRow key={bot.id}>
                <div className="lorca-runtime-bot">
                  <h3>{bot.name || settingsZh.unnamedBot}</h3>
                  <div>
                    <span>
                      <Icon name="ComputerTerminal01" />
                      {runtime.devices.find(
                        (device) => device.id === bot.runnerId,
                      )?.name ||
                        bot.runnerId ||
                        settingsZh.runnerNotReported}
                    </span>
                    <span>
                      {runtime.providers.find(
                        (provider) => provider.id === bot.provider,
                      )?.name ||
                        bot.provider ||
                        settingsZh.providerNotReported}
                    </span>
                    <span>{bot.model || settingsZh.modelNotReported}</span>
                  </div>
                </div>
              </SettingsRow>
            ))}
          </SettingsRowList>
        ) : (
          <InventoryEmpty
            icon="Bot"
            title={settingsZh.noBots}
            detail={settingsZh.noBotsDescription}
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
        title={settingsZh.inspectRunner}
        description={settingsZh.inspectRunnerDescription}
      >
        <label
          className="lorca-settings-select-label"
          htmlFor="lorca-inspect-runner"
        >
          {settingsZh.runner}
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
              {settingsZh.selectRunner}
            </option>
            {runners.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name || device.id}
                {device.isThisDevice ? ` · ${settingsZh.thisDevice}` : ""}
              </option>
            ))}
          </select>
          <Icon name="ChevronDown" />
        </div>
      </SettingsSection>
      <SettingsSection
        title={settingsZh.mcpServers}
        description={settingsZh.mcpServersDescription}
        action={<SettingsBadge>{settingsZh.readOnly}</SettingsBadge>}
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
        <p>{settingsZh.mcpBoundary}</p>
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
