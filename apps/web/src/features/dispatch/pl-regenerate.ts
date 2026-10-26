/**
 * Whether the packing list on screen can be regenerated, and the number the new revision gets (review
 * m-5). Only the current revision (`packingList.revisions.currentId`) that is not folded into a
 * combined list can; an older revision opened by id cannot, and the next number follows the newest
 * revision, not the one on screen. The server refuses the rest too.
 */
export function regenerateState(
  list: { id: string; revision: number; combinedIntoId: string | null },
  revisions: { currentId: string | null; revisions: readonly { revision: number }[] } | undefined,
): { enabled: boolean; next: number } {
  const newest = Math.max(list.revision, ...(revisions?.revisions ?? []).map((r) => r.revision));
  const enabled = Boolean(revisions) && revisions!.currentId === list.id && !list.combinedIntoId;
  return { enabled, next: newest + 1 };
}
