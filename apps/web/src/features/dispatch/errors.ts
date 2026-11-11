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
      // Arch 52: the late time and reason are checked on the sheet first; these are the server's own refusals.
      if (/in the future/i.test(message)) return t("dispatch.late.future");
      if (/at most 72 hours/i.test(message)) return t("dispatch.late.tooOld");
      // Review 7: approved for another load, and too late to ask again.
      if (/bundles changed after a manager approved/i.test(message)) return t("dispatch.late.loadChangedOld");
      if (/reason the packing list is entered late/i.test(message)) return t("dispatch.late.noReason");
      if (/needs the time the truck left/i.test(message)) return t("dispatch.late.noTime");
      return /empty/i.test(message) ? t("dispatch.errors.empty") : t("dispatch.errors.moved");
    case "PRECONDITION_FAILED":
      // Q36 decided: off-band rows refused at Complete (rejected rows named first, they need someone to act).
      if (/rejected for the order line/i.test(message)) return t("dispatch.errors.offBandRejected");
      if (/off the order line/i.test(message)) return t("dispatch.errors.offBand");
      // Review Focus 5 / pl-flow 61: over ordered + tolerance; the request (and the note) went to a manager.
      if (/^Over the order balance/i.test(message)) return t("dispatch.errors.overdraw");
      // BACKLOG 70: no vehicle number (the sheet asks first; this is a header cleared meanwhile).
      if (/^No vehicle number/i.test(message)) return t("dispatch.vehicleMissing");
      // Arch 52: a late packing list waits for a second person to approve the time.
      if (/^Entered late/i.test(message)) return t("dispatch.errors.lateEntry");
      return actionErrorText(t, error);
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
