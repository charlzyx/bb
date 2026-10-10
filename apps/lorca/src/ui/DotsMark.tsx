export function DotsMark({ large = false }: { large?: boolean }) {
  const size = large ? 128 : 64;
  const base = import.meta.env?.BASE_URL ?? "./";
  return (
    <span
      className={`lorca-assistant-mark${large ? " lorca-assistant-mark-large" : ""}`}
      aria-hidden="true"
    >
      <img
        data-app-mark="ghost"
        src={`${base}app-icon/${size}.png`}
        width={size}
        height={size}
        alt=""
        draggable={false}
      />
    </span>
  );
}
