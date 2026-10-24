import type { Translate } from "@orrn/i18n";

type TrpcLike = { message?: unknown; data?: { code?: unknown } | null };

/**
 * What to tell someone when a write failed, for the codes that mean the same
 * on every screen: in their language, never the server's English (a zod
 * failure arrives as JSON text).
 */
export function actionErrorText(t: Translate, error: unknown): string {
  const e = (error && typeof error === "object" ? error : {}) as TrpcLike;
  switch (e.data?.code) {
    case "FORBIDDEN":
      return t("errors.forbidden");
    case "UNAUTHORIZED":
      return t("errors.sessionExpired");
    case "NOT_FOUND":
      return t("errors.notFoundInCompany");
    case "CONFLICT":
      return t("errors.conflict");
    case undefined:
      return t("errors.network");
    default:
      return t("errors.generic");
  }
}

/**
 * What to tell someone when a dispatch action failed: what happened and how
 * to fix it, in their language. The server's English messages are only read
 * to tell an empty dispatch from one that moved on. A CONFLICT is a bundle
 * that can't be held or sent (Build marks those rows after the refresh).
 */
export function dispatchErrorText(t: Translate, error: unknown): string {
  const e = (error && typeof error === "object" ? error : {}) as TrpcLike;
  const message = typeof e.message === "string" ? e.message : "";
  switch (e.data?.code) {
    case "CONFLICT":
      return t("dispatch.errors.conflict");
    case "BAD_REQUEST":
      return /empty/i.test(message) ? t("dispatch.errors.empty") : t("dispatch.errors.moved");
    default:
      return actionErrorText(t, error);
  }
}

/** The server refused because the data changed first (a second "Make packing list", a bundle taken). */
export function isConflict(error: unknown): boolean {
  return (error as TrpcLike | null)?.data?.code === "CONFLICT";
}

/**
 * Whether a read failed before it ever loaded. React Query v5 keeps `data`
 * after a failed refetch (a poll, a refocus) and still sets `isError`; the
 * screen keeps showing what it had instead of an error panel.
 */
export function failedFirstLoad(query: { isError: boolean; data: unknown }): boolean {
  return query.isError && query.data === undefined;
}
