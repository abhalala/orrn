import { toDate, type DateInput } from "./format";

/** Where "Stop impersonating" lands: back on that company's Access tab in Godseye. */
export function accessTabPath(companyId: string): string {
  return `/admin/companies/${encodeURIComponent(companyId)}?tab=access`;
}

const ENDS_SOON_MS = 5 * 60_000;

/** True in the last five minutes of a support session (the banner says so). */
export function impersonationEndsSoon(expiresAt: DateInput, now: Date = new Date()): boolean {
  return toDate(expiresAt).getTime() - now.getTime() <= ENDS_SOON_MS;
}
