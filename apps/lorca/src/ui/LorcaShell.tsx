import { zhCN } from "../locale/zh-CN";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import { TranscriptItem } from "./Transcript";
import { DotsMark } from "./DotsMark";
import { Avatar, ConversationAvatars } from "./Avatar";
import { settleSubmittedDraft } from "./drafts";
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

function conversationGroup(updatedAt: string): string {
  const updated = new Date(updatedAt);
  if (!Number.isFinite(updated.getTime())) return zhCN.chat.conversations;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const difference = today.getTime() - updated.getTime();
  if (difference <= 0) return zhCN.chat.today;
  if (difference < 86400000) return zhCN.chat.yesterday;
  if (difference < 604800000) return zhCN.chat.previousWeek;
  return zhCN.chat.earlier;
}

function ConnectionLabel({ state }: { state: LorcaShellState }) {
  if (state.demo)
    return (
      <>
        <span className="lorca-demo-dot" />
        {zhCN.chat.demo}
      </>
    );
  return (
    <>
      <span
        className={`lorca-status-dot lorca-status-${state.connection.status}`}
      />
      {state.connection.status === "connected"
        ? zhCN.chat.connected
        : state.connection.status === "connecting"
          ? zhCN.chat.connecting
          : zhCN.chat.offline}
    </>
  );
}

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
  const groups = useMemo(() => {
    const result = new Map<string, LorcaConversation[]>();
    for (const conversation of filtered) {
      const label = search
        ? zhCN.chat.searchResults
        : conversationGroup(conversation.updatedAt);
      const group = result.get(label) ?? [];
      group.push(conversation);
      result.set(label, group);
    }
    return Array.from(result);
  }, [filtered, search]);

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
      <nav className="lorca-chat-list" aria-label={zhCN.chat.chats}>
        {groups.map(([label, conversations]) => (
          <section className="lorca-chat-group" key={label}>
            <h2 className={CHROME_SECTION_LABEL_CLASS}>{label}</h2>
            {conversations.map((conversation) => (
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
            ))}
          </section>
        ))}
        {!filtered.length && (
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
          <span>
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
  const followLatest = useRef(true);
  const navigationRevision = useRef(0);
  const mounted = useRef(true);
  const currentConversation = useRef(state.activeConversationId);
  const previousLayout = useRef({
    conversation: state.activeConversationId,
    firstId: state.messages[0]?.id,
    height: 0,
  });
  const draftKey = state.activeConversationId ?? "__new__";
  const draft = drafts[draftKey] ?? "";
  const canInteract = state.demo || state.connection.status === "connected";
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
  }, [draft]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const previous = previousLayout.current;
    if (previous.conversation !== state.activeConversationId) {
      scroll.scrollTop = scroll.scrollHeight;
      followLatest.current = true;
      setShowLatest(false);
      setSendError(null);
    } else if (
      previous.firstId &&
      state.messages[0]?.id !== previous.firstId &&
      state.messages.some((message) => message.id === previous.firstId)
    ) {
      scroll.scrollTop += scroll.scrollHeight - previous.height;
    } else if (followLatest.current) {
      scroll.scrollTop = scroll.scrollHeight;
    }
    previousLayout.current = {
      conversation: state.activeConversationId,
      firstId: state.messages[0]?.id,
      height: scroll.scrollHeight,
    };
  }, [state.messages, state.activeConversationId, state.busy]);

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
    <div className="lorca-app">
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
            {state.demo && (
              <Pill variant="outline" className="lorca-demo-badge">
                {zhCN.chat.syntheticDemo}
              </Pill>
            )}
            <button
              className="lorca-header-status"
              onClick={() => openSettings("connection")}
              aria-label={zhCN.chat.openConnectionSettings}
            >
              <ConnectionLabel state={state} />
              <Icon name="ChevronDown" />
            </button>
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
                {state.messages.map((message) => (
                  <TranscriptItem
                    key={message.id}
                    message={message}
                    actions={actions}
                    disabled={!canInteract}
                  />
                ))}
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
              onSubmit={(event) => void send(event)}
            >
              <label className="sr-only" htmlFor="lorca-composer">
                {zhCN.chat.messageDots}
              </label>
              {hasAttachments && (
                <div className="lorca-pending-attachments">
                  {state.pendingAttachments?.map((attachment) => (
                    <span key={attachment.id}>
                      <Icon name="Folder" />
                      <span>{attachment.name}</span>
                      {actions.onRemoveAttachment && (
                        <button
                          type="button"
                          aria-label={zhCN.chat.removeAttachment(
                            attachment.name,
                          )}
                          onClick={() =>
                            actions.onRemoveAttachment?.(attachment.id)
                          }
                        >
                          <Icon name="X" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
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
                  <div className="lorca-agent-picker">
                    <Avatar appearance={state.agents.find((agent) => agent.id === state.selectedAgentId)?.appearance} />
                    <select
                      aria-label={zhCN.chat.selectBot}
                      value={state.selectedAgentId ?? ""}
                      onChange={(event) => {
                        navigationRevision.current += 1;
                        actions.onSelectAgent(event.target.value);
                      }}
                      disabled={
                        sending ||
                        state.loading ||
                        state.busy ||
                        Boolean(state.activeConversationId) ||
                        !state.agents.length
                      }
                    >
                      {!state.agents.length && (
                        <option value="">{zhCN.chat.noBots}</option>
                      )}
                      {state.agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.label}
                        </option>
                      ))}
                    </select>
                    <Icon name="ChevronDown" />
                  </div>
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
            <div className="lorca-composer-footnote" id="lorca-composer-help">
              <span>
                {state.busy ? zhCN.chat.queueHelp : zhCN.chat.keyboardHelp}
              </span>
              <span>
                {state.demo
                  ? zhCN.chat.demoDataOnly
                  : zhCN.chat.poweredByRuntime}
              </span>
            </div>
          </div>
        </div>
      </main>
      <Settings
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
