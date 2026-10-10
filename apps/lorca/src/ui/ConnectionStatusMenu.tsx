import { useRef, useState, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { zhCN } from "../locale/zh-CN";
import type { LorcaShellState } from "./types";

type ConnectionState = Pick<LorcaShellState, "connection" | "demo" | "runtimeSettings" | "settingsLoading">;

export function ConnectionLabel({ state }: { state: ConnectionState }) {
  return (
    <>
      <span className={state.demo ? "lorca-demo-dot" : `lorca-status-dot lorca-status-${state.connection.status}`} />
      {state.demo ? zhCN.chat.demo : state.connection.status === "connected" ? zhCN.chat.connected : state.connection.status === "connecting" ? zhCN.chat.connecting : zhCN.chat.offline}
    </>
  );
}

function StatusRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="lorca-connection-row"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function ConnectionStatusSummary({ state }: { state: ConnectionState }) {
  const runtime = state.connection.status === "connected" && !state.settingsLoading ? state.runtimeSettings : undefined;
  const device = runtime?.devices.find((item) => item.isThisDevice);
  return (
    <div className="lorca-connection-summary">
      <h2>{zhCN.chat.connectionStatus}</h2>
      <dl>
        <StatusRow label={zhCN.chat.localService}>
          <span className="lorca-connection-value"><ConnectionLabel state={state} /></span>
        </StatusRow>
        {!state.demo && runtime && <>
          {device && <StatusRow label={zhCN.chat.thisDevice}>{device.name}</StatusRow>}
          <StatusRow label={zhCN.chat.relayStatus}>{runtime.relayConnected ? zhCN.chat.connected : zhCN.chat.offline}</StatusRow>
          <StatusRow label={zhCN.chat.devicesSummary}>{zhCN.chat.onlineDevices(runtime.devices.filter((item) => item.online).length, runtime.devices.length)}</StatusRow>
        </>}
      </dl>
      <p>{state.demo ? zhCN.chat.demoDisconnected : runtime ? zhCN.chat.statusSnapshot : state.connection.status === "connected" ? zhCN.chat.deviceStatusNotRead : state.connection.status === "connecting" ? zhCN.chat.connectingRuntime : state.connection.status === "error" ? zhCN.chat.connectionFailed : zhCN.chat.connectToSend}</p>
    </div>
  );
}

export function ConnectionStatusMenu({ state, onSettings }: { state: ConnectionState; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const menuOpen = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(true);
  const changeOpen = (value: boolean) => {
    menuOpen.current = value;
    if (value) restoreFocus.current = true;
    setOpen(value);
  };
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={changeOpen}>
      <DropdownMenuTrigger asChild ref={trigger}>
        <button className="lorca-header-status" aria-label={zhCN.chat.viewConnectionStatus}>
          <ConnectionLabel state={state} />
          <Icon name="ChevronDown" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="lorca-connection-menu"
        align="end"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        aria-label={zhCN.chat.connectionStatus}
        mobileTitle={zhCN.chat.connectionStatus}
        onInteractOutside={() => { restoreFocus.current = false; }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!menuOpen.current && restoreFocus.current) trigger.current?.focus({ preventScroll: true });
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          event.preventDefault();
          const root = trigger.current?.closest(".lorca-app");
          const controls = Array.from(root?.querySelectorAll<HTMLElement>("button, a[href], input, textarea, select, summary, [tabindex]") ?? [])
            .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[inert], [aria-hidden=true]") && element.getClientRects().length > 0);
          const index = controls.findIndex((element) => element === trigger.current);
          const target = controls[index + (event.shiftKey ? -1 : 1)] ?? trigger.current;
          restoreFocus.current = false;
          changeOpen(false);
          target?.focus({ preventScroll: true });
        }}
      >
        <ConnectionStatusSummary state={state} />
        <DropdownMenuItem className="lorca-connection-settings" onSelect={() => {
          restoreFocus.current = false;
          changeOpen(false);
          trigger.current?.focus({ preventScroll: true });
          onSettings();
        }}>
          <Icon name="Settings" />
          <span>{zhCN.chat.connectionSettings}</span>
          <Icon name="ChevronRight" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
