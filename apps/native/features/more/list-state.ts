export type ListViewState = "loading" | "error" | "empty" | "rows";

export function listViewState(data: { items: readonly unknown[] } | undefined, error: unknown, isError: boolean, offset: number): ListViewState {
  if (data === undefined) return isError ? "error" : "loading";
  if (offset === 0 && data.items.length === 0) return "empty";
  return "rows";
}

export function hasNextOffset(offset: number, pageSize: number, total: number): boolean {
  return offset + pageSize < total;
}

export function hasNextCursor(cursor: string | null | undefined): boolean {
  return typeof cursor === "string" && cursor.length > 0;
}
