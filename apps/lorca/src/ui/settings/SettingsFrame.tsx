import { useCallback, useRef, type ReactNode } from "react";
import { settingsZh } from "../../locale/settings.zh-CN";
import { editorZh } from "../../locale/editor.zh-CN";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  PersistentResponsiveDrawerShell,
  usePersistentOverlayFocus,
  useResponsiveDrawerRealization,
} from "@bb/shared-ui/responsive-overlay";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "../../../../app/src/components/sidebar/sidebarRowClasses";

export type SettingsPage = "connection" | "devices" | "preferences" | "providers" | "models" | "mcp" | "approvals";

const pages: {
  id: SettingsPage;
  label: string;
  icon: string;
  description: string;
}[] = [
  { id: "preferences", label: settingsZh.preferences, icon: "SlidersHorizontal", description: settingsZh.preferencesDescription },
  { id: "providers", label: editorZh.manageProviders, icon: "Globe", description: editorZh.providersDescription },
  { id: "approvals", label: editorZh.autoReview, icon: "ShieldCheck", description: editorZh.autoReviewDescription },
  { id: "mcp", label: settingsZh.plugins, icon: "Toolbox", description: settingsZh.mcpDescription },
  { id: "models", label: editorZh.models, icon: "Bot", description: editorZh.modelsDescription },
  { id: "devices", label: settingsZh.devices, icon: "ComputerTerminal01", description: settingsZh.devicesDescription },
  { id: "connection", label: settingsZh.advanced, icon: "Settings", description: settingsZh.connectionDescription },
];

export function SettingsFrame({
  open,
  onOpenChange,
  page,
  onPageChange,
  demo,
  children,
  deviceControl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: SettingsPage;
  onPageChange: (page: SettingsPage) => void;
  demo: boolean;
  children: ReactNode;
  deviceControl?: ReactNode;
}) {
  const compact = useIsCompactViewport();
  const desktopRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const { isContentRealized } = useResponsiveDrawerRealization({
    open,
    enabled: compact,
  });
  usePersistentOverlayFocus({
    open: open && !compact,
    panelRef: desktopRef,
    requestClose: close,
  });
  const current = pages.find((candidate) => candidate.id === page) ?? pages[0];
  const navigation = (
    <nav
      className="lorca-settings-navigation"
      aria-label={settingsZh.settingsSections}
    >
      {pages.map((item) => (
        <Button
          key={item.id}
          variant="ghost"
          size="sm"
          className={`${PROJECT_LIST_ACTION_BUTTON_CLASS} lorca-settings-nav-item`}
          aria-current={page === item.id ? "page" : undefined}
          onClick={() => onPageChange(item.id)}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </Button>
      ))}
    </nav>
  );
  const heading = (
    <header className="lorca-settings-page-header">
      <div>
        <span className="lorca-field-caption">{settingsZh.settings}</span>
        <h1 id="lorca-settings-page-title">{current.label}</h1>
        <p>{current.description}</p>
      </div>
      <div className="lorca-settings-header-controls">
      {deviceControl}
      <Button
        variant="ghost"
        size="icon"
        aria-label={settingsZh.closeSettings}
        onClick={close}
      >
        <Icon name="X" />
      </Button>
      </div>
    </header>
  );
  const notice = demo && (
    <div className="lorca-settings-preview-label">
      <Icon name="Info" />
      <span>{settingsZh.previewNotice}</span>
    </div>
  );

  if (compact)
    return (
      <PersistentResponsiveDrawerShell
        open={open}
        onOpenChange={onOpenChange}
        srLabel={settingsZh.settings}
        contentClassName="lorca-settings-drawer lorca-settings-compact"
      >
        {isContentRealized && (
          <div className="lorca-settings">
            {heading}
            {navigation}
            {notice}
            <div className="lorca-settings-section-content">{children}</div>
          </div>
        )}
      </PersistentResponsiveDrawerShell>
    );

  return (
    <div
      ref={desktopRef}
      className="lorca-settings-desktop lorca-settings"
      data-open={open}
      role="dialog"
      aria-label={settingsZh.settings}
      aria-modal={open || undefined}
      aria-hidden={!open}
      inert={!open}
      tabIndex={-1}
    >
      <aside className="lorca-settings-sidebar">
        <Button variant="ghost" className="lorca-settings-back" onClick={close}>
          <Icon name="ChevronLeft" />
          <span>{settingsZh.backToChat}</span>
        </Button>
        <h2>{settingsZh.settings}</h2>
        {navigation}
        <footer>
          <span>{settingsZh.appName}</span>
        </footer>
      </aside>
      <div className="lorca-settings-desktop-main">
        <div className="lorca-settings-scroll">
          {heading}
          <div className="lorca-settings-reading-width">
            {notice}
            <div className="lorca-settings-section-content">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
