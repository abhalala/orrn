import type { BundleStatus, DispatchStatus } from "@orrn/domain";
import type { Translate } from "@orrn/i18n";

/**
 * Why a bundle listed on a dispatch stops its next step: Hold stock while
 * Building (every bundle must still be in stock), Dispatch while Held (every
 * bundle must be held by this dispatch). A bundle can sit on two drafts until
 * one of them holds it; the server names the other dispatch (`heldBy`).
 */
export type ItemBlock =
  | { kind: "heldElsewhere"; code: string | null }
  | { kind: "dispatched" }
  | { kind: "void" }
  | { kind: "notHeld" };

type Blockable = { status: BundleStatus; heldBy?: string | null };

export function itemBlock(item: Blockable, dispatchStatus: DispatchStatus): ItemBlock | null {
  if (dispatchStatus !== "draft" && dispatchStatus !== "reserved") return null;
  switch (item.status) {
    case "dispatched":
      return { kind: "dispatched" };
    case "void":
      return { kind: "void" };
    case "reserved":
      if (item.heldBy) return { kind: "heldElsewhere", code: item.heldBy };
      // A Building dispatch holds nothing, so a held bundle is someone else's.
      return dispatchStatus === "draft" ? { kind: "heldElsewhere", code: null } : null;
    case "available":
      return dispatchStatus === "reserved" ? { kind: "notHeld" } : null;
  }
}

export function blockedCount(items: readonly Blockable[], dispatchStatus: DispatchStatus): number {
  let n = 0;
  for (const it of items) if (itemBlock(it, dispatchStatus)) n += 1;
  return n;
}

/** Marked bundles first (they need a decision), the rest in the order given. */
export function sortBlockedFirst<T extends Blockable>(items: readonly T[], dispatchStatus: DispatchStatus): T[] {
  const marked: T[] = [];
  const rest: T[] = [];
  for (const it of items) (itemBlock(it, dispatchStatus) ? marked : rest).push(it);
  return [...marked, ...rest];
}

/** The row's mark in the reader's language (the scan sheet's words for the same reasons). */
export function blockText(t: Translate, block: ItemBlock): string {
  switch (block.kind) {
    case "heldElsewhere":
      return block.code ? t("scan.continuous.heldBy", { code: block.code }) : t("scan.continuous.heldElsewhere");
    case "dispatched":
      return t("scan.continuous.dispatched");
    case "void":
      return t("status.bundle.void");
    case "notHeld":
      return t("dispatch.build.notHeld");
  }
}
