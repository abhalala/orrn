import { formatKg, gToKg } from "@orrn/domain";
import type { Locale, MessageKey } from "@orrn/i18n";

/** Plant default when the company has no timezone set (dashboard.today uses the same). */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

function tag(locale: Locale | string): string {
  // Latin digits in both languages: numbers stay Latin script (spec §2 Language).
  return locale === "hi" ? "hi-IN-u-nu-latn" : "en-IN";
}

function validZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

/**
 * `3 Oct, 14:20`, or `31 Dec 2025, 11:30` outside the current year, in the
 * company timezone (spec §2: dates `d MMM` + year if not current, 24h).
 * An unknown zone falls back to the device's.
 */
export function formatWhen(
  at: string | number | Date,
  opts: { locale: Locale | string; timeZone?: string; now?: number },
): string {
  const timeZone = validZone(opts.timeZone);
  const date = new Date(at);
  const yearOf = (d: Date) => new Intl.DateTimeFormat("en", { year: "numeric", timeZone }).format(d);
  const sameYear = yearOf(date) === yearOf(new Date(opts.now ?? Date.now()));
  const day = new Intl.DateTimeFormat(tag(opts.locale), {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone,
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
    date,
  );
  return `${day}, ${time}`;
}

/** A die's band (grams per 12 ft) as `2.40-2.60` kg, or null when the die has none. */
export function formatKgBand(minG: number, maxG: number): string | null {
  if (!(maxG > 0)) return null;
  const lo = formatKg(gToKg(minG));
  const hi = formatKg(gToKg(maxG));
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

export type AddReport = {
  added: string[];
  alreadyInDispatch: string[];
  notFound: string[];
  unavailable: { serial: string; reason: string }[];
};

export type AddOutcome =
  | { kind: "added" }
  | { kind: "already" }
  | { kind: "unavailable"; reason: string }
  | { kind: "notFound" };

/** `dispatch.addBundlesBySerial` report for one bundle. Already in the dispatch is calm (Review Focus 1). */
export function addOutcome(report: AddReport): AddOutcome {
  if (report.added.length > 0) return { kind: "added" };
  if (report.alreadyInDispatch.length > 0) return { kind: "already" };
  const blocked = report.unavailable[0];
  if (blocked) return { kind: "unavailable", reason: blocked.reason };
  return { kind: "notFound" };
}
