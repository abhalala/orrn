import { companySequence } from "@orrn/db/schema";
import { sql } from "drizzle-orm";

import type { Context } from "../context";

/**
 * Allocate the next per-company sequence number with one atomic upsert-and-return statement, so
 * concurrent callers can never observe the same value (audit S8).
 */
export async function nextCompanySeq(ctx: Pick<Context, "db">, companyId: string) {
  const [row] = await ctx.db
    .insert(companySequence)
    .values({ companyId, value: 1 })
    .onConflictDoUpdate({
      target: companySequence.companyId,
      set: { value: sql`${companySequence.value} + 1` },
    })
    .returning({ value: companySequence.value });

  if (!row) {
    throw new Error("Unable to allocate company sequence");
  }

  return row.value;
}
