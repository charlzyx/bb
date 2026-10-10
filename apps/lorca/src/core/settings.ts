import type { PairingCapabilities, PairingDisabledReason, RuntimeSettings, SettingsEditor } from "../ui/types";
import { object } from "./protocol";

const text = (value: unknown, field: string, maximum = 500): string => {
  if (typeof value !== "string" || value.length > maximum)
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
export function parseSettingsEditor(value: unknown): SettingsEditor {
  const v = object(value, "settings.editor"), review = object(v.autoReview, "autoReview");
  if (review.status !== "ready" && review.status !== "unavailable") throw new Error("设置数据格式不兼容：自动审查状态");
  const revision = text(v.revision, "editor.revision");
  if (!revision) throw new Error("设置数据格式不兼容：编辑版本");
  return {
    revision,
    canUpdateBots: flag(v.canUpdateBots, "editor.canUpdateBots"),
    canAddProvider: flag(v.canAddProvider, "editor.canAddProvider"),
    canManageMcp: flag(v.canManageMcp, "editor.canManageMcp"),
    models: list(v.models).map(value => {
      const m = object(value, "editor.models");
      return { provider: text(m.provider, "models.provider"), id: text(m.id, "models.id"), name: text(m.name, "models.name"), levels: list(m.levels).map(level => text(level, "models.levels")) };
    }),
    bots: list(v.bots).map(value => { const b = object(value, "editor.bots"); return { id: text(b.id, "bots.id"), thinking: b.thinking === null ? null : text(b.thinking, "bots.thinking") }; }),
    providers: list(v.providers).map(value => { const p = object(value, "editor.providers"); return { id: text(p.id, "providers.id"), canConfigure: flag(p.canConfigure, "providers.canConfigure"), canDisconnect: flag(p.canDisconnect, "providers.canDisconnect") }; }),
    autoReview: {
      status: review.status,
      isEnabled: review.isEnabled === null ? null : flag(review.isEnabled, "autoReview.isEnabled"),
      rules: list(review.rules).map(value => {
        const r = object(value, "autoReview.rules");
        if (r.behavior !== "allow" && r.behavior !== "ask") throw new Error("设置数据格式不兼容：审批规则行为");
        return { id: text(r.id, "rules.id"), text: text(r.text, "rules.text", 20_000), behavior: r.behavior, tool: r.tool === null ? null : text(r.tool, "rules.tool") };
      }),
    },
  };
}
const pairingReasons = ["not_connected", "token_auth_required", "identity_required", "already_has_identity", "identity_fields_missing", "relay_missing", "https_relay_required", "unknown_outcome", "bridge_unavailable", "not_reported"] as const;
export function parsePairingCapabilities(value: unknown): PairingCapabilities {
  const input = object(value, "pairingCapabilities");
  const invite = flag(input.invite, "pairingCapabilities.invite"), join = flag(input.join, "pairingCapabilities.join");
  const reasons = (value: unknown, allowed: boolean): PairingDisabledReason[] => {
    if (value === undefined) return allowed ? [] : ["not_reported"];
    if (!Array.isArray(value) || value.length > pairingReasons.length) throw new Error("设置数据格式不兼容：配对禁用原因");
    const result = Array.from(value, value => {
      const reason = pairingReasons.find(reason => reason === value);
      if (!reason) throw new Error("设置数据格式不兼容：配对禁用原因");
      return reason;
    });
    if (new Set(result).size !== result.length || allowed !== (result.length === 0)) throw new Error("设置数据格式不兼容：配对禁用原因");
    return result;
  };
  return { invite, join, inviteReasons: reasons(input.inviteReasons, invite), joinReasons: reasons(input.joinReasons, join) };
}

export function parseRuntimeSettings(value: unknown): RuntimeSettings {
  const v = object(value, "settings");
  const mcp = object(v.mcp, "mcp");
  if (v.authMode !== "token" && v.authMode !== "legacy") throw new Error("设置数据格式不兼容：authMode");
  if (mcp.status !== "ready" && mcp.status !== "unavailable") throw new Error("设置数据格式不兼容：mcp.status");
  return {
    ...(v.editor === undefined ? {} : { editor: parseSettingsEditor(v.editor) }),
    ...(v.pairingCapabilities === undefined ? {} : { pairingCapabilities: parsePairingCapabilities(v.pairingCapabilities) }),
    version: text(v.version, "version"),
    hasIdentity: flag(v.hasIdentity, "hasIdentity"),
    relayConnected: flag(v.relayConnected, "relayConnected"),
    updateRequired: flag(v.updateRequired, "updateRequired"),
    authMode: v.authMode,
    devices: list(v.devices).map((value) => {
      const d = object(value, "devices");
      if (d.role !== undefined && !["runner", "device", "unknown"].includes(String(d.role))) throw new Error("设置数据格式不兼容：设备角色");
      return {
        role: d.role === "runner" || d.role === "device" ? d.role : "unknown",
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
