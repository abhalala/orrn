/**
 * What plant papers print about the plant itself (XE ADM, cross-lane contract 4). PRICE prints the
 * default bank on the proforma, BILL on the invoice; both read it here, never the table directly.
 */
import { plantBankAccount, plantMaster } from "@orrn/db/schema/admin";
import { dispatch, dispatchItem } from "@orrn/db/schema/dispatch";
import { salesOrderLine } from "@orrn/db/schema/sales";
import { insuranceForPl, readTransitInsurance } from "@orrn/domain";
import { and, eq, inArray } from "drizzle-orm";

import { IN_LIST_CHUNK, type OrrnDb } from "./atomic";

export type PlantBankForPrint = {
  bankName: string;
  branch: string | null;
  accountName: string;
  accountNo: string;
  ifsc: string;
};

/**
 * The plant's default live bank account for a printed paper, or null when none is set (the paper then
 * prints its "bank details not set" line). Scoped by company; never another plant's account.
 */
export async function getPlantBankForPrint(db: OrrnDb, companyId: string): Promise<PlantBankForPrint | null> {
  const [row] = await db
    .select({
      bankName: plantBankAccount.bankName,
      branch: plantBankAccount.branch,
      accountName: plantBankAccount.accountName,
      accountNo: plantBankAccount.accountNo,
      ifsc: plantBankAccount.ifsc,
    })
    .from(plantBankAccount)
    .where(and(eq(plantBankAccount.companyId, companyId), eq(plantBankAccount.isDefault, true), eq(plantBankAccount.active, true)))
    .limit(1);
  return row ?? null;
}

/**
 * What the packing list prints from the ADM masters (rows 21, 76): the mode of packing (the
 * dispatch's own, else the modes of the order lines on it, in name order) and the transit insurance
 * policy when it is set, marked to print and valid on the PL date. Snapshotted, so a later change to
 * a master never rewrites a PL that was sent; `packingList.regenerate` reads them again.
 */
export async function plantPlExtras(
  db: OrrnDb,
  companyId: string,
  dispatchIds: readonly string[],
  plDate: string,
  settings: Record<string, unknown> | null,
): Promise<{ packingMode: string | null; transitInsurance: { policyNo: string; insurer: string; validTo: string | null } | null }> {
  const transitInsurance = insuranceForPl(readTransitInsurance(settings?.transitInsurance), plDate);
  if (dispatchIds.length === 0) return { packingMode: null, transitInsurance };
  const ids = dispatchIds.slice(0, IN_LIST_CHUNK);
  const own = await db
    .selectDistinct({ name: plantMaster.name })
    .from(dispatch)
    .innerJoin(plantMaster, and(eq(plantMaster.id, dispatch.packingModeId), eq(plantMaster.companyId, dispatch.companyId)))
    .where(and(eq(dispatch.companyId, companyId), inArray(dispatch.id, ids)));
  let names = own.map((r) => r.name);
  if (names.length === 0) {
    const fromLines = await db
      .selectDistinct({ name: plantMaster.name })
      .from(dispatchItem)
      .innerJoin(salesOrderLine, and(eq(salesOrderLine.id, dispatchItem.salesOrderLineId), eq(salesOrderLine.companyId, dispatchItem.companyId)))
      .innerJoin(plantMaster, and(eq(plantMaster.id, salesOrderLine.packingModeId), eq(plantMaster.companyId, salesOrderLine.companyId)))
      .where(and(eq(dispatchItem.companyId, companyId), inArray(dispatchItem.dispatchId, ids)));
    names = fromLines.map((r) => r.name);
  }
  names.sort((a, b) => a.localeCompare(b));
  return { packingMode: names.length > 0 ? names.join(", ") : null, transitInsurance };
}
