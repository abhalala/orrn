/**
 * Order line entry maths on the server (FP-OP-02/03/04; specs §E2 "Arithmetic", C21, C23). The
 * client sends what the clerk typed (pieces OR kg, a copy or a tier, a basis choice); the server
 * picks the weight basis, snapshots it and computes the other side. Pure maths: `@orrn/domain`
 * (`orderGrams`, `orderPieces`, `suggestFirstCopy`, `readFloorSettings`).
 *
 * Basis (Q-OP-1): `copy_current` = the latest reading of the pinned copy, else of the copy the die
 * room would pick first (`suggestFirstCopy`); with no reading it falls back to `band_start`
 * (`die.weight_min_g`) and says so in `basis_note`. `band_start` on request.
 */
import {
  orderGrams,
  orderPieces,
  readFloorSettings,
  suggestFirstCopy,
  type FloorSettings,
  type LengthUnit,
  type QtyBasis,
  type WeightBasis,
} from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { die } from "@orrn/db/schema/catalog";
import { dieBand, dieInstance } from "@orrn/db/schema/dies";
import { company } from "@orrn/db/schema/tenant";

import type { OrrnDb } from "./atomic";
import { companyTimezone } from "./dayWindow";

export const NO_READING_NOTE = "No weight reading on the copy yet; band start used";

export type CompanyFloor = {
  settings: Record<string, unknown>;
  floor: FloorSettings;
  unit: LengthUnit;
  timezone: string;
};

export async function companyFloor(db: OrrnDb, companyId: string): Promise<CompanyFloor> {
  const [row] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  return {
    settings,
    floor: readFloorSettings(settings),
    unit: settings.lengthUnit === "inch" ? "inch" : "mm",
    timezone: companyTimezone(settings),
  };
}

export type SectionInfo = {
  id: string;
  sectionCode: string;
  weightMinG: number;
  weightMaxG: number;
  alloy: string | null;
  temper: string | null;
  ownerCustomerId: string | null;
};

