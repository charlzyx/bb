import { bucketConversations, readSidebarPreferences, writeSidebarPreferences, type SidebarPreferences, type SidebarView } from "./sidebar-preferences";
import { AgentInspector } from "./inspector/AgentInspector";
import { AgentInspectorSession } from "../core/agent-inspector";
import { AgentPicker } from "./AgentPicker";
import { AgentGroupTree } from "./AgentGroupTree";
import { zhCN } from "../locale/zh-CN";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type RefObject,
} from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Pill } from "@bb/shared-ui/pill";
import {
  PersistentResponsiveDrawerShell,
  useResponsiveDrawerRealization,
} from "@bb/shared-ui/responsive-overlay";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ConversationTimeline } from "../../../app/src/components/ui/conversation";
import { Transcript } from "./Transcript";
import { DotsMark } from "./DotsMark";
import { ConnectionLabel, ConnectionStatusPopover } from "./ConnectionStatusPopover";
import { ComposerRunnerStatus } from "./ComposerRunnerStatus";
import { PendingAttachments } from "./PendingAttachments";
import { insertAttachmentText } from "./attachment-input";
import { ConversationAvatars } from "./Avatar";
import { settleSubmittedDraft } from "./drafts";
import { hasTranscriptLayoutUpdate } from "./transcript-layout";
import { readContentWidthPreference, writeContentWidthPreference, type ContentWidth } from "./content-width";
import { Settings } from "./Settings";
import type { SettingsPage } from "./settings/SettingsFrame";
import {
  readAppearancePreference,
  writeAppearancePreference,
  type Appearance,
} from "./settings/appearance";
import type {
  LorcaConversation,
  LorcaShellProps,
  LorcaShellState,
} from "./types";

