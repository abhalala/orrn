import { DISPATCH_STATUSES, type DispatchStatus } from "@orrn/domain";

/** The four list tabs, in order: Building, Held, Dispatched, Cancelled. Each is one server status. */
export const DISPATCH_TABS = ["draft", "reserved", "completed", "cancelled"] as const satisfies readonly DispatchStatus[];

export type DispatchTab = (typeof DISPATCH_TABS)[number];

/** Building unless the value is one of the four statuses. */
export function dispatchTab(value: string | undefined | null): DispatchTab {
  return (DISPATCH_STATUSES as readonly string[]).includes(value ?? "") ? (value as DispatchTab) : "draft";
}
