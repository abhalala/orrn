import type { Translate } from "@orrn/i18n";
import { blockersOf, mapSentence, refusalLines } from "@orrn/i18n/refusal";

import { writeFailureKind } from "./request-timeout";
import { saveErrorText } from "./save-error";

/**
 * What a refused die room or orders write says on the phone (BACKLOG 29 and 43). The mapping itself
 * (`SERVER_REFUSALS`, `refusal.*` keys) is shared with the web app and lives in `@orrn/i18n/refusal`;
 * this file adds the phone's own wording for a save that never answered. Re-exported here so the
 * screens and behavioral refusal tests keep one import path. Unknown messages use localized fallbacks.
 */
export { blockersOf, bundleWord, keyOf, mapSentence, orderWord, planWord, SERVER_REFUSALS } from "@orrn/i18n/refusal";
export type { Hit, RefusalEntry } from "@orrn/i18n/refusal";

/** What a refused write says, as one or more lines (a refused confirm lists each thing the order still needs). */
export function serverRefusalLines(error: unknown, t: Translate, blockerText?: (code: string) => string): string[] {
  if (writeFailureKind(error) === "unsure") return [saveErrorText(t, error).body];
  return refusalLines(error, t, (e) => saveErrorText(t, e).body, blockerText);
}

/** One sentence for a refused die room or orders write, in the person's language; never the server's English. */
export function serverRefusal(error: unknown, t: Translate): string {
  return serverRefusalLines(error, t).join(" ");
}
