import { useState, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import type { LorcaBotAppearance } from "./types";

const symbols: Readonly<Record<string, string>> = {
  terminal: "ComputerTerminal01",
  "terminal.fill": "ComputerTerminal01",
  "chevron.left.forwardslash.chevron.right": "Code",
  "star.fill": "Star",
  star: "Star",
  globe: "Globe",
  "brain.head.profile": "Brain",
  "envelope.fill": "Mail",
  calendar: "Calendar",
  folder: "Folder",
  "folder.fill": "Folder",
  "gearshape.fill": "Settings",
  gearshape: "Settings",
  "bolt.fill": "Zap",
  bolt: "Zap",
  magnifyingglass: "Search",
  "bubble.left": "MessageCircle",
  "bubble.left.fill": "MessageCircle",
  "person.fill": "UserRound",
  "person.crop.circle": "UserRound",
};

const accents = new Set(["indigo", "blue", "teal", "green", "orange", "pink", "purple", "red"]);

export function safeAvatarImage(value: string | undefined): string | undefined {
  return value && value.length <= 1024 * 1024 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    ? value
    : undefined;
}

function Sparkles() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      <path d="M20 2v4M18 4h4M4 18v4M2 20h4" />
    </svg>
  );
}

function AvatarImage({ source, fallback }: { source: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return failed ? fallback : (
    <img
      data-avatar-image=""
      src={source}
      alt=""
      draggable={false}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function Avatar({ appearance, person = false, size = "sm" }: {
  appearance?: LorcaBotAppearance;
  person?: boolean;
  size?: "sm" | "md";
}) {
  const source = person ? undefined : safeAvatarImage(appearance?.image);
  const requestedSymbol = appearance?.symbolName ?? "";
  const symbol = person ? "UserRound" : Object.hasOwn(symbols, requestedSymbol) ? symbols[requestedSymbol] : undefined;
  const accent = appearance && accents.has(appearance.accent) ? appearance.accent : "indigo";
  const fallback = (
    <span className="lorca-avatar-fallback" data-avatar-fallback="">
      {symbol ? <Icon name={symbol} /> : <Sparkles />}
    </span>
  );
  return (
    <span
      className={`lorca-avatar lorca-avatar-${size}${person ? " lorca-avatar-person" : ""}`}
      data-accent={person ? undefined : accent}
      data-avatar-bot={person ? undefined : appearance?.botId}
      aria-hidden="true"
    >
      {source ? (
        <AvatarImage key={source} source={source} fallback={fallback} />
      ) : fallback}
    </span>
  );
}

export function ConversationAvatars({ avatars, size = "sm" }: {
  avatars?: LorcaBotAppearance[];
  size?: "sm" | "md";
}) {
  const visible = avatars?.slice(0, 2) ?? [];
  return (
    <span className={`lorca-conversation-avatars${visible.length > 1 ? " lorca-avatar-stack" : ""}`} aria-hidden="true">
      {visible.length ? visible.map((appearance, index) => <Avatar key={`${appearance.botId}:${index}`} appearance={appearance} size={size} />) : <Avatar size={size} />}
    </span>
  );
}
