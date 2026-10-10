export type ContentWidth = "wide" | "reading";

export const CONTENT_WIDTH_STORAGE_KEY = "bb-lorca.content-width";

export function readContentWidthPreference(storage?: Pick<Storage, "getItem">): ContentWidth {
  try {
    const source = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    return source?.getItem(CONTENT_WIDTH_STORAGE_KEY) === "reading" ? "reading" : "wide";
  } catch {
    return "wide";
  }
}

export function writeContentWidthPreference(value: ContentWidth, storage?: Pick<Storage, "setItem">): boolean {
  try {
    const target = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    if (!target) return false;
    target.setItem(CONTENT_WIDTH_STORAGE_KEY, value);
    return true;
  } catch {
    return false;
  }
}
