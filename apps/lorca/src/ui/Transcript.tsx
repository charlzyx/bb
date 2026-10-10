import { zhCN } from "../locale/zh-CN";
import { useEffect, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Pill } from "@bb/shared-ui/pill";
import { CONTEXT_CARD_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { Markdown } from "./markdown";
import { Avatar } from "./Avatar";
import { copyText } from "./clipboard";
import type { LorcaMessage, LorcaShellActions } from "./types";
import { groupToolRecords, rememberToolExpansion, stableToolGroupIds, toolGroupExpanded } from "./tool-groups";

type ApprovalMessage = Extract<LorcaMessage, { kind: "approval" }>;
type ToolMessage = Extract<LorcaMessage, { kind: "tool" }>;
type CrossAgentMessage = Extract<LorcaMessage, { kind: "cross-agent" }>;

function CrossAgentRow({ message }: { message: CrossAgentMessage }) {
  const bot = (appearance: CrossAgentMessage["from"]) => (
    <>
      <Avatar appearance={appearance ?? undefined} />
      <span>{appearance?.name || "未知智能体"}</span>
    </>
  );
  const label = message.direction === "incoming"
    ? <>来自 {bot(message.from)}</>
    : message.direction === "outgoing"
      ? <>已发消息给 {bot(message.to)}</>
      : <>{bot(message.from)} <span aria-label="交接给">→</span> {bot(message.to)}</>;
  const preview = message.text.split(/\r?\n/).find(line => line.trim())?.trim() ?? "";
  return (
    <details className="lorca-cross-agent">
      <summary>
        <span className="lorca-cross-agent-label">{label}</span>
        {preview && <span className="lorca-cross-agent-preview">· {preview}</span>}
      </summary>
      <div className="lorca-cross-agent-detail">{message.text || "没有更多内容"}</div>
    </details>
  );
}

function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied && !failed) return;
    const timeout = window.setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [copied, failed]);
  return (
    <Button
      className="lorca-copy-message"
      variant="ghost"
      size="icon"
      aria-label={
        copied
          ? zhCN.transcript.messageCopied
          : failed
            ? zhCN.transcript.copyFailed
            : zhCN.transcript.copyMessage
      }
      onClick={() => {
        void copyText(text).then(
          () => setCopied(true),
          () => setFailed(true),
        );
      }}
    >
      <Icon name={copied ? "Check" : failed ? "AlertCircle" : "Copy"} />
    </Button>
  );
}

function ToolCard({ message, expanded, onExpand }: { message: ToolMessage; expanded?: boolean; onExpand?: (expanded: boolean) => void }) {
  return (
    <details className={`lorca-tool-card ${CONTEXT_CARD_CLASS}`} open={expanded} data-tool-id={message.id} data-tool-status={message.status}>
      <summary onClick={onExpand ? event => { event.preventDefault(); onExpand(!expanded); } : undefined}>
        <span className={`lorca-tool-icon lorca-tool-${message.status}`}>
          <Icon
            name={
              message.status === "running"
                ? "Loading"
                : message.status === "error"
                  ? "AlertCircle"
                  : "CircleCheck"
            }
          />
        </span>
        <span className="lorca-tool-name">{message.name}</span>
        <span className="lorca-tool-status">
          {message.status === "running"
            ? zhCN.transcript.working
            : message.status === "error"
              ? zhCN.transcript.failed
              : zhCN.transcript.complete}
        </span>
        <Icon className="lorca-disclosure-chevron" name="ChevronRight" />
      </summary>
      <div className="lorca-tool-body">
        {message.input && (
          <>
            <span className="lorca-field-caption">{zhCN.transcript.input}</span>
            <pre>{message.input}</pre>
          </>
        )}
        {message.output && (
          <>
            <span className="lorca-field-caption">
              {zhCN.transcript.result}
            </span>
            <pre>{message.output}</pre>
          </>
        )}
        {!message.input && !message.output && (
          <p>{zhCN.transcript.noDetails}</p>
        )}
      </div>
    </details>
  );
}

