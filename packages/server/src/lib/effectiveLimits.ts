import { eq } from "drizzle-orm";

import { company } from "@orrn/db/schema/tenant";

import type { OrrnDb } from "./atomic";
import { resolveLimits, type PlantLimits } from "./plantLimits";

/**
 * The plant's limits as every handler must use them (limits brief, section A): the defaults merged with
 * `company.settings.limits`, each clamped to its ceiling. Read from the row on each call and never cached
 * at module scope (an isolate serves many plants), so a staff change applies on the next request.
 * An unknown plant reads the defaults.
 */
export async function effectiveLimits(ctx: { db: OrrnDb; companyId: string }): Promise<PlantLimits> {
  const row = await ctx.db.select({ settings: company.settings }).from(company).where(eq(company.id, ctx.companyId)).get();
  return resolveLimits(row?.settings ?? {});
}
