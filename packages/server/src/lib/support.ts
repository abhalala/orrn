import type { SupportRequestStatus } from "@orrn/db/schema/platform";

/**
 * Support request states (FP-PF-14; platform spec §6 Support request):
 *   Open -> Answered (staff replies) -> Closed (staff closes);  Open -> Closed (closed without a reply)
 * A closed request is final; a new question is a new request. Returns null when not allowed.
 */
export function supportNext(
  status: SupportRequestStatus,
  event: { reply: boolean; close: boolean },
): SupportRequestStatus | null {
  if (!event.reply && !event.close) return null;
  if (status === "closed") return null;
  if (event.reply && status !== "open") return null;
  return event.close ? "closed" : "answered";
}
