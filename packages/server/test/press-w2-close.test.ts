/**
 * FP-PR-05/07..11/16/20/23/24 the close (specs §E3 "Close gates", "Arithmetic"): every gate, the
 * worked example 234.2 / 310.4 → 7545 bp = 75.5 %, balance 31.4 kg, exact ledger rows, BILLET
 * on-hand guard with a short reason, issue return / hand-over (C43), reopen reversal, client
 * figures stripped, trial runs, late entry, pressed on the sales order.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { approval, auditLog, dieInstance, dieIssue, pressBilletUse, pressDowntime, pressRun, pressRunLine, qcEntry, returnStream, stockLedger } from "@orrn/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { fillWorkedExample, kg, pressHelpers, type PressPlant } from "./press-w2-fixture";

// Each test walks whole runs (release, issue, start, count, close) on Miniflare D1; 5 s is too
// tight when other worktrees run their gates on the same machine (as plant-foundry.test.ts).
setDefaultTimeout(30_000);

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { pressPlant } = pressHelpers(() => env);

async function run(id: string) {
  const [row] = await env.db.select().from(pressRun).where(eq(pressRun.id, id));
  return row!;
}
async function ledger(companyId: string, runId: string) {
  return env.db
    .select()
    .from(stockLedger)
    .where(and(eq(stockLedger.companyId, companyId), eq(stockLedger.voucherId, runId), inArray(stockLedger.voucherType, ["press_run", "press_run_reopen"])))
    .orderBy(asc(stockLedger.voucherType), asc(stockLedger.line));
}
async function streamId(companyId: string, code: string) {
  const [row] = await env.db.select({ id: returnStream.id }).from(returnStream).where(and(eq(returnStream.companyId, companyId), eq(returnStream.code, code)));
  return row!.id;
}
/** The close gates as the close sees them, for `as` (preview runs the same read; nothing saved). */
async function gatesOf(p: PressPlant, runId: string, as: "supervisor" | "manager" = "supervisor"): Promise<string[]> {
  return (await p.as(as).press.runs.preview({ id: runId })).gates;
}

describe("worked example and ledger (FP-PR-10/11)", () => {
  test("234.2 / 310.4 → 7545 bp = 75.5 %, balance 31.4 kg; exact ledger rows; issue returned; audit", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    const preview = await p.as("press").press.runs.preview({ id: r.runId });
    expect(preview.saved).toBe(false);
    expect(preview.figures).toMatchObject({ inputG: 310_400, goodG: 234_200, rejectG: 7_000, recoveryBp: 7545, recoveryPct: "75.5", balanceG: 31_400, balanceWarn: true });
    // A press operator cannot log.
    await expect(p.as("press").press.runs.close({ id: r.runId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Client figures are stripped: recoveryBp / goodG / balanceG sent with the close are ignored.
    const out = await p.as("supervisor").press.runs.close({ id: r.runId, recoveryBp: 9999, goodG: 1, balanceG: 0, inputG: 5 } as never);
    expect(out).toMatchObject({ status: "logged", recoveryBp: 7545, recoveryPct: "75.5", balanceG: 31_400, issue: "returned" });
    const row = await run(r.runId);
    expect(row).toMatchObject({ status: "logged", inputG: 310_400, inputWeighedG: 310_400, goodG: 234_200, rejectG: 7_000, recoveryBp: 7545, balanceG: 31_400, supervisorId: p.users.supervisor.id });
    expect(row.loggedAt).not.toBeNull();

    const rows = await ledger(p.companyId, r.runId);
    const discard = await streamId(p.companyId, "DISCARD");
    const scrap = await streamId(p.companyId, "PLANT-SCRAP");
    expect(rows.map((x) => [x.voucherType, x.line, x.itemKind, x.itemRef, x.locationId, x.qtyG])).toEqual([
      ["press_run", 1, "billet", c.id, p.billetStoreId, -310_400],
      ["press_run", 2, "return_stream", discard, p.plantScrapId, 25_000],
      ["press_run", 3, "return_stream", scrap, p.plantScrapId, 12_800],
      ["press_run", 4, "return_stream", scrap, p.plantScrapId, 7_000],
    ]);
    expect(new Set(rows.map((x) => x.serverSeq)).size).toBe(1);
    expect(rows[0]!.serverSeq).toBe(row.serverSeq);

    const [copy] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, r.copyId));
    expect(copy!.status).toBe("available");
    const issues = await env.db.select().from(dieIssue).where(eq(dieIssue.dieInstanceId, r.copyId));
    expect(issues.map((i) => i.status)).toEqual(["returned"]);
    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, r.runId), eq(auditLog.action, "press_run.close")));
    expect(audits).toHaveLength(1);

    // FP-PR-16: the order line shows it pressed (run line → plan line → order line).
    const strip = (await p.owner.orders.balance({ orderId: r.orderId })).lines[0]!.strip;
    expect(strip).toMatchObject({ pressedG: 234_200, plannedG: 0 });

    // Logging twice is refused (already logged).
    await expect(p.as("supervisor").press.runs.close({ id: r.runId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("idempotent close replay with the same client mutation id", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id);
    await p.as("supervisor").press.runs.close({ id: r.runId, clientMutationId: "close-0001-abc" });
    expect(await p.as("supervisor").press.runs.close({ id: r.runId, clientMutationId: "close-0001-abc" })).toMatchObject({ replayed: true, recoveryBp: 7545 });
    expect((await ledger(p.companyId, r.runId)).filter((x) => x.itemKind === "billet")).toHaveLength(1);
  });
});

