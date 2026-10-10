export function settleSubmittedDraft(
  current: Record<string, string>,
  draftKey: string,
  submittedText: string,
  selectedChatId: string | null,
): Record<string, string> {
  const nextDraft = current[draftKey] === submittedText ? "" : (current[draftKey] ?? "");
  if (!selectedChatId) return { ...current, [draftKey]: nextDraft };
  if (current[selectedChatId]) return { ...current, __new__: nextDraft };
  return { ...current, __new__: "", [selectedChatId]: nextDraft };
}
