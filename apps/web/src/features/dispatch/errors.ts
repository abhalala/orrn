import type { Translate } from "@orrn/i18n";

type TrpcLike = { message?: unknown; data?: { code?: unknown } | null };

/**
 * What to tell someone when a dispatch action failed: what happened and how
 * to fix it, in their language. The server's English messages are only read
 * to tell an empty dispatch from one that moved on.
 */
export function dispatchErrorText(t: Translate, error: unknown): string {
  const e = (error && typeof error === "object" ? error : {}) as TrpcLike;
  const code = e.data?.code;
  const message = typeof e.message === "string" ? e.message : "";
  switch (code) {
    case "FORBIDDEN":
      return t("errors.forbidden");
    case "UNAUTHORIZED":
      return t("errors.sessionExpired");
    case "NOT_FOUND":
      return t("errors.notFoundInCompany");
    case "CONFLICT":
      return t("dispatch.errors.conflict");
    case "BAD_REQUEST":
      return /empty/i.test(message) ? t("dispatch.errors.empty") : t("dispatch.errors.moved");
    case undefined:
      return t("errors.network");
    default:
      return t("errors.generic");
  }
}
