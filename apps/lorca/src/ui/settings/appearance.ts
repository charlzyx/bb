export type Appearance = "light" | "dark";
export const APPEARANCE_STORAGE_KEY = "bb-lorca.appearance";

export function readAppearancePreference(storage?: Pick<Storage, "getItem">): {
  theme: Appearance;
  persistent: boolean;
} {
  try {
    const source =
      storage ??
      (typeof window === "undefined" ? undefined : window.localStorage);
    return {
      theme:
        source?.getItem(APPEARANCE_STORAGE_KEY) === "dark" ? "dark" : "light",
      persistent: Boolean(source),
    };
  } catch {
    return { theme: "light", persistent: false };
  }
}

export function writeAppearancePreference(
  theme: Appearance,
  storage?: Pick<Storage, "setItem">,
): boolean {
  try {
    const target =
      storage ??
      (typeof window === "undefined" ? undefined : window.localStorage);
    if (!target) return false;
    target.setItem(APPEARANCE_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}
