import { companySequence } from "@orrn/db/schema";
import { eq, sql } from "drizzle-orm";

import type { Context } from "../context";

export async function nextCompanySeq(ctx: Pick<Context, "db">, companyId: string) {
  await ctx.db
    .insert(companySequence)
    .values({ companyId, value: 1 })
    .onConflictDoUpdate({
      target: companySequence.companyId,
      set: { value: sql`${companySequence.value} + 1` },
    });

  const [row] = await ctx.db
    .select({ value: companySequence.value })
    .from(companySequence)
    .where(eq(companySequence.companyId, companyId))
    .limit(1);

  if (!row) {
    throw new Error("Unable to allocate company sequence");
  }

  return row.value;
}
