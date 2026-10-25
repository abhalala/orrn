/**
 * W2-PR-S review round 1: late entry gates on the copy (I-1, m-3), D22 billets short of the store
 * (I-2), run lines count against the sales order (I-3, FP-PR-16), a reopened die trial takes its
 * new verdict through lib/dieTrial (I-4, BACKLOG 26), every gate code has a console key (en, hi, gu).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, customer, dieInstance, pressLine, pressRun, pressRunLine, stockLedger } from "@orrn/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { fillWorkedExample, kg, pressHelpers, type PressPlant } from "./press-w2-fixture";

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
async function copyRow(id: string) {
  const [row] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, id));
  return row!;
}
async function setCopy(id: string, status: "available" | "on_trial" | "at_maker" | "at_nitriding" | "retired") {
  await env.db.update(dieInstance).set({ status }).where(eq(dieInstance.id, id));
}
async function otherCustomer(companyId: string, name: string) {
  const id = crypto.randomUUID();
  await env.db.insert(customer).values({ id, companyId, name });
  return id;
}
const lateTimes = () => ({ startedAt: Date.now() - 5 * 3_600_000, stoppedAt: Date.now() - 3 * 3_600_000, reason: "Tablet was down on the night shift" });

describe("late entry checks the copy like an issue does (I-1, m-3)", () => {
  test("customer-owned copy for another party is refused with the issue's words", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    const owner = await otherCustomer(p.companyId, "Tejura and Sons");
    const owned = await p.copy(r.sectionId, { ownerCustomerId: owner });
    await expect(p.as("supervisor").press.runs.open({ runId: r.runId, dieInstanceId: owned, ...lateTimes() })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This die belongs to Tejura and Sons",
    });
    expect((await run(r.runId)).status).toBe("queued");
  });

  test("copy at the maker, at nitriding, retired: refused (fresh run and queued run)", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    await setCopy(r.copyId, "at_maker");
    const { code } = await copyRow(r.copyId);
    await expect(p.as("supervisor").press.runs.open({ runId: r.runId, dieInstanceId: r.copyId, ...lateTimes() })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `${code} is at the die maker`,
    });
    await setCopy(r.copyId, "at_nitriding");
    await expect(p.as("supervisor").press.runs.open({ pressLineId: p.pressLineId, dieInstanceId: r.copyId, ...lateTimes() })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `${code} is out at nitriding`,
    });
    await setCopy(r.copyId, "retired");
    await expect(p.as("supervisor").press.runs.open({ pressLineId: p.pressLineId, dieInstanceId: r.copyId, ...lateTimes() })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `${code} is retired`,
    });
  });

  test("copy on trial goes only to a die trial run", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    await setCopy(r.copyId, "on_trial");
    const { code } = await copyRow(r.copyId);
    const onTrial = `${code} is on trial; it goes only to a die trial run until the trial passes or a manager releases it`;
    await expect(p.as("supervisor").press.runs.open({ runId: r.runId, dieInstanceId: r.copyId, ...lateTimes() })).rejects.toMatchObject({ message: onTrial });
    await expect(p.as("supervisor").press.runs.open({ pressLineId: p.pressLineId, dieInstanceId: r.copyId, ...lateTimes() })).rejects.toMatchObject({ message: onTrial });
    const t = await p.queuedRun({ purpose: "die_trial" });
    await setCopy(t.copyId, "on_trial");
    const out = await p.as("supervisor").press.runs.open({ runId: t.runId, dieInstanceId: t.copyId, ...lateTimes() });
    expect(await run(out.id)).toMatchObject({ status: "counting", lateEntry: true, dieInstanceId: t.copyId });
  });

  test("copy in use elsewhere is refused; the run's own issued copy is fine", async () => {
    const p = await pressPlant();
    const a = await p.queuedRun();
    await p.issue(a.runId, a.copyId);
    await expect(p.as("supervisor").press.runs.open({ pressLineId: p.pressLineId, dieInstanceId: a.copyId, ...lateTimes() })).rejects.toMatchObject({
      code: "CONFLICT",
      message: `${(await copyRow(a.copyId)).code} is already issued to P1`,
    });
    // The die_issued run itself may be entered late with the copy issued to it.
    const out = await p.as("supervisor").press.runs.open({ runId: a.runId, ...lateTimes() });
    expect(await run(out.id)).toMatchObject({ status: "counting", lateEntry: true, dieInstanceId: a.copyId });
  });

  test("a retired press line and a run older than 7 days are refused", async () => {
    const p = await pressPlant();
    const sectionId = await p.section();
    const copyId = await p.copy(sectionId);
    const old = Date.now() - 8 * 86_400_000;
    await expect(
      p.as("supervisor").press.runs.open({ pressLineId: p.pressLineId, dieInstanceId: copyId, startedAt: old, stoppedAt: old + 3_600_000, reason: "Found the sheet" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "A late entry must be within 7 days" });
    await env.db.update(pressLine).set({ status: "retired" }).where(eq(pressLine.id, p.pressLineId));
    await expect(p.as("supervisor").press.runs.open({ pressLineId: p.pressLineId, dieInstanceId: copyId, ...lateTimes() })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "P1 is retired",
    });
  });
});

describe("D22 billets short of the store (I-2)", () => {
  async function billetRows(companyId: string, runId: string) {
    return env.db
      .select()
      .from(stockLedger)
      .where(and(eq(stockLedger.companyId, companyId), eq(stockLedger.voucherId, runId), eq(stockLedger.itemKind, "billet")))
      .orderBy(asc(stockLedger.line));
  }

  test("short store: the run logs, recovery from the weighed kg, BILLET debited in full, cast shows short", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(300));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    const preview = await p.as("supervisor").press.runs.preview({ id: r.runId });
    expect(preview.gates).toEqual(["billet_short_reason_missing"]);
    expect(preview.figures).toMatchObject({ inputG: 310_400, recoveryBp: 7545, balanceG: 31_400, short: true, billetShortG: 10_400 });
    const out = await p.as("supervisor").press.runs.close({ id: r.runId, billetShortReason: "Billets of the last cast mixed in the rack" });
    expect(out).toMatchObject({ inputG: 310_400, inputWeighedG: 310_400, recoveryBp: 7545, recoveryPct: "75.5", balanceG: 31_400, short: true, billetShortG: 10_400 });
    expect(await run(r.runId)).toMatchObject({
      inputG: 310_400,
      inputWeighedG: 310_400,
      recoveryBp: 7545,
      balanceG: 31_400,
      billetShortG: 10_400,
      billetShortReason: "Billets of the last cast mixed in the rack",
    });
    expect((await billetRows(p.companyId, r.runId)).map((x) => x.qtyG)).toEqual([-310_400]);
    // The cast shows the shortfall for the foundry close-out (list and card).
    const list = await p.owner.foundry.casts.list({});
    expect(list.items.find((x) => x.id === c.id)).toMatchObject({ billetsOnHandG: -10_400, billetsShortG: 10_400 });
    const card = await p.owner.foundry.casts.get({ id: c.id });
    expect(card.closeout).toMatchObject({ billetsShortG: 10_400 });
  });

  test("no billets in the store at all (paper casts): logs with full input and recovery", async () => {
    const p = await pressPlant();
    const c = await p.castWith(0);
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    const out = await p.as("supervisor").press.runs.close({ id: r.runId, billetShortReason: "Cast from the paper sheet" });
    expect(out).toMatchObject({ inputG: 310_400, recoveryBp: 7545, billetShortG: 310_400 });
    expect((await billetRows(p.companyId, r.runId)).map((x) => x.qtyG)).toEqual([-310_400]);
  });

  test("negative on hand (a reversal after use) still logs", async () => {
    const p = await pressPlant();
    const c = await p.castWith(0);
    await env.db.insert(stockLedger).values({
      id: crypto.randomUUID(),
      companyId: p.companyId,
      voucherType: "melt",
      voucherId: crypto.randomUUID(),
      line: 1,
      itemKind: "billet",
      itemRef: c.id,
      locationId: p.billetStoreId,
      qtyG: -kg(5),
      postedAt: new Date(),
    });
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    const out = await p.as("supervisor").press.runs.close({ id: r.runId, billetShortReason: "Melt cancelled after the billets were used" });
    expect(out).toMatchObject({ status: "logged", inputG: 310_400, recoveryBp: 7545, billetShortG: 310_400 });
  });

  test("reopen clears the short figure; a re-close with enough billets records none", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(300));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    await p.as("supervisor").press.runs.close({ id: r.runId, billetShortReason: "Short" });
    const { approvalId } = await p.as("supervisor").press.runs.reopen({ id: r.runId, reason: "Billet kg typed wrong" });
    await p.as("manager").approval.decide({ id: approvalId, decision: "approved" });
    expect(await run(r.runId)).toMatchObject({ status: "counting", billetShortG: null });
    await p.as("press").press.runs.billets({ id: r.runId, castId: c.id, rows: [{ count: 8, kgG: kg(290) }] });
    await p.as("supervisor").press.runs.close({ id: r.runId });
    expect(await run(r.runId)).toMatchObject({ status: "logged", inputG: 290_000, billetShortG: 0 });
  });
});

describe("run lines count against the sales order (I-3, FP-PR-16)", () => {
  test("an unlinked row is mapped to the plan's single line of that cut length; baki unchanged, pressed rises", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    const before = (await p.owner.orders.balance({ orderId: r.orderId })).lines[0]!.strip;
    expect(before.pressedG).toBe(0);
    await fillWorkedExample(p, r.runId, c.id); // rows sent with no pressPlanLineId
    const [line] = await env.db.select().from(pressRunLine).where(eq(pressRunLine.pressRunId, r.runId));
    expect(line).toMatchObject({ pressPlanLineId: r.planLineIds[0], salesOrderLineId: r.salesOrderLineIds[0] });
    await p.as("supervisor").press.runs.close({ id: r.runId });
    const after = (await p.owner.orders.balance({ orderId: r.orderId })).lines[0]!.strip;
    expect(after.pressedG).toBe(234_200);
    expect(after.bakiG).toBe(before.bakiG);
  });

  test("a production row with no matching plan line, or two that match, is refused", async () => {
    const p = await pressPlant();
    const r = await p.countingRun();
    const press = p.as("press").press.runs;
    await expect(press.lines({ id: r.runId, rows: [{ cutLengthMm: 5_486, pcs: 4, goodG: kg(40) }] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Pick the order line for 5486 mm",
    });
    // Two order lines of one cut length on the plan: the station must say which.
    const sectionId = await p.section();
    const copyId = await p.copy(sectionId, { milli: 12_000 });
    const ord = await p.confirmedOrder([
      { sectionId, pcs: 100 },
      { sectionId, pcs: 100 },
    ]);
    const now = Date.now();
    const plan = await p.as("office").plans.create({
      windowStart: now,
      windowEnd: now + 8 * 3_600_000,
      pressLineId: p.pressLineId,
      purpose: "production",
      dies: [{ sectionId, lines: ord.lineIds.map((salesOrderLineId) => ({ salesOrderLineId, pcs: 50 })) }],
    });
    const rel = await p.as("manager").plans.release({ id: plan.id });
    const runId = rel.runs[0]!.id;
    await p.issue(runId, copyId);
    await press.start({ id: runId });
    await press.stop({ id: runId });
    await press.count({ id: runId });
    await expect(press.lines({ id: runId, rows: [{ cutLengthMm: 3_658, pcs: 4, goodG: kg(40) }] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Pick the order line for 3658 mm",
    });
    const planLines = (await p.owner.plans.get({ id: plan.id })).lines.map((l) => l.id);
    await press.lines({ id: runId, rows: [{ cutLengthMm: 3_658, pcs: 4, goodG: kg(40), pressPlanLineId: planLines[1] }] });
    const [line] = await env.db.select().from(pressRunLine).where(eq(pressRunLine.pressRunId, runId));
    expect(line!.salesOrderLineId).toBe(ord.lineIds[1]!);
  });

  test("trial and sample runs take rows with no order line", async () => {
    const p = await pressPlant();
    const r = await p.countingRun({ purpose: "sample" });
    await p.as("press").press.runs.lines({ id: r.runId, rows: [{ cutLengthMm: 1_000, pcs: 4, goodG: kg(10) }] });
    const [line] = await env.db.select().from(pressRunLine).where(eq(pressRunLine.pressRunId, r.runId));
    expect(line).toMatchObject({ pressPlanLineId: null, salesOrderLineId: null });
  });
});

describe("die trial verdict through lib/dieTrial (I-4, BACKLOG 26)", () => {
  async function trialRun(p: PressPlant, castId: string) {
    const r = await p.queuedRun({ purpose: "die_trial" });
    await setCopy(r.copyId, "on_trial");
    await p.issue(r.runId, r.copyId);
    const press = p.as("press").press.runs;
    await press.start({ id: r.runId });
    await press.stop({ id: r.runId });
    await press.count({ id: r.runId });
    await press.billets({ id: r.runId, castId, rows: [{ count: 1, kgG: kg(60) }] });
    await press.lines({ id: r.runId, rows: [{ cutLengthMm: 3_658, pcs: 4, goodG: kg(40) }] });
    await press.qc({ id: r.runId, rows: [{ pcs: 0, kgG: 0 }] });
    return r;
  }
  async function trialAudits(copyId: string) {
    const rows = await env.db
      .select({ action: auditLog.action, meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.subjectId, copyId), inArray(auditLog.action, ["die_trial.pass", "die_trial.fail", "die_trial.reopen"])))
      .orderBy(asc(auditLog.at));
    return rows.map((r) => [r.action, (r.meta as Record<string, unknown>).pressRunId]);
  }
  async function reopen(p: PressPlant, runId: string) {
    const { approvalId } = await p.as("supervisor").press.runs.reopen({ id: runId, reason: "Wrong verdict" });
    await p.as("manager").approval.decide({ id: approvalId, decision: "approved" });
  }

  test("pass on a copy on trial: available, die_trial.pass audit naming the run", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await trialRun(p, c.id);
    await p.as("supervisor").press.runs.close({ id: r.runId, trialResult: "pass" });
    expect((await copyRow(r.copyId)).status).toBe("available");
    expect(await trialAudits(r.copyId)).toEqual([["die_trial.pass", r.runId]]);
  });

  test("pass → reopen → fail leaves the copy on trial", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await trialRun(p, c.id);
    await p.as("supervisor").press.runs.close({ id: r.runId, trialResult: "pass" });
    expect((await copyRow(r.copyId)).status).toBe("available");
    await reopen(p, r.runId);
    expect((await copyRow(r.copyId)).status).toBe("on_trial");
    expect(await run(r.runId)).toMatchObject({ status: "counting", trialResult: null });
    await p.as("supervisor").press.runs.close({ id: r.runId, trialResult: "fail" });
    expect((await copyRow(r.copyId)).status).toBe("on_trial");
    // A fail never retires or re-sends the copy by itself (lib/dieTrial contract 5).
    expect(await trialAudits(r.copyId)).toEqual([
      ["die_trial.pass", r.runId],
      ["die_trial.reopen", r.runId],
    ]);
  });

  test("fail: copy back on trial, issue returned; a rack copy on a trial plan goes back to the rack", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await trialRun(p, c.id);
    await p.as("supervisor").press.runs.close({ id: r.runId, trialResult: "fail" });
    expect((await copyRow(r.copyId)).status).toBe("on_trial");
    expect(await trialAudits(r.copyId)).toEqual([]);
    // A copy that was on the rack when issued (not on trial) goes back to the rack whatever the verdict.
    const rack = await p.countingRun({ purpose: "die_trial" });
    const press = p.as("press").press.runs;
    await press.billets({ id: rack.runId, castId: c.id, rows: [{ count: 1, kgG: kg(60) }] });
    await press.lines({ id: rack.runId, rows: [{ cutLengthMm: 3_658, pcs: 4, goodG: kg(40) }] });
    await press.qc({ id: rack.runId, rows: [{ pcs: 0, kgG: 0 }] });
    await p.as("supervisor").press.runs.close({ id: rack.runId, trialResult: "fail" });
    expect((await copyRow(rack.copyId)).status).toBe("available");
  });

  test("fail → reopen → pass puts the copy on the rack", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await trialRun(p, c.id);
    await p.as("supervisor").press.runs.close({ id: r.runId, trialResult: "fail" });
    expect((await copyRow(r.copyId)).status).toBe("on_trial");
    await reopen(p, r.runId);
    expect((await copyRow(r.copyId)).status).toBe("on_trial");
    await p.as("supervisor").press.runs.close({ id: r.runId, trialResult: "pass" });
    expect((await copyRow(r.copyId)).status).toBe("available");
  });

  test("reopen does not pull back a copy the trial no longer holds (issued again since)", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await trialRun(p, c.id);
    await p.as("supervisor").press.runs.close({ id: r.runId, trialResult: "pass" });
    const next = await p.queuedRun({ sectionId: r.sectionId });
    await p.issue(next.runId, r.copyId);
    await reopen(p, r.runId);
    expect((await copyRow(r.copyId)).status).toBe("in_use");
  });
});

describe("reopen blockers (hook for the ageing lane)", () => {
  test("a registered blocker refuses the reopen with CONFLICT and its reason; removed, the reopen goes through", async () => {
    const { registerReopenBlocker } = await import("../src/lib/press/reopenBlockers");
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    await p.as("supervisor").press.runs.close({ id: r.runId });
    const seen: string[] = [];
    const remove = registerReopenBlocker(async (_db, companyId, runId) => {
      seen.push(`${companyId}:${runId}`);
      return runId === r.runId ? "Pieces of this run are in an ageing basket" : null;
    });
    try {
      await expect(p.as("supervisor").press.runs.reopen({ id: r.runId, reason: "Good kg typed wrong" })).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Pieces of this run are in an ageing basket",
      });
      expect(seen).toEqual([`${p.companyId}:${r.runId}`]);
    } finally {
      remove();
    }
    const { approvalId } = await p.as("supervisor").press.runs.reopen({ id: r.runId, reason: "Good kg typed wrong" });
    expect(approvalId).toBeString();
  });

  test("with no blockers registered, reopen works", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    await p.as("supervisor").press.runs.close({ id: r.runId });
    const { approvalId } = await p.as("supervisor").press.runs.reopen({ id: r.runId, reason: "Billets typed wrong" });
    await p.as("manager").approval.decide({ id: approvalId, decision: "approved" });
    expect((await run(r.runId)).status).toBe("counting");
  });
});

describe("console keys for every gate (W2-PR-W)", () => {
  test("PRESS_GATE_TEXT codes and the start lock have press.console keys in en, hi and gu", async () => {
    const { PRESS_GATE_TEXT } = await import("../src/routers/pressRun");
    const base = "../../i18n/src";
    const dicts = {
      en: ((await import(`${base}/en`)) as { en: Record<string, unknown> }).en,
      hi: ((await import(`${base}/hi`)) as { hi: Record<string, unknown> }).hi,
      gu: ((await import(`${base}/gu`)) as { gu: Record<string, unknown> }).gu,
    };
    for (const [lang, dict] of Object.entries(dicts)) {
      const console = (dict.press as { console: { startLocked?: string; gates?: Record<string, string> } }).console;
      expect({ lang, startLocked: typeof console.startLocked }).toEqual({ lang, startLocked: "string" });
      const missing = Object.keys(PRESS_GATE_TEXT).filter((code) => !console.gates?.[code]);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
    expect(dicts.en.press).toMatchObject({ console: { startLocked: "Die not issued. Start is locked.", gates: PRESS_GATE_TEXT } });
  });
});
