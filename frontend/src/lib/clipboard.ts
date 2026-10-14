/**
 * Copy text to the clipboard. Answers false instead of throwing when the browser refuses
 * (no permission, or an insecure page without a clipboard), so the caller can tell the person
 * to copy it by hand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
