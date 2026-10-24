/**
 * Die room helpers shared by the die, band, copy, issue, file and maker procedures (FP-DR).
 * Every derived figure (percent, tone, band position, kg/m) is computed here from stored grams
 * with `@orrn/domain` and never stored.
 */
import {
  bandPosition,
  driftPercentTenths,
  driftTone,
  kgPerMetre,
  readFloorSettings,
  type BandPosition,
  type DriftBands,
  type DriftTone,
} from "@orrn/domain";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dieBand } from "@orrn/db/schema/dies";
import { dieIssue } from "@orrn/db/schema/press";
import { company } from "@orrn/db/schema/tenant";
import { TRPCError } from "@trpc/server";
import { and, eq, getTableColumns, inArray, isNull, sql, type SQL } from "drizzle-orm";

import type { OrrnDb, SqliteBatchItem } from "./atomic";
import { auditInsert } from "./audit";
import type { Context } from "../context";

export type DieRoomCtx = {
  db: OrrnDb;
  companyId: string;
  session: NonNullable<Context["session"]>;
  impersonation?: Context["impersonation"];
};

export function auditCtx(ctx: DieRoomCtx) {
  return { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation };
}

export function audit(ctx: DieRoomCtx, input: Parameters<typeof auditInsert>[1]) {
  return auditInsert(auditCtx(ctx), input);
}

/** Drift colours from `company.settings` (`driftGreenMaxBp` / `driftAmberMaxBp`, defaults 800 / 1000). */
export async function loadDriftBands(db: OrrnDb, companyId: string): Promise<DriftBands> {
  const [row] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  return readFloorSettings((row?.settings ?? {}) as Record<string, unknown>).drift;
}

/** The whole floor settings object (alloy / temper defaults, drift). */
export async function loadFloorSettings(db: OrrnDb, companyId: string) {
  const [row] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  return readFloorSettings((row?.settings ?? {}) as Record<string, unknown>);
}

/** Section wall for the band key: `wall_tenth_mm`, else `thickness_mm x 10` (DR Q8), else 0. */
export function sectionWallTenth(section: { wallTenthMm: number | null; thicknessMm: number | null }): number {
  if (section.wallTenthMm != null) return section.wallTenthMm;
  if (section.thicknessMm != null) return Math.round(section.thicknessMm * 10);
  return 0;
}

export type EffectiveBand = {
  /** Null = the section's primary band (`die.weight_min_g/max_g`). */
  id: string | null;
  wallTenthMm: number;
  weightMinG: number;
  weightMaxG: number;
  label: string | null;
};

export function primaryBand(section: {
  wallTenthMm: number | null;
  thicknessMm: number | null;
  weightMinG: number;
  weightMaxG: number;
}): EffectiveBand {
  return {
    id: null,
    wallTenthMm: sectionWallTenth(section),
    weightMinG: section.weightMinG,
    weightMaxG: section.weightMaxG,
    label: null,
  };
}

/** A copy's band: its active `die_band`, else the primary band. */
export function effectiveBand(
  section: Parameters<typeof primaryBand>[0],
  band: { id: string; wallTenthMm: number; weightMinG: number; weightMaxG: number; label: string | null; active: boolean } | null | undefined,
): EffectiveBand {
  if (band && band.active) {
    return { id: band.id, wallTenthMm: band.wallTenthMm, weightMinG: band.weightMinG, weightMaxG: band.weightMaxG, label: band.label };
  }
  return primaryBand(section);
}

/** "5.900-6.200" (kg per 12 ft, 3 dp) when a band has no label. */
export function bandText(band: Pick<EffectiveBand, "weightMinG" | "weightMaxG" | "label">): string {
  if (band.label) return band.label;
  return `${(band.weightMinG / 1000).toFixed(3)}-${(band.weightMaxG / 1000).toFixed(3)}`;
}

export type CopyFigures = {
  /** Latest reading, grams per 12 ft (= kg/12 ft thousandths). */
  currentMilli: number | null;
  /** Percent drift against the band start, in tenths (+1.1 % = 11). Null without a reading. */
  pctTenth: number | null;
  tone: DriftTone;
  position: BandPosition | null;
  /** kg per metre, 3 dp. Null without a reading. */
  kgPerMetre: number | null;
};

