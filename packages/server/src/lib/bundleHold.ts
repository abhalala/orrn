import { and, eq, inArray } from "drizzle-orm";

import { dispatch } from "@orrn/db/schema/dispatch";
import type { BundleStatus } from "@orrn/db/schema/inventory";

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
