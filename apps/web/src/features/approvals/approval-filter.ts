/**
 * The approvals inbox status and kind filters. Pure, with no view code: its own module so the route's
 * `validateSearch` (which stays in the app entry when the route component is
 * split out) does not pull the inbox page into every first visit.
 */
import type { ApprovalKind } from "@orrn/server/lib/permissions";

export type ApprovalStatus = "pending" | "approved" | "rejected";

/** The approval kinds (mirror of `approvalKinds` in @orrn/db/schema/approval; the db package stays out of the web bundle). */
export const APPROVAL_KINDS = [
  "dc_note",
  "cast_close",
  "die_rerank",
  "dispatch_overdraw",
  "phantom_void",
  // FP Wave 1: generic subject until their module adds one.
  "die_owner_override",
  "order_reallocate",
  "press_time",
  "press_reopen",
  "ageing_override",
  // FP Wave 2.
  "press_late_entry",
] as const satisfies readonly ApprovalKind[];

// Compile-time: every server kind is listed (a new kind fails check-types here until it is added).
type MissingKind = Exclude<ApprovalKind, (typeof APPROVAL_KINDS)[number]>;
const everyKindListed: [MissingKind] extends [never] ? true : never = true;
void everyKindListed;

export function isApprovalKind(v: unknown): v is ApprovalKind {
  return typeof v === "string" && (APPROVAL_KINDS as readonly string[]).includes(v);
}

export const APPROVAL_FILTERS = ["pending", "approved", "rejected"] as const;
export function isApprovalStatus(v: unknown): v is ApprovalStatus {
  return typeof v === "string" && (APPROVAL_FILTERS as readonly string[]).includes(v);
}