/** Server-computed reading figures for one copy (FP-DR-04/05/06). */
export function copyFigures(latestMilli: number | null | undefined, band: Pick<EffectiveBand, "weightMinG" | "weightMaxG">, bands: DriftBands): CopyFigures {
  const latest = latestMilli ?? null;
  return {
    currentMilli: latest,
    pctTenth: latest == null ? null : driftPercentTenths(latest, band.weightMinG),
    tone: driftTone({ latestMilli: latest, bandStartMilli: band.weightMinG, bands }),
    position: bandPosition(latest, band.weightMinG, band.weightMaxG),
    kgPerMetre: latest == null ? null : kgPerMetre(latest),
  };
}

const TONE_RANK: Record<DriftTone, number> = { none: 0, under: 1, green: 2, amber: 3, red: 4 };

/** The worst tone of a list (red > amber > green > under > none). */
export function worstTone(tones: DriftTone[]): DriftTone {
  let worst: DriftTone = "none";
  for (const t of tones) if (TONE_RANK[t] > TONE_RANK[worst]) worst = t;
  return worst;
}

/**
 * SQL: a copy's latest reading (grams per 12 ft), for a select column over `die_instance`. The
 * outer columns are table-qualified on purpose: drizzle renders a bare column name in a
 * single-table select, which inside this subquery would bind to the reading row instead.
 */
export function latestReadingSql() {
  const I = (c: string) => sql`${sql.identifier("die_instance")}.${sql.identifier(c)}`;
  return sql<number | null>`(
    select r.kg_per_12ft_milli from die_weight_reading r
    where r.die_instance_id = ${I("id")} and r.company_id = ${I("company_id")}
    order by r.read_at desc limit 1
  )`;
}

/** A live (not soft-deleted) customer of this company, or BAD_REQUEST. Returns its name. */
export async function requireLiveCustomer(db: OrrnDb, companyId: string, customerId: string): Promise<string> {
  const [row] = await db
    .select({ name: customer.name })
    .from(customer)
    .where(and(eq(customer.id, customerId), eq(customer.companyId, companyId), isNull(customer.deletedAt)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a customer of this plant" });
  return row.name;
}

/** Names of customers by id (soft-deleted included: a deleted customer still owns its dies). */
export async function customerNames(db: OrrnDb, companyId: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(and(eq(customer.companyId, companyId), inArray(customer.id, unique.slice(0, 90))));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** The section row (live, this company) or NOT_FOUND. */
export async function loadSection(db: OrrnDb, companyId: string, sectionId: string, opts: { includeDeleted?: boolean } = {}) {
  const [row] = await db
    .select()
    .from(die)
    .where(and(eq(die.id, sectionId), eq(die.companyId, companyId), opts.includeDeleted ? undefined : isNull(die.deletedAt)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Section not found" });
  return row;
}

/** An active band of this section, or BAD_REQUEST with `message`. */
export async function requireActiveBand(db: OrrnDb, companyId: string, sectionId: string, bandId: string, message: string) {
  const [row] = await db
    .select()
    .from(dieBand)
    .where(and(eq(dieBand.id, bandId), eq(dieBand.companyId, companyId), eq(dieBand.sectionId, sectionId), eq(dieBand.active, true)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "BAD_REQUEST", message });
  return row;
}

/**
 * A statement that fails the WHOLE batch unless `landed` holds at that point (it inserts a
 * `die_issue` row with a NULL id: NOT NULL violation). D1 rolls the batch back, so the die room's
 * multi-row writes (issue + copy + run; nitriding log + copy + store draws) land together or not
 * at all. Catch with `isDieRoomAbort`.
 */
export function dieRoomAbortUnless(db: OrrnDb, landed: SQL): SqliteBatchItem {
  const nulls = Object.fromEntries(
    Object.entries(getTableColumns(dieIssue)).map(([key, column]) => [key, sql`null`.as(column.name)]),
  );
  const from = db.select({ one: sql`1` }).from(company).limit(1).as("die_room_abort_src");
  return db.insert(dieIssue).select(db.select(nulls).from(from).where(sql`not (${landed})`) as never);
}

export function isDieRoomAbort(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    if ((cur instanceof Error ? cur.message : String(cur)).includes("NOT NULL constraint failed: die_issue.id")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** Error text through the `cause` chain (unique-index names live in the driver's message). */
export function errorText(e: unknown): string {
  let text = "";
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    text += ` ${cur instanceof Error ? cur.message : String(cur)}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  return text;
}
