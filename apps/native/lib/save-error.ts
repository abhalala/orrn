import type { Translate } from "@orrn/i18n";

import { writeFailureKind } from "./request-timeout";

/**
 * What to tell someone whose save did not answer cleanly (T28 rule): an
 * "unsure" save may have gone through, so the text says to check before
 * trying again; a "failed" one says what the server said, in our words.
 */
export function saveErrorText(t: Translate, error: unknown): { kind: "unsure" | "failed"; title: string; body: string } {
  const kind = writeFailureKind(error);
  if (kind === "unsure") return { kind, title: t("native.saveUnsureTitle"), body: t("native.saveUnsureBody") };
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
  const body =
    code === "FORBIDDEN" ? t("errors.forbidden") : code === "UNAUTHORIZED" ? t("errors.sessionExpired") : code === "CONFLICT" ? t("errors.conflict") : t("errors.generic");
  return { kind, title: t("errors.generic"), body };
}
