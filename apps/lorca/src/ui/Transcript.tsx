import { useEffect, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Pill } from "@bb/shared-ui/pill";
import { CONTEXT_CARD_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { Markdown } from "./markdown";
import { copyText } from "./clipboard";
import type { LorcaMessage, LorcaShellActions } from "./types";

type ApprovalMessage = Extract<LorcaMessage, { kind: "approval" }>;
type ToolMessage = Extract<LorcaMessage, { kind: "tool" }>;

export function AssistantMark({ large = false }: { large?: boolean }) {
  return (
    <span
      className={`lorca-assistant-mark${large ? " lorca-assistant-mark-large" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="M16 5v22M5 16h22M8.2 8.2l15.6 15.6M8.2 23.8 23.8 8.2"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        <path
          d="m12.1 6.5 7.8 19M6.5 19.9l19-7.8M6.5 12.1l19 7.8M12.1 25.5l7.8-19"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      </svg>
    </span>
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
        copied ? "Message copied" : failed ? "Copy failed" : "Copy message"
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

function ToolCard({ message }: { message: ToolMessage }) {
  return (
    <details className={`lorca-tool-card ${CONTEXT_CARD_CLASS}`}>
      <summary>
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
            ? "Working"
            : message.status === "error"
              ? "Failed"
              : "Complete"}
        </span>
        <Icon className="lorca-disclosure-chevron" name="ChevronRight" />
      </summary>
      <div className="lorca-tool-body">
        {message.input && (
          <>
            <span className="lorca-field-caption">Input</span>
            <pre>{message.input}</pre>
          </>
        )}
        {message.output && (
          <>
            <span className="lorca-field-caption">Result</span>
            <pre>{message.output}</pre>
          </>
        )}
        {!message.input && !message.output && (
          <p>No additional details were provided.</p>
        )}
      </div>
    </details>
  );
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
    <section className="lorca-approval-card" aria-label="Approval request">
      <div className="lorca-approval-heading">
        <span className="lorca-approval-symbol">
          <Icon name="MessageQuestion" />
        </span>
        <div>
          <span className="lorca-field-caption">Your permission</span>
          <h3>{message.title}</h3>
        </div>
        {message.status !== "pending" && (
          <Pill variant="secondary">
            {message.status === "approved"
              ? "Approved"
              : message.status === "expired"
                ? "Expired"
                : "Denied"}
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
              Allow once
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onApproval(message.id, "deny")}
          >
            Deny
          </Button>
          {message.canAllow !== false && message.canAlways && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onApproval(message.id, "always")}
            >
              Always allow this tool
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
      <article className="lorca-user-message" aria-label="Your message">
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
      </article>
    );
  return (
    <article
      className={`lorca-assistant-message${message.streaming ? " lorca-message-streaming" : ""}`}
      aria-label="Lorca response"
    >
      <div className="lorca-message-author">
        <AssistantMark />
        <span>Lorca</span>
        {message.streaming && (
          <span className="lorca-streaming-label">
            Writing
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
