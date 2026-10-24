import { and, eq, inArray, ne } from "drizzle-orm";

import { dispatch } from "@orrn/db/schema/dispatch";
import { bundle, type BundleStatus } from "@orrn/db/schema/inventory";

import { mapInChunks, type OrrnDb } from "./atomic";

/** Codes of the dispatches holding these bundles, keyed by dispatch id (company scoped, chunked). */
export async function holdingDispatchCodes(
  db: OrrnDb,
  companyId: string,
  bundles: { status: BundleStatus; currentDispatchId: string | null }[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      bundles
        .filter((b) => b.status === "reserved" && b.currentDispatchId)
        .map((b) => b.currentDispatchId as string),
    ),
  ];
  if (ids.length === 0) return new Map();
  const rows = await mapInChunks(ids, (chunkIds) =>
    db
      .select({ id: dispatch.id, code: dispatch.code })
      .from(dispatch)
      .where(and(eq(dispatch.companyId, companyId), inArray(dispatch.id, chunkIds))),
  );
  return new Map(rows.map((r) => [r.id, r.code]));
}

/**
 * For bundles listed on `dispatchId`: the code of ANOTHER dispatch of the same
 * company that holds each one, keyed by bundle id. A bundle can sit on two
 * drafts until one of them holds it; Build marks it so Hold stock is not a
 * guess (T22). Company scoped on both sides, chunked under the D1 limit.
 */
export async function heldElsewhere(
  db: OrrnDb,
  companyId: string,
  dispatchId: string,
  bundleIds: readonly string[],
): Promise<Map<string, string>> {
  if (bundleIds.length === 0) return new Map();
  const rows = await mapInChunks([...new Set(bundleIds)], (ids) =>
    db
      .select({ bundleId: bundle.id, code: dispatch.code })
      .from(bundle)
      .innerJoin(
        dispatch,
        and(eq(dispatch.id, bundle.currentDispatchId), eq(dispatch.companyId, bundle.companyId)),
      )
      .where(
        and(
          eq(bundle.companyId, companyId),
          inArray(bundle.id, ids),
          eq(bundle.status, "reserved"),
          ne(bundle.currentDispatchId, dispatchId),
        ),
      ),
  );
  return new Map(rows.map((r) => [r.bundleId, r.code]));
}

/** Short, user-facing reason a bundle can't be added to a dispatch or changed by hand. */
export function bundleBlockReason(
  b: { status: BundleStatus; currentDispatchId: string | null },
  codes: Map<string, string>,
): string {
  switch (b.status) {
    case "reserved": {
      const code = b.currentDispatchId ? codes.get(b.currentDispatchId) : undefined;
      return code ? `Bundle is held by ${code}` : "Bundle is held by another dispatch";
    }
    case "dispatched":
      return "Bundle is already dispatched";
    case "void":
      return "Bundle is void";
    default:
      return `Bundle is ${b.status}`;
  }
}

/** Why a bundle can't be added, in a form a client can word in its own language. */
export type BundleBlockCode = "held" | "dispatched" | "void" | "status" | "reallocation_pending" | "held_for_order";

/** An available bundle waiting on an `order_reallocate` approval can't go on a dispatch (W1-OP-S r1 m-4). */
export const REALLOCATION_PENDING_BLOCK: Omit<BundleBlock, "status"> = {
  reason: "Bundle is waiting on a reallocation approval",
  code: "reallocation_pending",
  heldBy: null,
};

export type BundleBlock = {
  /** English sentence (`bundleBlockReason`), kept for clients that predate `code`. */
  reason: string;
  code: BundleBlockCode;
  /** The bundle's status when it was refused. */
  status: BundleStatus;
  /** Code of the dispatch holding it (`held` only, when known). */
  heldBy: string | null;
  /** `held_for_order` (FP-OP-17): the order it is held for and that order's customer. */
  orderNumber?: string;
  customerName?: string;
};

/** Structured twin of `bundleBlockReason` for per-serial reports (T22). */
export function bundleBlock(
  b: { status: BundleStatus; currentDispatchId: string | null },
  codes: Map<string, string>,
): BundleBlock {
  const reason = bundleBlockReason(b, codes);
  switch (b.status) {
    case "reserved":
      return {
        reason,
        code: "held",
        status: b.status,
        heldBy: (b.currentDispatchId ? codes.get(b.currentDispatchId) : undefined) ?? null,
      };
    case "dispatched":
      return { reason, code: "dispatched", status: b.status, heldBy: null };
    case "void":
      return { reason, code: "void", status: b.status, heldBy: null };
    default:
      return { reason, code: "status", status: b.status, heldBy: null };
  }
}
