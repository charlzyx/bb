import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import {
  PersistentResponsiveDrawerShell,
  useResponsiveDrawerRealization,
} from "@bb/shared-ui/responsive-overlay";
import type { LorcaConnection, LorcaShellActions } from "./types";

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
          Keep credentials in the native bridge. This field accepts only a local
          service address.
        </p>
        {error && (
          <p className="lorca-field-error" role="alert">
            {error}
          </p>
        )}
        <div className="lorca-settings-form-actions">
          <Button size="sm" type="submit" disabled={saving || connecting}>
            {saving || connecting ? "Connecting…" : "Save endpoint"}
          </Button>
          {saved && (
            <span role="status">
              <Icon name="Check" /> Saved
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
            <EndpointForm
              key={`${connection.endpoint}:${open}`}
              initialEndpoint={connection.endpoint}
              connecting={connection.status === "connecting"}
              onSaveEndpoint={actions.onSaveEndpoint}
            />
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
