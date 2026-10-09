export async function copyText(text: string): Promise<void> {
  if (window.lorca?.copyText) {
    await window.lorca.copyText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}
