import { zhCN } from "../locale/zh-CN";
import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { copyText } from "./clipboard";

export function safeMarkdownUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const copy = async () => {
    try {
      await copyText(ref.current?.textContent ?? "");
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="lorca-code-block">
      <div className="lorca-code-heading">
        <span>
          <Icon name="Code" /> {zhCN.transcript.code}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void copy()}
          aria-label={zhCN.transcript.copyCode}
        >
          <Icon name={copyState === "copied" ? "Check" : "Copy"} />
          {copyState === "copied"
            ? zhCN.transcript.copied
            : copyState === "failed"
              ? zhCN.transcript.copyFailed
              : zhCN.transcript.copy}
        </Button>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="lorca-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => safeMarkdownUrl(url) ?? ""}
        components={{
          a: ({ href, children }) =>
            href ? (
              <span className="lorca-reference-link" title={href}>
                {children}
              </span>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt }) =>
            typeof src === "string" && src ? (
              <span className="lorca-image-reference" title={src}>
                <Icon name="Folder" /> {alt || zhCN.transcript.imageReference}
              </span>
            ) : (
              <span>{alt || zhCN.transcript.imageUnavailable}</span>
            ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          table: ({ children }) => (
            <div className="lorca-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
