import { useEffect, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import {
  PersistentResponsiveDrawerShell,
  useResponsiveDrawerRealization,
} from "@bb/shared-ui/responsive-overlay";
import type { LorcaConnection, LorcaShellActions } from "./types";

export function validateEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["ws:", "wss:"].includes(url.protocol))
      return "Use a WebSocket URL beginning with ws:// or wss://.";
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      return "Use the local Lorca service on localhost or a loopback address.";
    if (url.username || url.password || url.search || url.hash)
      return "The endpoint must not contain credentials, query parameters, or a fragment.";
    if (url.pathname !== "/ws") return "The Lorca WebSocket path must be /ws.";
    return null;
  } catch {
    return "Enter a valid local WebSocket URL.";
  }
}

export function Settings({
  open,
  onOpenChange,
  connection,
  demo,
  actions,
  theme,
  onThemeChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: LorcaConnection;
  demo: boolean;
  actions: LorcaShellActions;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
}) {
  const { isContentRealized } = useResponsiveDrawerRealization({ open });
  const [endpoint, setEndpoint] = useState(connection.endpoint);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setEndpoint(connection.endpoint);
    setSaved(false);
    setError(null);
  }, [connection.endpoint, open]);

  return (
    <PersistentResponsiveDrawerShell
      open={open}
      onOpenChange={onOpenChange}
      srLabel="Settings"
      contentClassName="lorca-settings-drawer"
    >
      {isContentRealized && (
        <div className="lorca-settings">
          <header>
            <div>
              <span className="lorca-field-caption">Make yourself at home</span>
              <h2>Settings</h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close settings"
              onClick={() => onOpenChange(false)}
            >
              <Icon name="X" />
            </Button>
          </header>
          <section>
            <h3>Connection</h3>
            <p>
              The desktop bridge connects this interface to your local Lorca
              runtime.
            </p>
            {demo && (
              <div className="lorca-settings-demo">
                <Icon name="Info" />
                <span>
                  You’re viewing a synthetic demo. No Lorca service is
                  connected.
                </span>
              </div>
            )}
            <label htmlFor="lorca-endpoint">Lorca WebSocket endpoint</label>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = endpoint.trim();
                const problem = validateEndpoint(value);
                setError(problem);
                if (!problem) {
                  actions.onSaveEndpoint(value);
                  setSaved(true);
                }
              }}
            >
              <Input
                id="lorca-endpoint"
                value={endpoint}
                placeholder="ws://127.0.0.1:PORT/ws"
                spellCheck={false}
                aria-invalid={Boolean(error)}
                aria-describedby="lorca-endpoint-help"
                onChange={(event) => {
                  setEndpoint(event.target.value);
                  setSaved(false);
                  setError(null);
                }}
              />
              <p className="lorca-input-help" id="lorca-endpoint-help">
                Keep credentials in the native bridge. This field accepts only a
                local service address.
              </p>
              {error && (
                <p className="lorca-field-error" role="alert">
                  {error}
                </p>
              )}
              <div className="lorca-settings-form-actions">
                <Button size="sm" type="submit">
                  Save endpoint
                </Button>
                {saved && (
                  <span role="status">
                    <Icon name="Check" /> Saved
                  </span>
                )}
              </div>
            </form>
            <div className="lorca-connection-detail">
              <span
                className={`lorca-status-dot lorca-status-${connection.status}`}
              />
              <span>
                {demo
                  ? "Demo mode"
                  : connection.status === "connected"
                    ? "Connected to Lorca"
                    : connection.status === "connecting"
                      ? "Connecting to Lorca…"
                      : "Not connected"}
              </span>
              {!demo && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={actions.onReconnect}
                  disabled={connection.status === "connecting"}
                >
                  Reconnect
                </Button>
              )}
            </div>
            {connection.detail && (
              <p className="lorca-connection-explanation">
                {connection.detail}
              </p>
            )}
          </section>
          <section className="lorca-appearance-setting">
            <div>
              <h3>Appearance</h3>
              <p>A quiet space, in your preferred light.</p>
            </div>
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
          </section>
          <footer>
            <span>BB interface</span>
            <span>·</span>
            <span>Lorca runtime</span>
          </footer>
        </div>
      )}
    </PersistentResponsiveDrawerShell>
  );
}
