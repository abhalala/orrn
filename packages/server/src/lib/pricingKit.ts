/** XE-PRICE: small helpers shared by `routers/pricing.ts` and `routers/pricingDocs.ts`. */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";

import { mapInChunks, type OrrnDb } from "./atomic";
import { assertModule } from "./moduleGate";

export const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-22")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
  }, "Not a real date");

export const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};
export const notFound = (): never => {
  throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
};
export const MASTER_NOT_READY = "Set the base metal rate and the plant conversion first";

/** Reads are not gated by the router-level module check; every pricing read calls this. */
export async function pricingOn(ctx: { db: OrrnDb; companyId: string }) {
  await assertModule(ctx, "pricing");
}

/** Section series (its group for conversion), code, name and commercial alloy / temper. */
export async function sectionInfo(db: OrrnDb, companyId: string, ids: readonly string[]) {
  const found = await mapInChunks([...new Set(ids)], (part) =>
    db
      .select({ id: die.id, series: die.series, code: die.sectionCode, name: die.name, alloy: die.alloy, temper: die.temper })
      .from(die)
      .where(and(eq(die.companyId, companyId), inArray(die.id, part), isNull(die.deletedAt))),
  );
  return new Map(found.map((d) => [d.id, d] as const));
}
