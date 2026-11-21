/**
 * Names for the ids a draft card shows (delta round decision 5; review S4, security D-M2). Reads only, and only this
 * plant's rows: an id of another plant, or of no row, gets no name, so an irreversible draft on it cannot be
 * confirmed (`draftView.ts` sets `confirmBlock`). People (operator, supervisor, relief) resolve through this plant's
 * membership, never the user table alone.
 *
 * Names are keyed `<entity>:<id>`, so an id of one kind sent where another kind is expected finds no name.
 */
import {
  ageingBatch,
  ageingOven,
  ageingRecipe,
  ageingRow,
  alloy,
  approval,
  bundle,
  cast,
  countSeen,
  countSession,
  customer,
  dcNote,
  die,
  dieBand,
  dieFile,
  dieInstance,
  dieIssue,
  dieMaker,
  dieMakerJob,
  dieShare,
  dispatch,
  dispatchItem,
  furnace,
  location,
  melt,
  membership,
  packingList,
  pressAlert,
  pressDowntime,
  pressLine,
  pressPlan,
  pressPlanDie,
  pressPlanLine,
  pressRun,
  purchaseLot,
  reasonCode,
  returnStream,
  salesOrder,
  salesOrderLine,
  scrapGrade,
  scrapItem,
  spectroInbox,
  spectroResult,
  storeItem,
  storeTxn,
  transporter,
  trolley,
  user,
  vendor,
  vendorAlias,
} from "@orrn/db/schema";
import { ingestArtifact, ingestBlock, ingestCandidate } from "@orrn/db/schema/ingest";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import type { Context } from "../../context";
import { mapInChunks } from "../atomic";
import type { DraftNames } from "./draftView";
import { isIdList, nameKey, refEntity, type RefEntity } from "./draftRefs";

type Ctx = Pick<Context, "db"> & { companyId: string };
type Found = { id: string; name: string | null };
type Resolver = (ctx: Ctx, ids: string[]) => Promise<Found[]>;

/** A table with `id` and `company_id`, named by one SQL expression (null when it has no name). */
function simple(table: SQLiteTable & { id: SQLiteColumn; companyId: SQLiteColumn }, name: SQL): Resolver {
  return (ctx, ids) =>
    mapInChunks(ids, (part) =>
      ctx.db
        .select({ id: sql<string>`${table.id}`, name: sql<string | null>`${name}` })
        .from(table)
        .where(and(eq(table.companyId, ctx.companyId), inArray(table.id, part))),
    );
}

const nz = (c: SQLiteColumn) => sql`nullif(trim(${c}), '')`;
const either = (a: SQLiteColumn, b: SQLiteColumn) => sql`coalesce(${nz(a)}, ${nz(b)})`;
const sectionOf = (col: SQLiteColumn) => sql`(select ${die.sectionCode} from ${die} where ${die.id} = ${col})`;
const planOf = (col: SQLiteColumn) => sql`(select ${pressPlan.number} from ${pressPlan} where ${pressPlan.id} = ${col})`;
const castOf = (col: SQLiteColumn) => sql`(select ${cast.number} from ${cast} where ${cast.id} = ${col})`;
const lineOf = (col: SQLiteColumn) => sql`(select ${pressLine.code} from ${pressLine} where ${pressLine.id} = ${col})`;

