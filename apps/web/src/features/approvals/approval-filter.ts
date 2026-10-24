/**
 * The approvals inbox status filter. Its own module so the route's
 * `validateSearch` (which stays in the app entry when the route component is
 * split out) does not pull the inbox page into every first visit.
 */
import type { ApprovalStatus } from "./approval-view";

export const APPROVAL_FILTERS = ["pending", "approved", "rejected"] as const;
export function isApprovalStatus(v: unknown): v is ApprovalStatus {
  return typeof v === "string" && (APPROVAL_FILTERS as readonly string[]).includes(v);
}