export function Transcript({ messages, actions, disabled }: { messages: readonly LorcaMessage[]; actions: LorcaShellActions; disabled: boolean }) {
  const [groups, setGroups] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [details, setDetails] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [projection, setProjection] = useState(() => {
    const anchors = new Map<string, string>();
    return { messages, entries: stableToolGroupIds(groupToolRecords(messages), anchors), anchors };
  });
  let currentProjection = projection;
  if (projection.messages !== messages) {
    const anchors = new Map(projection.anchors);
    currentProjection = { messages, entries: stableToolGroupIds(groupToolRecords(messages), anchors), anchors };
    setProjection(currentProjection);
  }
  return currentProjection.entries.map(entry => {
    if (entry.kind === "item") return <TranscriptItem key={`message:${entry.message.id}`} message={entry.message} actions={actions} disabled={disabled} />;
    const expanded = toolGroupExpanded(entry.messages, groups);
    const running = entry.messages.filter(message => message.status === "running");
    const errors = entry.messages.filter(message => message.status === "error");
    const current = running.at(-1);
    const controls = `tool-records-${entry.id}`;
    return (
      <section className="lorca-tool-group" key={`tools:${entry.id}`} data-tool-group={entry.id} data-tool-count={entry.messages.length}>
        <button type="button" className="lorca-tool-group-toggle" aria-expanded={expanded} aria-controls={controls}
          onClick={() => setGroups(previous => rememberToolExpansion(previous, entry.messages.map(message => message.id), !expanded))}>
          <Icon name={errors.length ? "AlertCircle" : current ? "Loading" : "CircleCheck"} className={errors.length ? "lorca-tool-error" : current ? "lorca-tool-running" : "lorca-tool-group-done"} />
          <span>工具记录 · {entry.messages.length} 项</span>
          <span className="lorca-tool-group-state" aria-live="polite">{errors.length ? `${errors.length} 项失败` : current ? "正在执行工具" : "已完成"}</span>
          <Icon name="ChevronRight" className="lorca-disclosure-chevron" />
        </button>
        {current && <div className="lorca-tool-live" role="status"><span className="lorca-tool-live-dot" /><span>{current.name || "正在执行工具"}</span></div>}
        {errors.length > 0 && <p className="lorca-tool-group-errors" role="alert">失败：{errors.map(message => message.name).join("、")}</p>}
        <div id={controls} className="lorca-tool-group-items" hidden={!expanded}>
          {entry.messages.map(message => <ToolCard key={message.id} message={message} expanded={details.get(message.id) ?? message.status === "error"}
            onExpand={value => setDetails(previous => rememberToolExpansion(previous, [message.id], value))} />)}
        </div>
      </section>
    );
  });
}

function ApprovalCard({
  message,
  onApproval,
  disabled,
}: {
  message: ApprovalMessage;
  onApproval: LorcaShellActions["onApproval"];
  disabled: boolean;
}) {
  return (
    <section
      className="lorca-approval-card"
      aria-label={zhCN.transcript.approvalRequest}
    >
      <div className="lorca-approval-heading">
        <span className="lorca-approval-symbol">
          <Icon name="MessageQuestion" />
        </span>
        <div>
          <span className="lorca-field-caption">
            {zhCN.transcript.yourPermission}
          </span>
          <h3>{message.title}</h3>
        </div>
        {message.status !== "pending" && (
          <Pill variant="secondary">
            {message.status === "approved"
              ? zhCN.transcript.approved
              : message.status === "expired"
                ? zhCN.transcript.expired
                : zhCN.transcript.denied}
          </Pill>
        )}
      </div>
      <p>{message.detail}</p>
      {message.status === "pending" && (
        <div className="lorca-approval-actions">
          {message.canAllow !== false && (
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => onApproval(message.id, "allow")}
            >
              {zhCN.transcript.allowOnce}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onApproval(message.id, "deny")}
          >
            {zhCN.transcript.deny}
          </Button>
          {message.canAllow !== false && message.canAlways && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onApproval(message.id, "always")}
            >
              {zhCN.transcript.alwaysAllowTool}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export function TranscriptItem({
  message,
  actions,
  disabled,
}: {
  message: LorcaMessage;
  actions: LorcaShellActions;
  disabled: boolean;
}) {
  if (message.kind === "cross-agent") return <CrossAgentRow message={message} />;
  if (message.kind === "tool") return <ToolCard message={message} />;
  if (message.kind === "approval")
    return (
      <ApprovalCard
        message={message}
        onApproval={actions.onApproval}
        disabled={disabled}
      />
    );
  if (message.kind === "notice")
    return (
      <div
        className={`lorca-notice lorca-notice-${message.tone}`}
        role={message.tone === "error" ? "alert" : "status"}
      >
        <Icon name={message.tone === "error" ? "AlertCircle" : "Info"} />
        <p>{message.text}</p>
      </div>
    );
  const attachments =
    message.attachments && message.attachments.length > 0 ? (
      <div className="lorca-message-attachments">
        {message.attachments.map((attachment) => (
          <span key={attachment.id}>
            <Icon name="Folder" />
            {attachment.name}
          </span>
        ))}
      </div>
    ) : null;
  if (message.role === "user")
    return (
      <article
        className="lorca-user-message"
        aria-label={zhCN.transcript.yourMessage}
      >
        <div>
          {message.text}
          {message.error && (
            <div className="lorca-message-error" role="alert">
              <Icon name="AlertCircle" />
              <span>{message.error}</span>
            </div>
          )}
          {attachments}
        </div>
        <Avatar person />
      </article>
    );
  return (
    <article
      className={`lorca-assistant-message${message.streaming ? " lorca-message-streaming" : ""}`}
      aria-label={zhCN.transcript.assistantResponse(
        message.authorName || "dots",
      )}
    >
      <div className="lorca-message-author">
        <Avatar appearance={message.authorAvatar} size="md" />
        <span>{message.authorName || "dots"}</span>
        {message.streaming && (
          <span className="lorca-streaming-label">
            {zhCN.transcript.writing}
            <span className="lorca-pulse-dot" />
          </span>
        )}
      </div>
      <Markdown text={message.text} />
      {attachments}
      {message.error && (
        <div className="lorca-message-error" role="alert">
          <Icon name="AlertCircle" />
          <span>{message.error}</span>
        </div>
      )}
      {!message.streaming && message.text && (
        <div className="lorca-message-actions">
          <CopyMessage text={message.text} />
        </div>
      )}
    </article>
  );
}
