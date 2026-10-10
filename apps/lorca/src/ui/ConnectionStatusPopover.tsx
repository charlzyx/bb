import { useRef, useState, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
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

export function ConnectionStatusPopover({ state, onSettings }: { state: ConnectionState; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const handingOff = useRef(false);
  return (
    <Popover modal={false} open={open} onOpenChange={(value) => {
      if (value) handingOff.current = false;
      setOpen(value);
    }}>
      <PopoverTrigger asChild ref={trigger}>
        <button className="lorca-header-status" aria-label={zhCN.chat.viewConnectionStatus}>
          <ConnectionLabel state={state} />
          <Icon name="ChevronDown" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="lorca-connection-popover"
        align="end"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        aria-label={zhCN.chat.connectionStatus}
        aria-labelledby={undefined}
        mobileTitle={zhCN.chat.connectionStatus}
        onCloseAutoFocus={(event) => {
          if (handingOff.current) event.preventDefault();
        }}
      >
        <ConnectionStatusSummary state={state} />
        <Button variant="ghost" className="lorca-connection-settings" onClick={() => {
          handingOff.current = true;
          setOpen(false);
          trigger.current?.focus({ preventScroll: true });
          onSettings();
        }}>
          <Icon name="Settings" />
          <span>{zhCN.chat.connectionSettings}</span>
          <Icon name="ChevronRight" />
        </Button>
      </PopoverContent>
    </Popover>
  );
}
