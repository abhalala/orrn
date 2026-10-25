import type { Translate } from "@orrn/i18n";

import { writeFailureKind } from "@/lib/request-timeout";
import { saveErrorText } from "@/lib/save-error";

import { refusalText } from "./copy-model";

/**
 * What to tell the die room when a write did not go through. An answer that never came ("unsure")
 * may have saved, so the text says to check the card first (T28 rule). A refusal from the server is
 * already a plain sentence naming the copy and passes through.
 */
export function dieErrorText(t: Translate, error: unknown): string {
  if (writeFailureKind(error) === "unsure") return saveErrorText(t, error).body;
  return refusalText(error, { forbidden: t("errors.forbidden"), generic: t("errors.generic"), network: t("errors.network") });
}
