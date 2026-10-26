import type { Translate } from "@orrn/i18n";
import { blockersOf, mapSentence, refusalLines, SERVER_REFUSALS } from "@orrn/i18n/refusal";

import { actionErrorText } from "@/features/dispatch/errors";

/**
 * What a refused die room, orders or approval write says in the browser (BACKLOG 43, 48). The server's
 * refusals are plain English sentences; a Hindi or Gujarati screen must not show them. The table and the
 * `refusal.*` keys are shared with the phone (`@orrn/i18n/refusal`); a sentence this build does not know
 * shows the corresponding generic error in the person's language, never the server's words.
 */
export { blockersOf, mapSentence, SERVER_REFUSALS };

/** The lines to show for a refused write (a refused confirm lists each thing the order still needs). */
export function serverRefusalLines(t: Translate, error: unknown, blockerText?: (code: string) => string): string[] {
  return refusalLines(error, t, (e) => actionErrorText(t, e), blockerText);
}

/** One sentence for a refused write, in the person's language. */
export function serverRefusal(t: Translate, error: unknown): string {
  return serverRefusalLines(t, error).join(" ");
}
