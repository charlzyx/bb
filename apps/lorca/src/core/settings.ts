import type { RuntimeSettings } from "../ui/types";
import { object } from "./protocol";

const text = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length > 500)
    throw new Error(`Incompatible settings: ${field}`);
  return value;
};
const flag = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`Incompatible settings: ${field}`);
  return value;
};
const count = (value: unknown): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Incompatible settings: count");
  return value;
};
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error("Incompatible settings: list");
  return value;
};
export function parseRuntimeSettings(value: unknown): RuntimeSettings {
  const v = object(value, "settings");
  const mcp = object(v.mcp, "MCP settings");
  if (v.authMode !== "token" && v.authMode !== "legacy") throw new Error("Incompatible settings: authentication");
  if (mcp.status !== "ready" && mcp.status !== "unavailable") throw new Error("Incompatible settings: MCP status");
  return {
    version: text(v.version, "version"),
    hasIdentity: flag(v.hasIdentity, "identity"),
    relayConnected: flag(v.relayConnected, "relay"),
    updateRequired: flag(v.updateRequired, "update"),
    authMode: v.authMode,
    devices: list(v.devices).map((value) => {
      const d = object(value, "device");
      return {
        id: text(d.id, "device id"), name: text(d.name, "device name"),
        os: text(d.os, "device OS"), version: text(d.version, "device version"),
        online: flag(d.online, "online"), isThisDevice: flag(d.isThisDevice, "local device"),
        plugins: list(d.plugins).map((value) => {
          const p = object(value, "plugin");
          return { id: text(p.id, "plugin id"), name: text(p.name, "plugin name"), state: text(p.state, "plugin state"), toolCount: count(p.toolCount) };
        }),
      };
    }),
    providers: list(v.providers).map((value) => {
      const p = object(value, "provider");
      return { id: text(p.id, "provider id"), name: text(p.name, "provider name"), connected: flag(p.connected, "provider configured") };
    }),
    bots: list(v.bots).map((value) => {
      const b = object(value, "bot");
      return { id: text(b.id, "bot id"), name: text(b.name, "bot name"), runnerId: text(b.runnerId, "runner id"), provider: b.provider === null ? null : text(b.provider, "provider"), model: b.model === null ? null : text(b.model, "model") };
    }),
    mcp: {
      status: mcp.status,
      runnerId: mcp.runnerId === null ? null : text(mcp.runnerId, "MCP runner"),
      hasConfigError: flag(mcp.hasConfigError, "MCP config error"),
      servers: list(mcp.servers).map((value) => {
        const s = object(value, "MCP server");
        if (s.transport !== "stdio" && s.transport !== "http" && s.transport !== "unknown") throw new Error("Incompatible settings: transport");
        return { name: text(s.name, "MCP name"), transport: s.transport, enabled: flag(s.enabled, "MCP enabled"), state: text(s.state, "MCP state"), toolCount: count(s.toolCount), hiddenToolCount: count(s.hiddenToolCount), hasError: flag(s.hasError, "MCP error") };
      }),
    },
  };
}
