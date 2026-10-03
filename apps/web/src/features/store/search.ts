/** Search params of the Receive, Issue and Exchange routes: `?item=<store item id>`. */
export function storeEntrySearch(search: Record<string, unknown>): { item?: string } {
  const item = search.item;
  return typeof item === "string" && item.length > 0 && item.length <= 64 ? { item } : {};
}
