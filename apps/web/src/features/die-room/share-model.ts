/**
 * Pure helpers for the die share link screens (FP-DR-20): the days a link stays open, where a link
 * stands, the full URL of a path, and what a refused public read means. No server figure is
 * computed here.
 */

/** Days a link can stay open, in the order the sheet offers them (server: 1 to 30, default 7). */
export const SHARE_DAY_CHOICES = [1, 3, 7, 14, 30] as const;
export const DEFAULT_SHARE_DAYS = 7;
export type ShareDays = (typeof SHARE_DAY_CHOICES)[number];

export type ShareStatus = "active" | "expired" | "revoked";

/** Only an open link can be revoked from the list; an expired one is already closed. */
export function canRevokeShare(status: ShareStatus): boolean {
  return status === "active";
}

export function shareStatusTone(status: ShareStatus): "green" | "neutral" | "red" {
  return status === "active" ? "green" : status === "revoked" ? "red" : "neutral";
}

/** The link a person copies: the page's origin plus the path the server made. */
export function shareLink(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/** A section label for the sheet title: "Domal 12170". */
export function sectionLabel(s: { series: string; sectionCode: string }): string {
  return [s.series, s.sectionCode].filter(Boolean).join(" ");
}

/** What the public page does with a refused read: the neutral "gone" page, a wait, or a retry. */
export type ShareFailure = "gone" | "busy" | "error";

export function shareFailure(error: unknown): ShareFailure {
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
  if (code === "NOT_FOUND" || code === "BAD_REQUEST") return "gone";
  if (code === "TOO_MANY_REQUESTS") return "busy";
  return "error";
}

/** Grams per 12 ft as kg text ("5.900"). */
export function kgText(grams: number): string {
  return (grams / 1000).toFixed(3);
}

/** Wall in tenths of a mm as "1.2"; null when the section has none. */
export function wallText(tenthMm: number | null | undefined): string | null {
  return tenthMm == null || tenthMm <= 0 ? null : (tenthMm / 10).toFixed(1);
}

/** "Opened 3 times" / "Opened once" / "Not opened yet" as the key and count to say. */
export function openedWords(viewCount: number): { key: "neverOpened" | "openedOnce" | "opened"; n: number } {
  return viewCount <= 0 ? { key: "neverOpened", n: 0 } : viewCount === 1 ? { key: "openedOnce", n: 1 } : { key: "opened", n: viewCount };
}
