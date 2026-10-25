/**
 * W2-PR-S dev seed (idempotent): P1 with a die_issued run (PR-1), the die room's queued and trial
 * runs (PR-2..PR-7, W2-DR2), a run logged today with its lines / billets / QC / closed downtime and
 * exact close ledger rows (PR-8, the worked example), a late entry waiting for press_late_entry
 * (PR-9), and a cast with billets on hand.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { approval, pressBilletUse, pressDowntime, pressRun, pressRunLine, qcEntry, stockLedger, user } from "@orrn/db/schema";
import { and, asc, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

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

const companyId = "dev-company-orrn";

describe("dev seed: Wave 2 press demo (idempotent)", () => {
  test("PR-1 die_issued, PR-2 logged today with children + ledger, PR-3 late entry pending; the owner can decide it", async () => {
    for (const key of ["owner", "operator", "viewer", "office", "dieroom", "supervisor", "press", "staff"]) {
      await env.db.insert(user).values({ id: `dev-user-${key}`, name: key, email: `${key}@orrn.local` }).onConflictDoNothing();
    }
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean; counts: Record<string, number> }>;
    };
    for (let i = 0; i < 2; i++) {
      const out = await seedDevData(env.db, { password: "dev-seed-test" });
      expect(out.ok).toBe(true);
      expect(out.counts.pressRuns).toBe(9);
      const runs = await env.db.select().from(pressRun).where(eq(pressRun.companyId, companyId)).orderBy(asc(pressRun.number));
      expect(runs.map((r) => [r.number, r.status, r.lateEntry])).toEqual([
        ["PR-1", "die_issued", false],
        ["PR-2", "queued", false],
        ["PR-3", "queued", false],
        ["PR-4", "queued", false],
        ["PR-5", "queued", false],
        ["PR-6", "queued", false],
        ["PR-7", "queued", false],
        ["PR-8", "logged", false],
        ["PR-9", "counting", true],
      ]);
      const logged = runs.find((r) => r.number === "PR-8")!;
      const late = runs.find((r) => r.number === "PR-9")!;
      expect(logged).toMatchObject({ inputG: 310_400, goodG: 234_200, recoveryBp: 7545, balanceG: 31_400 });
      expect(await env.db.select().from(pressRunLine).where(eq(pressRunLine.pressRunId, logged.id))).toHaveLength(1);
      expect(await env.db.select().from(pressBilletUse).where(eq(pressBilletUse.pressRunId, logged.id))).toHaveLength(2);
      expect(await env.db.select().from(qcEntry).where(eq(qcEntry.pressRunId, logged.id))).toHaveLength(1);
      const dts = await env.db.select().from(pressDowntime).where(eq(pressDowntime.pressRunId, logged.id));
      expect(dts.map((d) => d.stoppedAt !== null)).toEqual([true]);
      const rows = await env.db
        .select()
        .from(stockLedger)
        .where(and(eq(stockLedger.companyId, companyId), eq(stockLedger.voucherId, logged.id)))
        .orderBy(asc(stockLedger.line));
      expect(rows.map((r) => [r.voucherType, r.line, r.itemKind, r.qtyG])).toEqual([
        ["press_run", 1, "billet", -310_400],
        ["press_run", 2, "return_stream", 25_000],
        ["press_run", 3, "return_stream", 12_800],
        ["press_run", 4, "return_stream", 7_000],
      ]);
      const pending = await env.db.select().from(approval).where(and(eq(approval.companyId, companyId), eq(approval.kind, "press_late_entry")));
      expect(pending.map((a) => [a.subjectId, a.status])).toEqual([[late.id, "pending"]]);
    }

    // The station reads it; Today shows it; the owner approves the late entry and logs it.
    const owner = env.callerForUser("dev-user-owner");
    const station = await owner.press.runs.get({ id: "dev-run-12230-1" });
    expect(station.figures).toMatchObject({ recoveryBp: 7545, balanceG: 31_400 });
    const today = await owner.dashboard.today();
    expect(today.pressedToday!.kgG).toBeGreaterThanOrEqual(234_200);
    await owner.approval.decide({ id: "dev-approval-late-entry-1", decision: "approved" });
    const closed = await owner.press.runs.close({ id: "dev-run-13090-2-late" });
    expect(closed).toMatchObject({ status: "logged", inputG: 230_000 });
    // The next run number continues the book.
    const q = await owner.press.queue.list({ pressLineId: "dev-press-line-1" });
    expect(q.cards.map((c) => c.number)).toEqual(["PR-1", "PR-2", "PR-3", "PR-4", "PR-5", "PR-6", "PR-7"]);
  }, 60_000);
});
