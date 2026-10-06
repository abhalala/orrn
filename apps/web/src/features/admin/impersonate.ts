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

/**
 * What the banner does after "Stop impersonating" failed (`code` is the tRPC
 * error code, null when the server never answered). When the server says the
 * grant is not there or not yours, there is nothing left to stop: leave. A
 * network or server fault may have left the grant live: stay, say so and let
 * them try again; a second failure leaves anyway (the grant still ends at its
 * time, and the company's Access tab can stop it).
 */
export function afterStopFailure(code: string | null, failures: number): "leave" | "retry" {
  if (code === "NOT_FOUND" || code === "FORBIDDEN") return "leave";
  return failures >= 2 ? "leave" : "retry";
}
