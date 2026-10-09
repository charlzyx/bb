export function DotsMark({ large = false }: { large?: boolean }) {
  return (
    <span
      className={`lorca-assistant-mark${large ? " lorca-assistant-mark-large" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" fill="currentColor">
        <circle cx="10" cy="10" r="3.5" />
        <circle cx="22" cy="10" r="3.5" />
        <circle cx="10" cy="22" r="3.5" />
        <circle cx="22" cy="22" r="3.5" />
      </svg>
    </span>
  );
}