export async function loadSection(db: OrrnDb, companyId: string, sectionId: string): Promise<SectionInfo> {
  const [row] = await db
    .select({
      id: die.id,
      sectionCode: die.sectionCode,
      weightMinG: die.weightMinG,
      weightMaxG: die.weightMaxG,
      alloy: die.alloy,
      temper: die.temper,
      ownerCustomerId: die.ownerCustomerId,
    })
    .from(die)
    .where(and(eq(die.id, sectionId), eq(die.companyId, companyId), isNull(die.deletedAt)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Section not found" });
  return row;
}

export type CopyInfo = {
  id: string;
  code: string;
  seqNo: number;
  status: string;
  tierRank: number | null;
  latestMilli: number | null;
  readingId: string | null;
  bandMinG: number;
  bandMaxG: number;
};

/** Copies of a section (retired left out) with their latest reading and effective band. */
export async function sectionCopies(db: OrrnDb, companyId: string, section: SectionInfo): Promise<CopyInfo[]> {
  const latest = (col: "id" | "kg_per_12ft_milli") =>
    sql`(select r.${sql.raw(col)} from die_weight_reading r where r.company_id = ${dieInstance.companyId} and r.die_instance_id = ${dieInstance.id} order by r.read_at desc, r.id desc limit 1)`;
  const rows = await db
    .select({
      id: dieInstance.id,
      code: dieInstance.code,
      seqNo: dieInstance.seqNo,
      status: dieInstance.status,
      tierRank: dieInstance.tierRank,
      latestMilli: sql<number | null>`${latest("kg_per_12ft_milli")}`,
      readingId: sql<string | null>`${latest("id")}`,
      bandMinG: dieBand.weightMinG,
      bandMaxG: dieBand.weightMaxG,
    })
    .from(dieInstance)
    .leftJoin(dieBand, and(eq(dieBand.id, dieInstance.bandId), eq(dieBand.companyId, dieInstance.companyId)))
    .where(
      and(
        eq(dieInstance.companyId, companyId),
        eq(dieInstance.sectionId, section.id),
        sql`${dieInstance.status} <> 'retired'`,
      ),
    )
    .orderBy(asc(dieInstance.seqNo));
  return rows.map((r) => ({
    ...r,
    latestMilli: r.latestMilli == null ? null : Number(r.latestMilli),
    bandMinG: r.bandMinG ?? section.weightMinG,
    bandMaxG: r.bandMaxG ?? section.weightMaxG,
  }));
}

export type BasisChoice = {
  weightBasis: WeightBasis;
  /** The locked kg/12ft × 1000 every line figure is computed with. */
  basisMilli: number;
  bandStartMilli: number;
  copyMilli: number | null;
  readingId: string | null;
  basisNote: string | null;
  /** The copy whose reading was used or that would be picked first (a hint, never a pin). */
  copyId: string | null;
  copyCode: string | null;
};

/** Pick the weight basis for a line (Q-OP-1). `pinnedCopyId` must already belong to the section. */
export function chooseBasis(
  section: SectionInfo,
  copies: readonly CopyInfo[],
  input: { pinnedCopyId?: string | null; weightBasis?: WeightBasis | null },
): BasisChoice {
  const pinned = input.pinnedCopyId ? (copies.find((c) => c.id === input.pinnedCopyId) ?? null) : null;
  const copy = pinned ?? suggestFirstCopy(copies.filter((c) => c.latestMilli != null)) ?? suggestFirstCopy(copies);
  const bandStartMilli = section.weightMinG;
  const band = {
    weightBasis: "band_start" as const,
    basisMilli: bandStartMilli,
    bandStartMilli,
    copyMilli: copy?.latestMilli ?? null,
    readingId: copy?.readingId ?? null,
    copyId: copy?.id ?? null,
    copyCode: copy?.code ?? null,
  };
  if (input.weightBasis === "band_start") return { ...band, basisNote: null };
  if (copy && copy.latestMilli != null && copy.latestMilli > 0) {
    return {
      weightBasis: "copy_current",
      basisMilli: copy.latestMilli,
      bandStartMilli,
      copyMilli: copy.latestMilli,
      readingId: copy.readingId,
      basisNote: null,
      copyId: copy.id,
      copyCode: copy.code,
    };
  }
  return { ...band, basisNote: NO_READING_NOTE };
}

export type LineQty = { qtyBasis: QtyBasis; pcs: number; kgG: number; impliedG: number };

/**
 * The other side of the line from the side the clerk committed (FP-OP-03): pieces → kg is
 * `orderGrams`; kg → pieces is `orderPieces`, and `impliedG` is what those pieces weigh.
 */
export function lineQty(
  input: { qtyBasis: QtyBasis; pcs?: number | null; kgG?: number | null; cutLengthMm: number },
  basisMilli: number,
  unit: LengthUnit,
): LineQty {
  if (input.qtyBasis === "pcs") {
    if (!(input.pcs && input.pcs > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the pieces" });
    const kgG = orderGrams(input.pcs, input.cutLengthMm, basisMilli, unit);
    if (!(kgG > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Weight must be more than 0" });
    return { qtyBasis: "pcs", pcs: input.pcs, kgG, impliedG: kgG };
  }
  if (!(input.kgG && input.kgG > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Weight must be more than 0" });
  const pcs = orderPieces(input.kgG, input.cutLengthMm, basisMilli, unit);
  return { qtyBasis: "kg", pcs, kgG: input.kgG, impliedG: orderGrams(pcs, input.cutLengthMm, basisMilli, unit) };
}

/** Commercial alloy / temper: the line's own, else the die's, else the plant default (FP-DR-14). */
export function alloyTemper(
  input: { alloy?: string | null; temper?: string | null },
  section: Pick<SectionInfo, "alloy" | "temper">,
  floor: Pick<FloorSettings, "defaultAlloy" | "defaultTemper">,
): { alloy: string; temper: string } {
  const pick = (...v: (string | null | undefined)[]) => v.map((x) => x?.trim()).find((x) => x) ?? "";
  return {
    alloy: pick(input.alloy, section.alloy, floor.defaultAlloy),
    temper: pick(input.temper, section.temper, floor.defaultTemper),
  };
}

/** What an order screen (or the portal) sends for one line; every field past the PL-8 set is optional. */
export type LineEntry = {
  sectionId: string;
  cutLengthMm: number;
  kgPer12ftMilli?: number | null;
  pcs?: number | null;
  kgG?: number | null;
  dieInstanceId?: string | null;
  tierRank?: number | null;
  qtyBasis?: QtyBasis;
  weightBasis?: WeightBasis;
  alloy?: string | null;
  temper?: string | null;
  ratePaise?: number | null;
};

/** The stored values of a line, computed on the server. `undefined` = leave the column as it is. */
export type ResolvedLine = {
  kgG: number;
  pcs: number | null;
  kgPer12ftMilli: number | null;
  alloy: string;
  temper: string;
  dieInstanceId?: string | null;
  tierRank?: number | null;
  qtyBasis?: QtyBasis | null;
  impliedG?: number | null;
  weightBasis?: WeightBasis | null;
  bandStartMilli?: number | null;
  copyMilli?: number | null;
  readingId?: string | null;
  basisNote?: string | null;
  ratePaise?: number | null;
};

/**
 * Resolve every line of a save. With `qtyBasis` the line takes the W1 path (server basis and the
 * other side computed); without it the PL-8 figures are stored as typed. A pinned copy must be a
 * live copy of the line's section. A rate needs `priceOnSalesOrder` and `order.price` (C23).
 */
export async function resolveLines(
  db: OrrnDb,
  companyId: string,
  lines: readonly LineEntry[],
  opts: { canPrice: boolean; floor?: CompanyFloor },
): Promise<ResolvedLine[]> {
  const floor = opts.floor ?? (await companyFloor(db, companyId));
  const sections = new Map<string, SectionInfo>();
  const copies = new Map<string, CopyInfo[]>();
  const out: ResolvedLine[] = [];
  for (const [i, l] of lines.entries()) {
    const n = i + 1;
    let section = sections.get(l.sectionId);
    if (!section) {
      section = await loadSection(db, companyId, l.sectionId);
      sections.set(l.sectionId, section);
    }
    const needCopies = Boolean(l.dieInstanceId) || Boolean(l.qtyBasis);
    let list = copies.get(l.sectionId);
    if (needCopies && !list) {
      list = await sectionCopies(db, companyId, section);
      copies.set(l.sectionId, list);
    }
    if (l.dieInstanceId && !list!.some((c) => c.id === l.dieInstanceId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Line ${n}: that copy is not a live copy of ${section.sectionCode}` });
    }
    if (l.ratePaise != null) {
      if (!floor.floor.priceOnSalesOrder) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Rates on sales orders are turned off for this plant" });
      }
      if (!opts.canPrice) throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to set rates" });
    }
    const { alloy, temper } = alloyTemper(l, section, floor.floor);
    const common = {
      alloy,
      temper,
      ...(l.dieInstanceId !== undefined ? { dieInstanceId: l.dieInstanceId } : {}),
      ...(l.tierRank !== undefined ? { tierRank: l.tierRank } : {}),
      ...(l.ratePaise !== undefined ? { ratePaise: l.ratePaise } : {}),
    };
    if (!l.qtyBasis) {
      if (!(l.kgG && l.kgG > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Weight must be more than 0" });
      out.push({ ...common, kgG: l.kgG, pcs: l.pcs ?? null, kgPer12ftMilli: l.kgPer12ftMilli ?? null });
      continue;
    }
    const basis = chooseBasis(section, list!, { pinnedCopyId: l.dieInstanceId, weightBasis: l.weightBasis });
    const qty = lineQty({ qtyBasis: l.qtyBasis, pcs: l.pcs, kgG: l.kgG, cutLengthMm: l.cutLengthMm }, basis.basisMilli, floor.unit);
    out.push({
      ...common,
      kgG: qty.kgG,
      pcs: qty.pcs,
      kgPer12ftMilli: basis.basisMilli,
      qtyBasis: qty.qtyBasis,
      impliedG: qty.impliedG,
      weightBasis: basis.weightBasis,
      bandStartMilli: basis.bandStartMilli,
      copyMilli: basis.copyMilli,
      readingId: basis.readingId,
      basisNote: basis.basisNote,
    });
  }
  return out;
}