describe("close gates (each)", () => {
  test("empty count: cast, billets, input, lines, qc all missing", async () => {
    const p = await pressPlant();
    const r = await p.countingRun();
    expect(await gatesOf(p, r.runId)).toEqual(expect.arrayContaining(["no_cast", "no_billets", "no_input", "no_lines", "no_qc"]));
    // The close itself refuses with the same list in error meta.
    const err = (await p.as("supervisor").press.runs.close({ id: r.runId }).then(
      () => null,
      (e: unknown) => e,
    )) as { code: string; meta: { gates: string[] }; message: string };
    expect(err).toMatchObject({ code: "BAD_REQUEST", message: "Pick the cast the billets came from" });
    expect(err.meta.gates).toEqual(expect.arrayContaining(["no_cast", "no_billets", "no_input", "no_lines", "no_qc"]));
    expect(await ledger(p.companyId, r.runId)).toEqual([]);
    expect((await run(r.runId)).status).toBe("counting");
  });

  test("not counting: a stopped run refuses (state gate)", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    await p.issue(r.runId, r.copyId);
    await p.as("press").press.runs.start({ id: r.runId });
    await p.as("press").press.runs.stop({ id: r.runId });
    expect(await gatesOf(p, r.runId)).toContain("not_counting");
  });

  test("billets: cast mismatch, kg 0 row, more than 10 rows refused at input", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const other = await p.castWith(kg(500));
    const r = await p.countingRun();
    const press = p.as("press").press.runs;
    // W2-FD-S r1 (I-1c): a run may use billets of two casts (each is charged its own); the gate now
    // fires only when NO row is of the run's cast.
    await press.billets({ id: r.runId, castId: c.id, rows: [{ count: 2, kgG: kg(100) }, { castId: other.id, count: 1, kgG: kg(50) }] });
    expect(await gatesOf(p, r.runId)).not.toContain("billet_cast_mismatch");
    await press.billets({ id: r.runId, castId: c.id, rows: [{ castId: other.id, count: 2, kgG: kg(100) }] });
    expect(await gatesOf(p, r.runId)).toContain("billet_cast_mismatch");
    await press.billets({ id: r.runId, castId: c.id, rows: [{ count: 2, kgG: 0 }] });
    expect(await gatesOf(p, r.runId)).toEqual(expect.arrayContaining(["billet_row_invalid", "no_input"]));
    await expect(
      press.billets({ id: r.runId, castId: c.id, rows: Array.from({ length: 11 }, () => ({ count: 1, kgG: kg(10) })) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Replace-all: two rows then one row leaves one row.
    await press.billets({ id: r.runId, castId: c.id, rows: [{ count: 1, kgG: kg(10) }, { count: 1, kgG: kg(10) }] });
    await press.billets({ id: r.runId, castId: c.id, rows: [{ count: 1, kgG: kg(12) }] });
    const rows = await env.db.select().from(pressBilletUse).where(eq(pressBilletUse.pressRunId, r.runId));
    expect(rows.map((x) => [x.line, x.kgG])).toEqual([[1, 12_000]]);
  });

  test("lines: pieces with kg 0 rejected; good 0; good over input; Σpcs×cut over pressed length", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    const press = p.as("press").press.runs;
    await press.billets({ id: r.runId, castId: c.id, rows: [{ count: 2, kgG: kg(100) }] });
    await press.qc({ id: r.runId, rows: [{ pcs: 0, kgG: 0 }] });
    await press.lines({ id: r.runId, rows: [{ cutLengthMm: 3_658, pcs: 10, goodG: 0 }] });
    expect(await gatesOf(p, r.runId)).toEqual(expect.arrayContaining(["line_without_kg", "no_good"]));
    await press.lines({ id: r.runId, rows: [{ cutLengthMm: 3_658, pcs: 10, goodG: kg(150) }] });
    expect(await gatesOf(p, r.runId)).toContain("good_over_input");
    await press.lines({ id: r.runId, rows: [{ cutLengthMm: 3_658, pcs: 10, goodG: kg(80) }] });
    await press.scrap({ id: r.runId, pressedLengthMm: 30_000 });
    expect(await gatesOf(p, r.runId)).toContain("pieces_over_pressed_length");
    await press.scrap({ id: r.runId, pressedLengthMm: 36_580 });
    expect(await gatesOf(p, r.runId)).toEqual([]);
  });

  test("qc: zero row allowed; positive needs a reason; other needs a note; reason must be qc_reject", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    const press = p.as("press").press.runs;
    await press.billets({ id: r.runId, castId: c.id, rows: [{ count: 2, kgG: kg(100) }] });
    await press.lines({ id: r.runId, rows: [{ cutLengthMm: 3_658, pcs: 10, goodG: kg(80) }] });
    await press.qc({ id: r.runId, rows: [{ pcs: 2, kgG: kg(3) }] });
    expect(await gatesOf(p, r.runId)).toContain("qc_reason_missing");
    await press.qc({ id: r.runId, rows: [{ pcs: 2, kgG: kg(3), reasonCodeId: await p.code("qc_reject", "other") }] });
    expect(await gatesOf(p, r.runId)).toContain("qc_note_missing");
    await expect(press.qc({ id: r.runId, rows: [{ pcs: 2, kgG: kg(3), reasonCodeId: await p.code("downtime", "power") }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(press.qc({ id: r.runId, rows: [{ pcs: 2, kgG: kg(3), reasonCodeId: await p.code("qc_reject", "bend"), runLine: 5 }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await press.qc({ id: r.runId, rows: [{ pcs: 2, kgG: kg(3), reasonCodeId: await p.code("qc_reject", "other"), note: "Twisted", runLine: 1 }] });
    const [q] = await env.db.select().from(qcEntry).where(eq(qcEntry.pressRunId, r.runId));
    const [rl] = await env.db.select().from(pressRunLine).where(eq(pressRunLine.pressRunId, r.runId));
    expect(q!.pressRunLineId).toBe(rl!.id);
    expect(await gatesOf(p, r.runId)).toEqual([]);
    await press.qc({ id: r.runId, rows: [{ pcs: 0, kgG: 0 }] });
    expect(await gatesOf(p, r.runId)).toEqual([]);
  });

  test("downtime open blocks; supervisor named on the run must be the one logging", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id);
    const d = await p.as("press").press.downtime.start({ pressLineId: p.pressLineId, pressRunId: r.runId, reasonCodeId: await p.code("downtime", "die_correction") });
    expect(await gatesOf(p, r.runId)).toEqual(["downtime_open"]);
    await p.as("press").press.downtime.stop({ id: d.id });
    await p.as("press").press.runs.handover({ id: r.runId, supervisorId: p.users.supervisor.id });
    expect(await gatesOf(p, r.runId, "manager")).toEqual(["not_supervisor"]);
    await p.as("supervisor").press.runs.close({ id: r.runId });
    expect((await run(r.runId)).status).toBe("logged");
  });

  test("time unconfirmed blocks until press_time is approved", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.queuedRun();
    await p.issue(r.runId, r.copyId);
    const press = p.as("press").press.runs;
    const started = await press.start({ id: r.runId, tappedAt: Date.now() - 10 * 60_000 });
    await press.stop({ id: r.runId });
    await press.count({ id: r.runId });
    await fillWorkedExample(p, r.runId, c.id);
    expect(await gatesOf(p, r.runId)).toEqual(["time_unconfirmed"]);
    // The requester (press) cannot approve; a press role isn't an approver anyway; supervisor is.
    await expect(p.as("press").approval.decide({ id: started.approvalId!, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("supervisor").approval.decide({ id: started.approvalId!, decision: "approved" });
    await p.as("supervisor").press.runs.close({ id: r.runId });
    expect((await run(r.runId)).status).toBe("logged");
  });

  test("a row changed after the close read fails the close (CONFLICT), nothing posted", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id);
    env.beforeNextBatch(() => p.as("press").press.runs.scrap({ id: r.runId, endsG: kg(13) }));
    await expect(p.as("supervisor").press.runs.close({ id: r.runId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await ledger(p.companyId, r.runId)).toEqual([]);
    expect((await run(r.runId)).status).toBe("counting");
  });
});

describe("BILLET balance guard (FP-PR-07)", () => {
  test("D22: weighed above on hand needs a short reason; input and recovery stay on the weighed kg, the shortfall is recorded", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(300));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id);
    expect(await gatesOf(p, r.runId)).toEqual(["billet_short_reason_missing"]);
    const out = await p.as("supervisor").press.runs.close({ id: r.runId, billetShortReason: "Billets of K-prev mixed in the rack" });
    expect(out).toMatchObject({ inputG: 310_400, inputWeighedG: 310_400, short: true, billetShortG: 10_400 });
    const row = await run(r.runId);
    expect(row).toMatchObject({ inputG: 310_400, inputWeighedG: 310_400, billetShortReason: "Billets of K-prev mixed in the rack", billetShortG: 10_400, recoveryBp: 7545 });
    const [billet] = (await ledger(p.companyId, r.runId)).filter((x) => x.itemKind === "billet");
    expect(billet!.qtyG).toBe(-310_400);
  });

  test("billets taken by another run between read and write: the billet row does not land → CONFLICT, nothing posted", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(320));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id);
    env.beforeNextBatch(() =>
      env.db.insert(stockLedger).values({
        id: crypto.randomUUID(),
        companyId: p.companyId,
        voucherType: "press_run",
        voucherId: crypto.randomUUID(),
        line: 1,
        itemKind: "billet",
        itemRef: c.id,
        locationId: p.billetStoreId,
        qtyG: -kg(100),
        postedAt: new Date(),
      }),
    );
    await expect(p.as("supervisor").press.runs.close({ id: r.runId })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("left in the billet store") });
    expect(await ledger(p.companyId, r.runId)).toEqual([]);
    expect((await run(r.runId)).status).toBe("counting");
  });
});

