/**
 * Process-step gates other modules call (XE parity lane JOBWORK, CONTRACTS-W2 item 3). A bundle on an
 * open process hold (out at a job-work vendor, or on an in-house line) cannot be dispatched, reserved,
 * moved, voided or loaded on a trolley; a bundle used up into new output cannot be restored. The hold
 * is a fact on the bundle, so these gates run whether or not the module is still on.
 *
 * Two different questions:
 * - "on a process step" (open `process_hold`): not dispatchable, not movable (both reasons).
 * - "at a vendor" (the bundle's location is of kind `vendor`): not plant stock (`notAtVendorSql`).
 */
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { bundle } from "@orrn/db/schema/inventory";
import { processHold, processStep } from "@orrn/db/schema/process";

import { abortBatchUnless, chunk, IN_LIST_CHUNK, isBatchAbort, mapInChunks, type OrrnDb, type SqliteBatchItem } from "./atomic";
import { jobworkRefusal } from "./processRefusals";

export type OpenProcessHold = { stepId: string; stepNumber: string; reason: "jobwork" | "process" };

/** Open process holds of these bundles, keyed by bundle id (company scoped, chunked). */
export async function openProcessHolds(db: OrrnDb, companyId: string, bundleIds: readonly string[]): Promise<Map<string, OpenProcessHold>> {
  const unique = [...new Set(bundleIds)];
  if (unique.length === 0) return new Map();
  const rows = await mapInChunks(unique, (part) =>
    db
      .select({ bundleId: processHold.bundleId, stepId: processHold.stepId, reason: processHold.reason, stepNumber: processStep.number })
      .from(processHold)
      .innerJoin(processStep, and(eq(processStep.id, processHold.stepId), eq(processStep.companyId, processHold.companyId)))
      .where(and(eq(processHold.companyId, companyId), inArray(processHold.bundleId, part), isNull(processHold.releasedAt))),
  );
  return new Map(rows.map((r) => [r.bundleId, { stepId: r.stepId, stepNumber: r.stepNumber, reason: r.reason }]));
}

/**
 * Refuse the first bundle that sits on an open process step, by its serial: "out for job work on
 * JW/2026-27/4" or "on process step PS/2026-27/2". Read-time half; pair it with
 * `processHoldGuardStatements` inside a batch that must not race a challan.
 */
export async function assertNotInProcess(db: OrrnDb, companyId: string, bundleIds: readonly string[]): Promise<void> {
  if (bundleIds.length === 0) return;
  const held = await openProcessHolds(db, companyId, bundleIds);
  if (held.size === 0) return;
  const firstId = bundleIds.find((id) => held.has(id))!;
  const h = held.get(firstId)!;
  const [b] = await db.select({ serial: bundle.serial }).from(bundle).where(and(eq(bundle.companyId, companyId), eq(bundle.id, firstId))).limit(1);
  throw jobworkRefusal(h.reason === "jobwork" ? "bundle_at_vendor" : "bundle_in_process", { serial: b?.serial ?? "", step: h.stepNumber });
}

/**
 * Write-time half: fails the batch (`isBatchAbort`) when any of these bundles went onto a process step
 * between the caller's read and its write. The caller catches, runs `assertNotInProcess` again for the
 * precise refusal, and rethrows otherwise.
 */
export function processHoldGuardStatements(db: OrrnDb, companyId: string, bundleIds: readonly string[]): SqliteBatchItem[] {
  return chunk([...new Set(bundleIds)], IN_LIST_CHUNK - 5).map((ids) =>
    abortBatchUnless(
      db,
      sql`not exists (select 1 from process_hold ph where ph.company_id = ${companyId} and ph.released_at is null
        and ph.bundle_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}))`,
    ),
  );
}

/** After a failed batch: the process refusal when a hold landed in between, else the original error. */
export async function explainProcessAbort(db: OrrnDb, companyId: string, bundleIds: readonly string[], e: unknown): Promise<never> {
  if (isBatchAbort(e)) await assertNotInProcess(db, companyId, bundleIds);
  throw e;
}

/** SQL over the outer `bundle` row: it does not sit at a job-work vendor (plant stock only). */
export function notAtVendorSql(companyId: string): SQL {
  return sql`not exists (select 1 from location vl where vl.id = ${bundle.locationId} and vl.company_id = ${companyId} and vl.kind = 'vendor')`;
}

/** SQL over the outer `bundle` row: no open process hold (in the yard and free to pick). */
export function notInProcessSql(companyId: string): SQL {
  return sql`not exists (select 1 from process_hold ph where ph.company_id = ${companyId} and ph.bundle_id = ${bundle.id} and ph.released_at is null)`;
}

/**
 * A void bundle that a process step used up into new output: a restore would bring kg back that the
 * outputs already carry. Throws `consumed_input` for the first such bundle.
 */
export async function assertNotConsumed(db: OrrnDb, companyId: string, bundleId: string, serial: string): Promise<void> {
  const rows = await db.all<{ number: string }>(
    sql`select ps.number as number from process_input pi
      join process_return pr on pr.id = pi.return_id and pr.company_id = pi.company_id
      join process_step ps on ps.id = pi.step_id and ps.company_id = pi.company_id
      where pi.company_id = ${companyId} and pi.bundle_id = ${bundleId} and pr.mode = 'new' limit 1`,
  );
  if (rows[0]) throw jobworkRefusal("consumed_input", { serial, step: rows[0].number });
}