function Sidebar({
  state,
  actions,
  searchRef,
  onSettings,
  onNavigate,
}: LorcaShellProps & {
  searchRef: RefObject<HTMLInputElement | null>;
  onSettings: () => void;
  onNavigate: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () =>
      state.conversations
        .filter((conversation) =>
          conversation.title
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase()),
        )
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [state.conversations, search],
  );
  const [preferenceState, setPreferenceState] = useState(() => ({ namespace: state.localGroupNamespace, value: readSidebarPreferences(state.localGroupNamespace) }));
  const [preferenceError, setPreferenceError] = useState(false);
  if (preferenceState.namespace !== state.localGroupNamespace) {
    setPreferenceState({ namespace: state.localGroupNamespace, value: readSidebarPreferences(state.localGroupNamespace) });
    setPreferenceError(false);
  }
  const preferences = preferenceState.value;
  const listRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Record<SidebarView, number>>({ recent: 0, teams: 0 });
  const [calendarNow, setCalendarNow] = useState(() => new Date());
  useEffect(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(() => setCalendarNow(new Date()), next.getTime() - now.getTime() + 20);
    return () => clearTimeout(timer);
  }, [calendarNow]);
  const groups = useMemo(() => bucketConversations(filtered, calendarNow), [filtered, calendarNow]);
  const savePreferences = (value: SidebarPreferences) => {
    setPreferenceState({ namespace: state.localGroupNamespace, value });
    setPreferenceError(Boolean(state.localGroupNamespace) && !writeSidebarPreferences(state.localGroupNamespace, value));
  };
  const selectView = (view: SidebarView) => {
    if (view === preferences.view) return;
    scrollPositions.current[preferences.view] = listRef.current?.scrollTop ?? 0;
    savePreferences({ ...preferences, view });
  };
  useLayoutEffect(() => { scrollPositions.current = { recent: 0, teams: 0 }; if (listRef.current) listRef.current.scrollTop = 0; }, [state.localGroupNamespace]);
  useLayoutEffect(() => { if (listRef.current) listRef.current.scrollTop = scrollPositions.current[preferences.view]; }, [preferences.view]);

  const renderConversation = (conversation: LorcaConversation) => (
              <button
                key={conversation.id}
                className={`lorca-chat-item${state.activeConversationId === conversation.id ? " lorca-chat-item-active" : ""}`}
                aria-current={
                  state.activeConversationId === conversation.id
                    ? "page"
                    : undefined
                }
                onClick={() => {
                  actions.onSelectConversation(conversation.id);
                  onNavigate();
                }}
              >
                <ConversationAvatars avatars={conversation.avatars} />
                <span className="lorca-chat-item-title">{conversation.title || zhCN.chat.untitledChat}</span>
                {conversation.status !== "idle" && (
                  <span
                    className={`lorca-thread-state lorca-thread-state-${conversation.status}`}
                    aria-label={
                      zhCN.chat.conversationStatus[conversation.status]
                    }
                  >
                    <Icon
                      name={
                        conversation.status === "running"
                          ? "Loading"
                          : conversation.status === "waiting"
                            ? "Circle"
                            : "AlertCircle"
                      }
                    />
                  </span>
                )}
              </button>
  );

  return (
    <div className="lorca-sidebar-content">
      <div className="lorca-brand">
        <span className="lorca-brand-logo">
          <DotsMark />
        </span>
        <span>dots</span>
      </div>
      <div className="lorca-sidebar-controls">
        <Button
          className="lorca-new-chat"
          variant="ghost"
          onClick={() => {
            actions.onNewConversation();
            onNavigate();
          }}
        >
          <Icon name="MessageCirclePlus" />
          <span>{zhCN.chat.newChat}</span>
          <kbd>⌘ N</kbd>
        </Button>
        <div className="lorca-search">
          <Icon name="Search" />
          <input
            ref={searchRef}
            type="search"
            placeholder={zhCN.chat.searchChats}
            aria-label={zhCN.chat.searchChats}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <kbd>⌘ K</kbd>
        </div>
      </div>
      <div className="lorca-sidebar-view-switch" role="group" aria-label="侧栏视图">
        <button type="button" aria-pressed={preferences.view === "recent"} onClick={() => selectView("recent")}>最近</button>
        <button type="button" aria-pressed={preferences.view === "teams"} onClick={() => selectView("teams")}>团队</button>
      </div>
      {preferenceError && <p className="lorca-sidebar-preference-note" role="status">视图偏好暂未保存，仅本窗口生效。</p>}
      <nav ref={listRef} className="lorca-chat-list" aria-label={zhCN.chat.chats}>
        {(preferences.view === "teams" || Boolean(search)) && <>
        <AgentGroupTree
          key={state.localGroupNamespace ?? "unavailable"}
          namespace={state.localGroupNamespace}
          agents={state.agents}
          conversations={state.conversations}
          selectedConversationId={state.activeConversationId}
          onSelectConversation={(id) => { actions.onSelectConversation(id); onNavigate(); }}
          search={search}
          hasOtherSearchResults={Boolean(search && filtered.some(chat => chat.kind !== "group"))}
          selectedAgentId={state.selectedAgentId}
          onSelectAgent={(id) => {
            if (actions.onOpenAgentChat) actions.onOpenAgentChat(id);
            else { actions.onNewConversation(); actions.onSelectAgent(id); }
            onNavigate();
          }}
        />
        </>}
        {preferences.view === "recent" && !search && groups.map(group => {
          const expanded = Boolean(search) || !preferences.collapsed.includes(group.id);
          return <section className="lorca-chat-group" key={group.id} data-recent-bucket={group.id}>
            <button type="button" className="lorca-recent-bucket-toggle" aria-expanded={expanded} title={group.detail} disabled={Boolean(search)} onClick={() => savePreferences({ ...preferences, collapsed: expanded ? [...preferences.collapsed, group.id] : preferences.collapsed.filter(id => id !== group.id) })}>
              <span>{group.label}</span><span className="lorca-recent-bucket-count">{group.conversations.length}</span><Icon name="ChevronRight" />
            </button>
            {expanded && group.conversations.map(renderConversation)}
          </section>;
        })}
        {search && filtered.some(chat => chat.kind !== "group") && <section className="lorca-chat-group"><h2 className={CHROME_SECTION_LABEL_CLASS}>聊天搜索结果</h2>{filtered.filter(chat => chat.kind !== "group").map(renderConversation)}</section>}
        {!search && !state.conversations.length && !state.agents.length && (
          <div className="lorca-sidebar-empty">
            <Icon name={search ? "Search" : "MessageSquare"} />
            <p>
              {search ? zhCN.chat.noMatchingChats : zhCN.chat.conversationsHome}
            </p>
            <span>
              {search ? zhCN.chat.tryAnotherSearch : zhCN.chat.startChatHint}
            </span>
          </div>
        )}
      </nav>
      <footer className="lorca-sidebar-footer">
        <button className="lorca-workspace" aria-label={zhCN.chat.openSettings} onClick={onSettings}>
          <span className="lorca-workspace-icon">
            <Icon name="ComputerTerminal01" />
          </span>
          <span className="lorca-workspace-summary" title={`${zhCN.chat.workspace} · ${state.demo ? zhCN.chat.demo : state.connection.status === "connected" ? zhCN.chat.connected : state.connection.status === "connecting" ? zhCN.chat.connecting : zhCN.chat.offline}`}>
            <strong>{zhCN.chat.workspace}</strong>
            <small>
              <ConnectionLabel state={state} />
            </small>
          </span>
          <Icon name="Settings" />
        </button>
      </footer>
    </div>
  );
}

