/**
 * Pure helpers for sharing a drawing from the phone (FP-DR-20). The phone makes the default link (7
 * days, the server's default) and hands it to the system share sheet; the list and revoke are on the web.
 */

/** Days the phone's link stays open (the server default; the server allows 1 to 30). */
export const SHARE_DAYS = 7;

/** The text handed to the system share sheet: one line, no stray whitespace. */
export function shareMessage(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Who may share from the card: the die room (die.card) or masters holders (masters.publish). */
export function canShareDrawing(
  allowed: (action: "die.card" | "masters.publish") => boolean,
  section: { hasDrawing: boolean } | null,
): boolean {
  return Boolean(section?.hasDrawing) && (allowed("die.card") || allowed("masters.publish"));
}
