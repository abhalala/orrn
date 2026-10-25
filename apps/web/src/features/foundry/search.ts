/** URL search of the foundry routes. No imports on purpose (route budget: the route tree stays small). */
export type InboxTab = "waiting" | "arriving" | "handled";
export const INBOX_TABS: readonly InboxTab[] = ["waiting", "arriving", "handled"];

export function parseInboxSearch(raw: Record<string, unknown>): { tab?: Exclude<InboxTab, "waiting"> } {
  return raw.tab === "arriving" || raw.tab === "handled" ? { tab: raw.tab } : {};
}