export const RESOLVERS: Record<RefEntity, Resolver> = {
  ageingBatch: simple(ageingBatch, nz(ageingBatch.number)),
  ageingOven: simple(ageingOven, either(ageingOven.name, ageingOven.code)),
  ageingRecipe: simple(ageingRecipe, sql`trim(${ageingRecipe.alloy} || ' ' || coalesce(${ageingRecipe.temper}, '') || ' ' || coalesce(${ageingRecipe.kind}, ''))`),
  ageingRow: simple(
    ageingRow,
    sql`(select ${ageingBatch.number} from ${ageingBatch} where ${ageingBatch.id} = ${ageingRow.batchId}) || ' / ' || ${ageingRow.lengthMm} || ' mm'`,
  ),
  alloy: simple(alloy, either(alloy.name, alloy.code)),
  approval: simple(approval, nz(approval.kind)),
  artifact: (ctx, ids) =>
    mapInChunks(ids, (part) =>
      ctx.db
        .select({ id: ingestArtifact.id, name: ingestArtifact.fileName })
        .from(ingestArtifact)
        .where(and(eq(ingestArtifact.companyId, ctx.companyId), inArray(ingestArtifact.id, part))),
    ),
  bundle: simple(bundle, nz(bundle.serial)),
  candidate: async (ctx, ids) => {
    const found = await mapInChunks(ids, (part) =>
      ctx.db
        .select({ id: ingestCandidate.id, fileName: ingestArtifact.fileName, sheetName: ingestBlock.sheetName, title: ingestBlock.title, ordinal: ingestBlock.ordinal })
        .from(ingestCandidate)
        .innerJoin(ingestBlock, eq(ingestBlock.id, ingestCandidate.blockId))
        .innerJoin(ingestArtifact, eq(ingestArtifact.id, ingestCandidate.artifactId))
        .where(and(eq(ingestCandidate.companyId, ctx.companyId), inArray(ingestCandidate.id, part))),
    );
    return found.map((c) => ({ id: c.id, name: `${c.fileName} / ${c.sheetName ?? c.title ?? `Table ${c.ordinal + 1}`}` }));
  },
  cast: simple(cast, either(cast.number, cast.legacyCode)),
  countSeen: simple(countSeen, nz(countSeen.code)),
  countSession: simple(countSession, nz(countSession.number)),
  customer: simple(customer, nz(customer.name)),
  dcNote: simple(dcNote, nz(dcNote.number)),
  die: simple(die, sql`trim(${die.series} || ' ' || ${die.sectionCode})`),
  dieBand: simple(dieBand, sql`${nz(dieBand.label)} || ' (' || coalesce(${sectionOf(dieBand.sectionId)}, '') || ')'`),
  dieFile: simple(dieFile, nz(dieFile.filename)),
  dieInstance: simple(dieInstance, nz(dieInstance.code)),
  dieIssue: simple(dieIssue, sql`(select ${dieInstance.code} from ${dieInstance} where ${dieInstance.id} = ${dieIssue.dieInstanceId})`),
  dieMaker: simple(dieMaker, nz(dieMaker.name)),
  dieMakerJob: simple(dieMakerJob, nz(dieMakerJob.number)),
  dieShare: simple(dieShare, sectionOf(dieShare.sectionId)),
  dispatch: simple(dispatch, nz(dispatch.code)),
  dispatchItem: simple(dispatchItem, sql`(select ${bundle.serial} from ${bundle} where ${bundle.id} = ${dispatchItem.bundleId})`),
  furnace: simple(furnace, either(furnace.name, furnace.code)),
  location: simple(location, either(location.name, location.code)),
  melt: simple(melt, sql`${castOf(melt.castId)} || ' melt ' || ${melt.seq}`),
  member: (ctx, ids) =>
    mapInChunks(ids, (part) =>
      ctx.db
        .select({ id: user.id, name: user.name })
        .from(user)
        .innerJoin(membership, and(eq(membership.userId, user.id), eq(membership.companyId, ctx.companyId)))
        .where(inArray(user.id, part)),
    ),
  packingList: simple(packingList, nz(packingList.code)),
  pressAlert: simple(pressAlert, sql`${pressAlert.metric} || ' (' || coalesce(${lineOf(pressAlert.pressLineId)}, '') || ')'`),
  pressDowntime: simple(pressDowntime, lineOf(pressDowntime.pressLineId)),
  pressLine: simple(pressLine, either(pressLine.name, pressLine.code)),
  pressPlan: simple(pressPlan, nz(pressPlan.number)),
  pressPlanDie: simple(pressPlanDie, sql`${planOf(pressPlanDie.pressPlanId)} || ' / ' || coalesce(${sectionOf(pressPlanDie.sectionId)}, '')`),
  pressPlanLine: simple(pressPlanLine, sql`${planOf(pressPlanLine.pressPlanId)} || ' / ' || ${pressPlanLine.cutLengthMm} || ' mm'`),
  pressRun: simple(pressRun, nz(pressRun.number)),
  purchaseLot: simple(purchaseLot, nz(purchaseLot.number)),
  reasonCode: simple(reasonCode, either(reasonCode.label, reasonCode.code)),
  returnStream: simple(returnStream, either(returnStream.name, returnStream.code)),
  salesOrder: simple(salesOrder, nz(salesOrder.number)),
  salesOrderLine: simple(
    salesOrderLine,
    sql`(select ${salesOrder.number} from ${salesOrder} where ${salesOrder.id} = ${salesOrderLine.salesOrderId}) || ' line ' || ${salesOrderLine.lineNo}`,
  ),
  scrapGrade: simple(scrapGrade, either(scrapGrade.name, scrapGrade.code)),
  scrapItem: simple(scrapItem, nz(scrapItem.name)),
  spectroInbox: simple(spectroInbox, nz(spectroInbox.fileName)),
  spectroResult: simple(spectroResult, sql`coalesce(${nz(spectroResult.fileName)}, ${castOf(spectroResult.castId)})`),
  storeItem: simple(storeItem, nz(storeItem.name)),
  storeTxn: simple(storeTxn, nz(storeTxn.number)),
  transporter: simple(transporter, nz(transporter.name)),
  trolley: simple(trolley, nz(trolley.code)),
  vendor: simple(vendor, nz(vendor.name)),
  vendorAlias: simple(vendorAlias, nz(vendorAlias.alias)),
};

/** The (entity, id) pairs a draft's top-level input names. */
export function refsOf(path: string, input: unknown): { entity: RefEntity; id: string }[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const out: { entity: RefEntity; id: string }[] = [];
  for (const [key, v] of Object.entries(input as Record<string, unknown>)) {
    const entity = refEntity(path, key);
    if (!entity) continue;
    if (isIdList(key) && Array.isArray(v)) for (const x of v) if (typeof x === "string" && x.length > 0) out.push({ entity, id: x });
    if (!isIdList(key) && typeof v === "string" && v.length > 0) out.push({ entity, id: v });
  }
  return out;
}

/** Names of every id the drafts name, in this plant only. */
export async function resolveDraftNames(ctx: Ctx, drafts: { path: string; inputJson: unknown }[]): Promise<DraftNames> {
  const wanted = new Map<RefEntity, Set<string>>();
  for (const d of drafts) {
    for (const r of refsOf(d.path, d.inputJson)) {
      const set = wanted.get(r.entity) ?? new Set<string>();
      set.add(r.id);
      wanted.set(r.entity, set);
    }
  }
  const names = new Map<string, string>();
  for (const [entity, ids] of wanted) {
    const found = await RESOLVERS[entity](ctx, [...ids]);
    for (const f of found) if (typeof f.name === "string" && f.name.trim().length > 0) names.set(nameKey(entity, f.id), f.name.trim());
  }
  return names;
}
