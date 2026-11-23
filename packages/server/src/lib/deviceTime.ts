import { eq } from "drizzle-orm";

import type { OrrnDb } from "@orrn/db";
import { company } from "@orrn/db/schema/tenant";

import { companyTimezone, zonedOffsetMs } from "./dayWindow";

/** The plant's UTC offset now, in minutes (IST = 330): a device CSV time with no offset is plant time. */
export async function companyTimezoneOffsetMin(db: OrrnDb, companyId: string, nowMs: number = Date.now()): Promise<number> {
  const row = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).get();
  return Math.round(zonedOffsetMs(companyTimezone((row?.settings as Record<string, unknown> | null) ?? {}), nowMs) / 60_000);
}