describe("issue after log (C43)", () => {
  test("next queued run on the line of the same section takes the copy: issue stays open and that run → die_issued", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const sectionId = await p.section();
    const a = await p.countingRun({ sectionId });
    const b = await p.queuedRun({ sectionId });
    await fillWorkedExample(p, a.runId, c.id);
    const out = await p.as("supervisor").press.runs.close({ id: a.runId });
    expect(out).toMatchObject({ issue: "carried", carriedTo: { id: b.runId } });
    expect(await run(b.runId)).toMatchObject({ status: "die_issued", dieInstanceId: a.copyId });
    const issues = await env.db.select().from(dieIssue).where(eq(dieIssue.dieInstanceId, a.copyId));
    expect(issues.map((i) => [i.status, i.pressRunId])).toEqual([["issued", b.runId]]);
    const [copy] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, a.copyId));
    expect(copy!.status).toBe("in_use");
    // ... and it can start straight away.
    await p.as("press").press.runs.start({ id: b.runId });
    expect((await run(b.runId)).status).toBe("running");
  });

  test("next queued run of another section: the issue returns", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const a = await p.countingRun();
    const b = await p.queuedRun();
    await fillWorkedExample(p, a.runId, c.id);
    expect(await p.as("supervisor").press.runs.close({ id: a.runId })).toMatchObject({ issue: "returned", carriedTo: null });
    expect(await run(b.runId)).toMatchObject({ status: "queued", dieInstanceId: null });
  });
});

