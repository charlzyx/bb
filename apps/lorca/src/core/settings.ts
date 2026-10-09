import type { RuntimeSettings } from "../ui/types";
import { object } from "./protocol";

const text = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length > 500)
    throw new Error(`设置数据格式不兼容：${field}`);
  return value;
};
const flag = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`设置数据格式不兼容：${field}`);
  return value;
};
const count = (value: unknown): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("设置数据格式不兼容：数量");
  return value;
};
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error("设置数据格式不兼容：列表");
  return value;
};
export function parseRuntimeSettings(value: unknown): RuntimeSettings {
  const v = object(value, "settings");
  const mcp = object(v.mcp, "mcp");
  if (v.authMode !== "token" && v.authMode !== "legacy") throw new Error("设置数据格式不兼容：authMode");
  if (mcp.status !== "ready" && mcp.status !== "unavailable") throw new Error("设置数据格式不兼容：mcp.status");
  return {
    version: text(v.version, "version"),
    hasIdentity: flag(v.hasIdentity, "hasIdentity"),
    relayConnected: flag(v.relayConnected, "relayConnected"),
    updateRequired: flag(v.updateRequired, "updateRequired"),
    authMode: v.authMode,
    devices: list(v.devices).map((value) => {
      const d = object(value, "devices");
      return {
        id: text(d.id, "devices.id"), name: text(d.name, "devices.name"),
        os: text(d.os, "devices.os"), version: text(d.version, "devices.version"),
        online: flag(d.online, "devices.online"), isThisDevice: flag(d.isThisDevice, "devices.isThisDevice"),
        plugins: list(d.plugins).map((value) => {
          const p = object(value, "devices.plugins");
          return { id: text(p.id, "devices.plugins.id"), name: text(p.name, "devices.plugins.name"), state: text(p.state, "devices.plugins.state"), toolCount: count(p.toolCount) };
        }),
      };
    }),
    providers: list(v.providers).map((value) => {
      const p = object(value, "providers");
      return { id: text(p.id, "providers.id"), name: text(p.name, "providers.name"), connected: flag(p.connected, "providers.connected") };
    }),
    bots: list(v.bots).map((value) => {
      const b = object(value, "bots");
      return { id: text(b.id, "bots.id"), name: text(b.name, "bots.name"), runnerId: text(b.runnerId, "bots.runnerId"), provider: b.provider === null ? null : text(b.provider, "bots.provider"), model: b.model === null ? null : text(b.model, "bots.model") };
    }),
    mcp: {
      status: mcp.status,
      runnerId: mcp.runnerId === null ? null : text(mcp.runnerId, "mcp.runnerId"),
      hasConfigError: flag(mcp.hasConfigError, "mcp.hasConfigError"),
      servers: list(mcp.servers).map((value) => {
        const s = object(value, "mcp.servers");
        if (s.transport !== "stdio" && s.transport !== "http" && s.transport !== "unknown") throw new Error("设置数据格式不兼容：mcp.servers.transport");
        return { name: text(s.name, "mcp.servers.name"), transport: s.transport, enabled: flag(s.enabled, "mcp.servers.enabled"), state: text(s.state, "mcp.servers.state"), toolCount: count(s.toolCount), hiddenToolCount: count(s.hiddenToolCount), hasError: flag(s.hasError, "mcp.servers.hasError") };
      }),
    },
  };
}
