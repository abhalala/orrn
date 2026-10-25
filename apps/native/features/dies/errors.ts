import type { Translate } from "@orrn/i18n";

import { serverRefusal } from "@/lib/server-refusal";

/**
 * What to tell the die room when a write did not go through. An answer that never came ("unsure") may have
 * saved, so the text says to check the card first (T28 rule). A refusal from the server is matched to a sentence
 * in the person's language (`native.refusal.*`); the server's English is never shown or spoken (BACKLOG 29).
 */
export function dieErrorText(t: Translate, error: unknown): string {
  return serverRefusal(error, t);
}
