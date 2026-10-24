import { eq } from "drizzle-orm";

import { company } from "@orrn/db/schema/tenant";

import type { OrrnDb } from "./atomic";
import { now } from "./clock";
import { productionDayWindow, type ProductionDayWindow } from "./dayWindow";

/**
 * `productionDayWindow` for a company, read fresh (FP-PF-05: a shift change applies from the next
 * read). `at` defaults to the server clock (`lib/clock`, pinnable in tests).
 */
export async function productionDayWindowFor(db: OrrnDb, companyId: string, at: Date = now()): Promise<ProductionDayWindow> {
  const row = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).get();
  return productionDayWindow(row?.settings ?? {}, at.getTime());
}
