import { formatKg, gToKg, type Fmt } from "@orrn/domain";
import type { Locale, MessageKey } from "@orrn/i18n";

import { rejectionMessage, type ScanMessage } from "@/features/scan/scan-outcome";
import { bandEndText } from "@/shared/lib/fmt-text";

/** Plant default when the company has no timezone set (dashboard.today uses the same). */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** A die's band (grams per 12 ft) as `2.40-2.60` kg, or null when the die has none. */
export function formatKgBand(minG: number, maxG: number, fmt?: Fmt): string | null {
  if (!(maxG > 0)) return null;
  const lo = fmt ? bandEndText(fmt, minG) : formatKg(gToKg(minG));
  const hi = fmt ? bandEndText(fmt, maxG) : formatKg(gToKg(maxG));
  return lo === hi ? lo : `${lo}-${hi}`;
}

type TrpcLike = { message?: unknown; data?: { code?: unknown } | null };

/** What to tell someone whose Reprint failed. Server messages are English and technical, so they are mapped. */
export function reprintErrorKey(error: unknown): MessageKey {
  const e = (error && typeof error === "object" ? error : {}) as TrpcLike;
  const code = e.data?.code;
  const message = typeof e.message === "string" ? e.message : "";
  if (code === "FORBIDDEN") return "stock.noPermission";
  if (/printer profile|template is not pushed|spool deployment/i.test(message)) return "stock.reprintNoPrinter";
  return "stock.reprintFailed";
}

/**
 * What to tell someone whose Void or Restore was refused. A refusal means the
 * bundle changed since the page loaded (held, dispatched, or already voided by
 * someone else); the server's words are English, so only its hold and dispatch
 * reasons are reused (as scan wording), the rest become one plain sentence.
 */
export function transitionError(error: unknown): ScanMessage & { key: MessageKey } {
  const e = (error && typeof error === "object" ? error : {}) as TrpcLike;
  const code = e.data?.code;
  const message = typeof e.message === "string" ? e.message : "";
  if (code === "FORBIDDEN") return { key: "stock.noPermission" };
  if (code !== "BAD_REQUEST") return { key: "bundle.transitionFailed" };
  if (/^Bundle is (held by|already dispatched)/i.test(message)) {
    const mapped = rejectionMessage(message);
    if ("key" in mapped) return mapped;
  }
  return { key: "bundle.changedElsewhere" };
}