describe("reopen (press_reopen) writes reversals", () => {
  test("approved reopen → counting, every row reversed; the next close posts new lines; requester cannot approve", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(800));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id);
    await p.as("supervisor").press.runs.close({ id: r.runId });
    await expect(p.as("press").press.runs.reopen({ id: r.runId, reason: "Wrong cast" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { approvalId } = await p.as("manager").press.runs.reopen({ id: r.runId, reason: "Good kg typed wrong" });
    await expect(p.as("manager").press.runs.reopen({ id: r.runId, reason: "again" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.as("manager").approval.decide({ id: approvalId, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("admin").approval.decide({ id: approvalId, decision: "approved" });
    const row = await run(r.runId);
    expect(row).toMatchObject({ status: "counting", goodG: null, recoveryBp: null, loggedAt: null });
    const rows = await ledger(p.companyId, r.runId);
    const originals = rows.filter((x) => x.voucherType === "press_run");
    const reversals = rows.filter((x) => x.voucherType === "press_run_reopen");
    expect(reversals).toHaveLength(4);
    for (const o of originals) {
      const rev = reversals.find((x) => x.reversalOf === o.id)!;
      expect(rev).toMatchObject({ line: o.line, itemKind: o.itemKind, itemRef: o.itemRef, locationId: o.locationId, qtyG: -o.qtyG });
    }
    // Ledger nets to zero for the run; the order line no longer shows it pressed.
    expect(rows.reduce((s, x) => s + x.qtyG, 0)).toBe(0);
    const audits = await env.db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.subjectId, r.runId));
    expect(audits.map((a) => a.a)).toEqual(expect.arrayContaining(["press_run.reopen_request", "press_run.reopen"]));

    await p.as("press").press.runs.lines({ id: r.runId, rows: [{ cutLengthMm: 3_658, pcs: 80, goodG: kg(240) }] });
    await p.as("supervisor").press.runs.close({ id: r.runId });
    const after = await ledger(p.companyId, r.runId);
    expect(after.filter((x) => x.voucherType === "press_run").map((x) => x.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await run(r.runId)).goodG).toBe(240_000);
  });

  test("rejected reopen changes nothing", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(800));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id);
    await p.as("supervisor").press.runs.close({ id: r.runId });
    const { approvalId } = await p.as("supervisor").press.runs.reopen({ id: r.runId, reason: "x" });
    await p.as("manager").approval.decide({ id: approvalId, decision: "rejected" });
    expect((await run(r.runId)).status).toBe("logged");
    expect((await ledger(p.companyId, r.runId)).filter((x) => x.voucherType === "press_run_reopen")).toEqual([]);
  });
});

