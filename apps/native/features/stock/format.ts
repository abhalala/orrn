import { formatKg, gToKg } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

import { rejectionMessage, type ScanMessage } from "@/features/scan/outcome";

/** A die's band (grams per 12 ft) as `2.40-2.60` kg, or null when the die has none. */
export function formatKgBand(minG: number, maxG: number): string | null {
  if (!(maxG > 0)) return null;
  const lo = formatKg(gToKg(minG));
  const hi = formatKg(gToKg(maxG));
  return lo === hi ? lo : `${lo}-${hi}`;
}

type TrpcLike = { message?: unknown; data?: { code?: unknown } | null };

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
  if (code === "CONFLICT") return { key: "bundle.changedElsewhere" };
  if (code !== "BAD_REQUEST") return { key: "bundle.transitionFailed" };
  if (/^Bundle is (held by|already dispatched)/i.test(message)) {
    const mapped = rejectionMessage(message);
    if ("key" in mapped) return mapped;
  }
  return { key: "bundle.changedElsewhere" };
}