const suggestions = [
  {
    icon: "Edit",
    label: zhCN.chat.writingSuggestion,
    text: zhCN.chat.writingPrompt,
  },
  {
    icon: "Code",
    label: zhCN.chat.projectSuggestion,
    text: zhCN.chat.projectPrompt,
  },
  {
    icon: "Search",
    label: zhCN.chat.questionSuggestion,
    text: zhCN.chat.questionPrompt,
  },
];

function EmptyState({
  setDraft,
  disabled,
}: {
  setDraft: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="lorca-empty-state">
      <DotsMark large />
      <span className="lorca-empty-eyebrow">{zhCN.chat.emptyEyebrow}</span>
      <h1>{zhCN.chat.emptyTitle}</h1>
      <p>
        {zhCN.chat.emptyFirstLine}
        <br />
        {zhCN.chat.emptySecondLine}
      </p>
      <div className="lorca-suggestions">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.label}
            onClick={() => setDraft(suggestion.text)}
            disabled={disabled}
          >
            <Icon name={suggestion.icon} />
            <span>{suggestion.label}</span>
            <Icon className="lorca-suggestion-arrow" name="ChevronRight" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function LorcaShell(props: LorcaShellProps) {
  return <LorcaShellSession key={props.state.draftScope ?? 0} {...props} />;
}

function LorcaShellSession({ state, actions }: LorcaShellProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRequestedDevice, setSettingsRequestedDevice] = useState<{ id: string; sequence: number }>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorId, setInspectorId] = useState<string | null>(state.selectedAgentId);
  const [inspectorCreating, setInspectorCreating] = useState(false);
  const [inspectorDirty, setInspectorDirty] = useState(false);
  const [inspectorCreationBlocked, setInspectorCreationBlocked] = useState(false);
  const [inspector] = useState(() => new AgentInspectorSession(typeof window === "undefined" ? {} : window.lorca ?? {}));
  const inspectorState = useSyncExternalStore(inspector.subscribe, inspector.getSnapshot, inspector.getSnapshot);
  const inspectorTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => () => inspector.dispose(), [inspector]);
  useEffect(() => { inspector.select(state.localGroupNamespace, inspectorId, inspectorOpen && !settingsOpen); }, [inspector, inspectorId, inspectorOpen, settingsOpen, state.localGroupNamespace]);
  const [inspectorPendingFollow, setInspectorPendingFollow] = useState(false);
  const [inspectorNavigation, setInspectorNavigation] = useState({ chatId: state.activeConversationId, agentId: state.selectedAgentId });
  if (inspectorNavigation.chatId !== state.activeConversationId || inspectorNavigation.agentId !== state.selectedAgentId) {
    setInspectorNavigation({ chatId: state.activeConversationId, agentId: state.selectedAgentId });
    if (inspectorDirty) setInspectorPendingFollow(true);
    else if (!inspectorCreating) setInspectorId(state.selectedAgentId);
  }
  if (inspectorPendingFollow && !inspectorDirty && !inspectorCreating) { setInspectorPendingFollow(false); setInspectorId(state.selectedAgentId); }
  const beginCreateAgent = () => { setInspectorCreationBlocked(false); setInspectorPendingFollow(false); setSettingsOpen(false); setInspectorCreating(true); setInspectorId(null); setInspectorOpen(true); };
  const createAgent = () => { if (inspectorDirty) { setSettingsOpen(false); setInspectorOpen(true); setInspectorCreationBlocked(true); return; } beginCreateAgent(); };
  const closeInspector = () => { setInspectorPendingFollow(false); setInspectorOpen(false); setInspectorDirty(false); setInspectorCreating(false); inspectorTrigger.current?.focus({ preventScroll: true }); };

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [contentWidth, setContentWidth] = useState(readContentWidthPreference);
  const [{ theme, persistent: themePersistent }, setAppearance] = useState(
    readAppearancePreference,
  );
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("preferences");
  const setTheme = (theme: Appearance) =>
    setAppearance({ theme, persistent: writeAppearancePreference(theme) });
  const openSettings = (page: SettingsPage = "preferences") => {
    setSettingsPage(page);
    setSettingsOpen(true);
    actions.onRefreshSettings(undefined, { includeMcp: false });
  };
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const compact = useIsCompactViewport();
  const { isContentRealized: sidebarRealized } = useResponsiveDrawerRealization(
    { open: sidebarOpen, enabled: compact },
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const widthAnchor = useRef<{ element: Element; top: number; conversation: string | null } | null>(null);
  const followLatest = useRef(true);
  const navigationRevision = useRef(0);
  const mounted = useRef(true);
  const currentConversation = useRef(state.activeConversationId);
  const previousLayout = useRef({
    conversation: state.activeConversationId,
    firstId: state.messages[0]?.id,
    height: 0,
    viewportHeight: 0,
    width: 0,
    messages: state.messages,
  });
  const draftKey = state.activeConversationId ?? "__new__";
  const draft = drafts[draftKey] ?? "";
  const canInteract = state.demo || state.connection.status === "connected";
  const acceptsAttachmentInput = Boolean(state.attachmentsEnabled && canInteract && !state.loading && !sending && !settingsOpen && !state.demo);
  const hasAttachments = Boolean(state.pendingAttachments?.length);
  const activeConversation = state.conversations.find(
    (conversation) => conversation.id === state.activeConversationId,
  );
  const visibleChatId = !settingsOpen && !(compact && sidebarOpen) && !state.loading && state.messages.length > 0
    ? state.activeConversationId
    : null;
  const onConversationVisibility = actions.onConversationVisibility;
  const setDraft = (text: string) =>
    setDrafts((current) => ({ ...current, [draftKey]: text }));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    const bridge = window.lorca;
    if (!acceptsAttachmentInput || !bridge?.onAttachmentText) return;
    const conversation = state.activeConversationId;
    return bridge.onAttachmentText((text) => {
      const input = composerRef.current;
      if (!input || !text || currentConversation.current !== conversation || input.closest("[data-attachment-composer]")?.getAttribute("data-attachment-disabled") === "true") return;
      const inserted = insertAttachmentText(input.value, text, input.selectionStart, input.selectionEnd);
      input.value = inserted.value;
      input.focus({ preventScroll: true });
      input.setSelectionRange(inserted.caret, inserted.caret);
      setDrafts((current) => ({ ...current, [draftKey]: inserted.value }));
    });
  }, [acceptsAttachmentInput, draftKey, state.activeConversationId]);

  useEffect(() => {
    onConversationVisibility?.(visibleChatId);
    return () => onConversationVisibility?.(null);
  }, [onConversationVisibility, visibleChatId]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (settingsOpen) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey)
        return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (compact) setSidebarOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), compact ? 160 : 0);
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        navigationRevision.current += 1;
        actions.onNewConversation();
        setSidebarOpen(false);
        composerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [actions, compact, settingsOpen]);

  useLayoutEffect(() => {
    currentConversation.current = state.activeConversationId;
  }, [state.activeConversationId]);

  useLayoutEffect(() => {
    const input = composerRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, 196)}px`;
  }, [draft, contentWidth]);

  useLayoutEffect(() => {
    const input = composerRef.current;
    if (!input || typeof ResizeObserver === "undefined") return;
    let previousWidth = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === previousWidth) return;
      previousWidth = input.clientWidth;
      input.style.height = "0px";
      input.style.height = `${Math.min(input.scrollHeight, 196)}px`;
      const scroll = scrollRef.current;
      if (scroll) {
        if (followLatest.current) scroll.scrollTop = scroll.scrollHeight;
        previousLayout.current.height = scroll.scrollHeight;
        previousLayout.current.viewportHeight = scroll.clientHeight;
        previousLayout.current.width = scroll.clientWidth;
      }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const previous = previousLayout.current;
    const layout = {
      messages: state.messages,
      height: scroll.scrollHeight,
      viewportHeight: scroll.clientHeight,
      width: scroll.clientWidth,
    };
    const anchor = widthAnchor.current;
    widthAnchor.current = null;
    if (previous.conversation !== state.activeConversationId) {
      scroll.scrollTop = scroll.scrollHeight;
      followLatest.current = true;
      setShowLatest(false);
      setSendError(null);
    } else if (anchor && anchor.conversation === state.activeConversationId && anchor.element.isConnected && !followLatest.current) {
      scroll.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top;
    } else if (
      previous.firstId &&
      state.messages[0]?.id !== previous.firstId &&
      state.messages.some((message) => message.id === previous.firstId)
    ) {
      scroll.scrollTop += scroll.scrollHeight - previous.height;
    } else if (followLatest.current && hasTranscriptLayoutUpdate(previous, layout)) {
      scroll.scrollTop = scroll.scrollHeight;
    }
    previousLayout.current = {
      conversation: state.activeConversationId,
      firstId: state.messages[0]?.id,
      ...layout,
    };
  }, [state.messages, state.activeConversationId, state.busy, contentWidth, draft]);

  const changeContentWidth = (value: ContentWidth) => {
    if (value === contentWidth) return;
    const scroll = scrollRef.current;
    const timeline = scroll?.querySelector(".lorca-timeline");
    if (scroll && timeline && !followLatest.current) {
      const visibleTop = scroll.getBoundingClientRect().top + 48;
      const element = Array.from(timeline.children).find((item) => item.getBoundingClientRect().bottom > visibleTop);
      if (element) widthAnchor.current = { element, top: element.getBoundingClientRect().top, conversation: state.activeConversationId };
    }
    writeContentWidthPreference(value);
    setContentWidth(value);
  };

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (
      (!text && !hasAttachments) ||
      sending ||
      !canInteract ||
      state.loading ||
      !state.selectedAgentId
    )
      return;
    const submittedNavigation = navigationRevision.current;
    setSending(true);
    setSendError(null);
    try {
      const result = await actions.onSend(text);
      if (!mounted.current) return;
      const createdChatId =
        draftKey === "__new__" && result ? result.chatId : null;
      const selectCreatedChat =
        createdChatId !== null &&
        submittedNavigation === navigationRevision.current &&
        currentConversation.current === null;
      setDrafts((current) => settleSubmittedDraft(current, draftKey, draft, selectCreatedChat ? createdChatId : null));
      if (selectCreatedChat) actions.onSelectConversation(createdChatId);
      followLatest.current = true;
    } catch (error) {
      if (!mounted.current) return;
      setSendError(
        error instanceof Error ? error.message : zhCN.chat.sendFailed,
      );
    } finally {
      if (mounted.current) {
        setSending(false);
        composerRef.current?.focus();
      }
    }
  }

  const fillSuggestion = (text: string) => {
    setDraft(text);
    composerRef.current?.focus();
  };

  return (
    <div className="lorca-app" data-content-width={contentWidth}>
      <a href="#lorca-composer" className="lorca-skip-link">
        {zhCN.chat.skipToComposer}
      </a>
      {!compact && (
        <aside className="lorca-sidebar">
          <Sidebar
            state={state}
            actions={actions}
            searchRef={searchRef}
            onSettings={() => openSettings()}
            onNavigate={() => {
              navigationRevision.current += 1;
              composerRef.current?.focus();
            }}
          />
        </aside>
      )}
      {compact && (
        <PersistentResponsiveDrawerShell
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          srLabel={zhCN.chat.chats}
          contentClassName="lorca-mobile-sidebar"
        >
          {sidebarRealized && (
            <Sidebar
              state={state}
              actions={actions}
              searchRef={searchRef}
              onSettings={() => {
                setSidebarOpen(false);
                openSettings();
              }}
              onNavigate={() => {
                navigationRevision.current += 1;
                setSidebarOpen(false);
              }}
            />
          )}
        </PersistentResponsiveDrawerShell>
      )}
      <main className="lorca-main">
        <header className="lorca-header">
          <div className="lorca-header-title">
            {compact && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={zhCN.chat.openChats}
                onClick={() => setSidebarOpen(true)}
              >
                <Icon name="PanelLeft" />
              </Button>
            )}
            {activeConversation && <ConversationAvatars avatars={activeConversation.avatars} size="md" />}
            <span className="lorca-header-chat-title">{activeConversation?.title || zhCN.chat.newChat}</span>
            {state.busy && (
              <span className="lorca-header-running">
                <span className="lorca-pulse-dot" />
                {zhCN.chat.working}
              </span>
            )}
          </div>
          <div className="lorca-header-actions">
            <Button ref={inspectorTrigger} variant="ghost" size="icon" aria-label="查看智能体详情" aria-pressed={inspectorOpen} onClick={() => { if (!inspectorOpen) { setInspectorCreating(false); setInspectorId(state.selectedAgentId); setInspectorOpen(true); } else document.querySelector<HTMLElement>(".lorca-agent-inspector")?.focus({ preventScroll: true }); }}><Icon name="PanelRight" /></Button>
            <div className="lorca-content-width" role="group" aria-label={zhCN.chat.contentWidth} title={zhCN.chat.contentWidthHelp}>
              <Button variant="ghost" size="sm" aria-pressed={contentWidth === "wide"} onClick={() => changeContentWidth("wide")}>{zhCN.chat.wideContent}</Button>
              <Button variant="ghost" size="sm" aria-pressed={contentWidth === "reading"} onClick={() => changeContentWidth("reading")}>{zhCN.chat.readingContent}</Button>
            </div>
            {state.demo && (
              <Pill variant="outline" className="lorca-demo-badge">
                {zhCN.chat.syntheticDemo}
              </Pill>
            )}
            <ConnectionStatusPopover state={state} onSettings={() => openSettings("connection")} />
          </div>
        </header>
        <div
          className="lorca-scroll"
          ref={scrollRef}
          onScroll={() => {
            const scroll = scrollRef.current;
            if (!scroll) return;
            followLatest.current =
              scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 96;
            setShowLatest(!followLatest.current && state.messages.length > 0);
          }}
        >
          {state.demo && (
            <div className="lorca-demo-banner">
              <span>{zhCN.chat.demoPreview}</span>
              <span>{zhCN.chat.demoDisconnected}</span>
            </div>
          )}
          {state.loading && !state.messages.length ? (
            <div className="lorca-loading" role="status">
              <Icon name="Loading" />
              {zhCN.chat.loadingConversation}
            </div>
          ) : !state.messages.length ? (
            <EmptyState setDraft={fillSuggestion} disabled={false} />
          ) : (
            <div className="lorca-transcript">
              {state.hasMore && (
                <div className="lorca-load-older">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={actions.onLoadOlder}
                    disabled={state.loadingOlder}
                  >
                    {state.loadingOlder && <Icon name="Loading" />}
                    {state.loadingOlder
                      ? zhCN.chat.loadingEarlier
                      : zhCN.chat.loadEarlier}
                  </Button>
                </div>
              )}
              <ConversationTimeline className="lorca-timeline">
                <Transcript key={state.activeConversationId ?? "empty"} messages={state.messages} actions={actions} disabled={!canInteract} />
              </ConversationTimeline>
              {state.busy &&
                !state.messages.some(
                  (message) => message.kind === "message" && message.streaming,
                ) && (
                  <div className="lorca-thinking" role="status">
                    <ConversationAvatars avatars={activeConversation?.avatars} />
                    <span>{zhCN.chat.workingOnMessage}</span>
                    <span className="lorca-thinking-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                )}
            </div>
          )}
        </div>
        <div className="lorca-composer-area">
          {showLatest && (
            <Button
              className="lorca-jump-latest"
              variant="outline"
              size="sm"
              onClick={() => {
                scrollRef.current?.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: "smooth",
                });
                followLatest.current = true;
                setShowLatest(false);
              }}
            >
              <Icon name="ChevronDown" />
              {zhCN.chat.jumpToLatest}
            </Button>
          )}
          <div className="lorca-composer-width">
            {(state.error || sendError) && (
              <div className="lorca-composer-error" role="alert">
                <Icon name="AlertCircle" />
                <span>{sendError || state.error}</span>
              </div>
            )}
            {!canInteract && (
              <div className="lorca-offline-notice">
                <Icon name="Info" />
                <span>
                  {state.connection.status === "connecting"
                    ? zhCN.chat.connectingRuntime
                    : zhCN.chat.connectToSend}
                </span>
                <button onClick={() => openSettings("connection")}>
                  {zhCN.chat.connectionSettings}
                  <Icon name="ChevronRight" />
                </button>
              </div>
            )}
            {state.queue.length > 0 && (
              <div className="lorca-queue">
                <div className="lorca-queue-heading">
                  <Icon name="ListTodo" />
                  <span>{zhCN.chat.queuedMessages(state.queue.length)}</span>
                </div>
                {state.queue.map((message) => (
                  <div className="lorca-queued-message" key={message.id}>
                    <span>{message.text}</span>
                    {message.canSendNow !== false && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => actions.onSendNow(message.id)}
                        disabled={!canInteract}
                      >
                        {zhCN.chat.sendNow}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <form
              className={`lorca-composer${state.busy ? " lorca-composer-busy" : ""}`}
              data-attachment-composer=""
              data-attachment-disabled={!acceptsAttachmentInput ? "true" : undefined}
              onSubmit={(event) => void send(event)}
            >
              <label className="sr-only" htmlFor="lorca-composer">
                {zhCN.chat.messageDots}
              </label>
              {hasAttachments && <PendingAttachments attachments={state.pendingAttachments ?? []} disabled={sending} onRemove={actions.onRemoveAttachment} />}
              <textarea
                id="lorca-composer"
                ref={composerRef}
                rows={2}
                placeholder={
                  state.busy
                    ? zhCN.chat.followUpPlaceholder
                    : zhCN.chat.messagePlaceholder
                }
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
                aria-describedby="lorca-composer-help"
                title={zhCN.chat.keyboardHelp}
              />
              <div className="lorca-composer-toolbar">
                <div className="lorca-composer-options">
                  {state.attachmentsEnabled && actions.onPickAttachments && (
                    <Button
                      className="lorca-attach-button"
                      variant="ghost"
                      size="icon"
                      type="button"
                      aria-label={zhCN.chat.attachFiles}
                      onClick={actions.onPickAttachments}
                      disabled={!canInteract || sending}
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="m8.5 12.5 6-6a3 3 0 0 1 4.2 4.2l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.3-8.2"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                        <path
                          d="m8.5 12.5 5-5a1 1 0 0 1 1.4 1.4l-6 6a2 2 0 0 1-2.8-2.8"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    </Button>
                  )}
                  {!state.activeConversationId && <AgentPicker agents={state.agents} selectedAgentId={state.selectedAgentId} onSelectAgent={(id) => {
                    navigationRevision.current += 1;
                    actions.onSelectAgent(id);
                  }} disabled={sending || state.loading || state.busy} />}
                  <ComposerRunnerStatus summary={state.runnerSummary} />
                </div>
                <div className="lorca-send-actions">
                  {state.busy && (
                    <Button
                      variant="outline"
                      className="lorca-stop-button"
                      size="icon"
                      type="button"
                      aria-label={zhCN.chat.stopResponse}
                      onClick={actions.onStop}
                      disabled={!canInteract}
                    >
                      <span />
                    </Button>
                  )}
                  <Button
                    className="lorca-send-button"
                    size="icon"
                    type="submit"
                    aria-describedby="lorca-composer-help"
                    aria-label={
                      state.busy
                        ? zhCN.chat.queueMessage
                        : zhCN.chat.sendMessage
                    }
                    disabled={
                      (!draft.trim() && !hasAttachments) ||
                      sending ||
                      !canInteract ||
                      state.loading ||
                      !state.selectedAgentId
                    }
                  >
                    {sending ? (
                      <Icon name="Loading" />
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
                        <path
                          d="M12 19V5m-6 6 6-6 6 6"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </Button>
                </div>
              </div>
            </form>
            <p className="sr-only" id="lorca-composer-help">
              {zhCN.chat.keyboardHelp}
              {state.busy && ` ${zhCN.chat.queueHelp}`}
            </p>
          </div>
        </div>
      </main>
      {inspectorOpen && <AgentInspector
        open={inspectorOpen && !settingsOpen}
        scope={state.localGroupNamespace ?? state.draftScope ?? 0}
        agentId={inspectorId}
        agents={state.agents.filter(agent => (inspectorDirty && agent.id === inspectorId) || !activeConversation || (activeConversation.botIds ?? activeConversation.avatars?.map(avatar => avatar.botId) ?? []).includes(agent.id))}
        details={inspectorState.details}
        memory={inspectorState.memory}
        capabilities={inspectorState.capabilities}
        capabilitiesLoading={inspectorState.capabilitiesLoading}
        capabilitiesError={inspectorState.capabilitiesError}
        contextNotice={inspectorCreationBlocked && inspectorDirty ? "请先保存或取消当前草稿，再创建智能体。" : inspectorPendingFollow ? "当前显示的是另一聊天中的智能体，保存或取消草稿后会跟随当前聊天。" : undefined}
        onCapabilitiesAction={inspector.applyCapabilities}
        loading={inspectorState.loading}
        applying={inspectorState.applying}
        error={inspectorState.error}
        disabled={!state.localGroupNamespace || state.loading || state.demo}
        onClose={closeInspector}
        onCreate={beginCreateAgent}
        onDirtyChange={setInspectorDirty}
        onSelectAgent={id => { setInspectorPendingFollow(false); setInspectorCreating(false); setInspectorId(id); }}
        onRefresh={() => { void inspector.refresh(); }}
        onAction={async action => { const result = await inspector.apply(action); if (result.status === "applied") { await actions.onRefreshData?.(); if (result.chatId) { setInspectorCreating(false); setInspectorId(result.botId); actions.onSelectConversation(result.chatId); } } return result; }}
        onOpenMemory={async () => inspector.openMemory()}
        onEditAvatar={async () => { const result = await inspector.editAvatar(); if (result.status === "applied") await actions.onRefreshData?.(); return result; }}
        onRemoveAvatar={async () => { const result = await inspector.removeAvatar(); if (result.status === "applied") await actions.onRefreshData?.(); return result; }}
        onOpenProvider={async () => { openSettings("providers"); }}
        onOpenPlugins={runnerId => { setSettingsRequestedDevice(previous => ({ id: runnerId, sequence: (previous?.sequence ?? 0) + 1 })); setSettingsPage("mcp"); setSettingsOpen(true); actions.onRefreshSettings(runnerId); }}
      />}
      <Settings
        onCreateAgent={createAgent}
        requestedDevice={settingsRequestedDevice}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        page={settingsPage}
        onPageChange={setSettingsPage}
        connection={state.connection}
        demo={state.demo}
        actions={actions}
        theme={theme}
        onThemeChange={setTheme}
        themePersistent={themePersistent}
        runtime={state.runtimeSettings}
        loading={state.settingsLoading}
        applying={state.settingsApplying}
        error={state.settingsError}
      />
    </div>
  );
}