describe("trial and sample runs (FP-PR-23)", () => {
  test("die_trial plan: no order line; close needs pass / fail; fail → copy on_trial, pass → available; billets still debit", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(1000));
    // Copies on trial (FP-DR-17): the issue carries `trial`, so the close's verdict moves the copy.
    const onTrial = async () => {
      const r = await p.queuedRun({ purpose: "die_trial" });
      await env.db.update(dieInstance).set({ status: "on_trial" }).where(eq(dieInstance.id, r.copyId));
      await p.issue(r.runId, r.copyId);
      const s = p.as("press").press.runs;
      await s.start({ id: r.runId });
      await s.stop({ id: r.runId });
      await s.count({ id: r.runId });
      return r;
    };
    const fail = await onTrial();
    expect(fail.planLineIds).toEqual([]);
    const press = p.as("press").press.runs;
    await press.billets({ id: fail.runId, castId: c.id, rows: [{ count: 1, kgG: kg(60) }] });
    await press.lines({ id: fail.runId, rows: [{ cutLengthMm: 3_658, pcs: 4, goodG: kg(40) }] });
    await press.qc({ id: fail.runId, rows: [{ pcs: 0, kgG: 0 }] });
    await expect(press.lines({ id: fail.runId, rows: [{ cutLengthMm: 3_658, pcs: 4, goodG: kg(40), pressPlanLineId: "x" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await gatesOf(p, fail.runId)).toEqual(["trial_result_missing"]);
    await p.as("supervisor").press.runs.close({ id: fail.runId, trialResult: "fail" });
    expect(await run(fail.runId)).toMatchObject({ status: "logged", trialResult: "fail", goodG: 40_000 });
    const [failed] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, fail.copyId));
    expect(failed!.status).toBe("on_trial");
    expect((await ledger(p.companyId, fail.runId)).find((x) => x.itemKind === "billet")!.qtyG).toBe(-60_000);

    const pass = await onTrial();
    await press.billets({ id: pass.runId, castId: c.id, rows: [{ count: 1, kgG: kg(60) }] });
    await press.lines({ id: pass.runId, rows: [{ cutLengthMm: 3_658, pcs: 4, goodG: kg(40) }] });
    await press.qc({ id: pass.runId, rows: [{ pcs: 0, kgG: 0 }] });
    await p.as("supervisor").press.runs.close({ id: pass.runId, trialResult: "pass" });
    const [passed] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, pass.copyId));
    expect(passed!.status).toBe("available");
  });

  test("a production run refuses a trial result", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id);
    await expect(p.as("supervisor").press.runs.close({ id: r.runId, trialResult: "pass" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("sample plan releases with no order lines and never moves baki", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun({ purpose: "sample" });
    const plan = await p.owner.plans.get({ id: r.planId });
    expect(plan.plan.purpose).toBe("sample");
    expect(plan.lines).toEqual([]);
    await expect(
      p.as("office").plans.create({ windowStart: Date.now(), windowEnd: Date.now() + 3_600_000, purpose: "production", dies: [{ sectionId: r.sectionId, lines: [] }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("late entry (FP-PR-24)", () => {
  test("supervisor only; flag + press_late_entry; requester cannot approve; close waits; approved → billets debit", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const sectionId = await p.section();
    const copyId = await p.copy(sectionId, { milli: 12_000 });
    const startedAt = Date.now() - 5 * 3_600_000;
    const stoppedAt = Date.now() - 3 * 3_600_000;
    const input = { pressLineId: p.pressLineId, dieInstanceId: copyId, startedAt, stoppedAt, reason: "Tablet was down on the night shift", clientMutationId: "late-entry-0001" };
    await expect(p.as("press").press.runs.open(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("supervisor").press.runs.open({ ...input, stoppedAt: Date.now() + 60_000 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const out = await p.as("supervisor").press.runs.open(input);
    expect(out.replayed).toBe(false);
    expect(await p.as("supervisor").press.runs.open(input)).toMatchObject({ id: out.id, replayed: true });
    const row = await run(out.id);
    expect(row).toMatchObject({ status: "counting", lateEntry: true, supervisorId: p.users.supervisor.id, sectionId, dieInstanceId: copyId });
    expect(row.startedAt!.getTime()).toBe(startedAt);
    const [req] = await env.db.select().from(approval).where(and(eq(approval.subjectId, out.id), eq(approval.kind, "press_late_entry")));
    expect(req).toMatchObject({ status: "pending", requestedBy: p.users.supervisor.id });
    expect(req!.meta).toMatchObject({ reason: "Tablet was down on the night shift", productionDay: row.productionDay });

    await fillWorkedExample(p, out.id, c.id);
    expect(await gatesOf(p, out.id)).toEqual(["late_entry_unapproved"]);
    await expect(p.as("supervisor").approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    expect((await run(out.id)).lateEntryApprovalId).toBe(req!.id);
    await p.as("supervisor").press.runs.close({ id: out.id });
    expect((await ledger(p.companyId, out.id)).find((x) => x.itemKind === "billet")!.qtyG).toBe(-310_400);
  });

  test("rejected late entry voids the run; a queued run entered late keeps its plan link", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    const out = await p.as("supervisor").press.runs.open({ runId: r.runId, dieInstanceId: r.copyId, startedAt: Date.now() - 7_200_000, stoppedAt: Date.now() - 3_600_000, reason: "Entered next morning" });
    expect(out.id).toBe(r.runId);
    expect(await run(r.runId)).toMatchObject({ status: "counting", lateEntry: true, dieInstanceId: r.copyId, planId: r.planId });
    await p.as("owner").approval.decide({ id: out.approvalId!, decision: "rejected" });
    expect(await run(r.runId)).toMatchObject({ status: "voided", voidNote: "Late entry rejected" });
  });
});

describe("write-time gates of the close (m-11)", () => {
  test("downtime opened between the read and the write: CONFLICT, nothing posted", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id);
    const reasonCodeId = await p.code("downtime", "billet_wait");
    env.beforeNextBatch(() =>
      env.db.insert(pressDowntime).values({
        id: crypto.randomUUID(),
        companyId: p.companyId,
        pressLineId: p.pressLineId,
        pressRunId: r.runId,
        reasonCodeId,
        startedAt: new Date(),
      }),
    );
    await expect(p.as("supervisor").press.runs.close({ id: r.runId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await ledger(p.companyId, r.runId)).toEqual([]);
    expect((await run(r.runId)).status).toBe("counting");
  });

  test("time marked unconfirmed between the read and the write: CONFLICT, nothing posted", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id);
    env.beforeNextBatch(() => env.db.update(pressRun).set({ timeUnconfirmed: true }).where(eq(pressRun.id, r.runId)));
    await expect(p.as("supervisor").press.runs.close({ id: r.runId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await ledger(p.companyId, r.runId)).toEqual([]);
  });
});
