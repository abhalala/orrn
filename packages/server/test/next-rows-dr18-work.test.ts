/**
 * W4-NEXTROWS FP-DR-18 die work log: `dieInstance.work.kinds` (reason codes of kind die_work, seeded
 * on first read), `dieInstance.work.add` (die.card; rack copies only; `other` needs a note; a
 * correction may send the copy back on trial), the card's `work` timeline, audit rows, no ledger rows.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, dieInstance, reasonCode, stockLedger } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { opHelpers, type OpPlant } from "./orders-w1-fixture";
import { SLOW } from "./sales-fixture";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { opPlant } = opHelpers(() => env);

async function kindsOf(p: OpPlant) {
  const kinds = await p.as("die_room").dieInstance.work.kinds();
  return Object.fromEntries(kinds.map((k) => [k.code, k.id])) as Record<string, string>;
}

async function setStatus(id: string, status: "available" | "in_use" | "at_maker" | "at_nitriding" | "retired" | "on_trial") {
  await env.db.update(dieInstance).set({ status }).where(eq(dieInstance.id, id));
}

describe("FP-DR-18 die work log", () => {
  test("kinds: polish, correct, inspect, clean, other; a retired code is not offered", async () => {
    const p = await opPlant();
    const kinds = await p.as("packer").dieInstance.work.kinds();
    expect(kinds.map((k) => k.code)).toEqual(["polish", "correct", "inspect", "clean", "other"]);
    expect(kinds.find((k) => k.code === "other")?.requiresNote).toBe(true);
    await env.db
      .update(reasonCode)
      .set({ active: false })
      .where(and(eq(reasonCode.companyId, p.companyId), eq(reasonCode.kind, "die_work"), eq(reasonCode.code, "clean")));
    expect((await p.owner.dieInstance.work.kinds()).map((k) => k.code)).not.toContain("clean");
  }, SLOW);

  test("log work on a rack copy: date, note, HV, actor on the card; audited; no stock rows", async () => {
    const p = await opPlant();
    const s = await p.section();
    const c = await p.copy(s, { milli: 12_000 });
    const k = await kindsOf(p);
    const day = Date.UTC(2026, 9, 20, 6, 30);
    const res = await p.as("die_room").dieInstance.work.add({ dieInstanceId: c, reasonCodeId: k.polish!, workedAt: day, note: "Bearing polished", hardness: 980 });
    expect(res.status).toBe("available");
    await p.as("die_room").dieInstance.work.add({ dieInstanceId: c, reasonCodeId: k.inspect! });

    const card = await p.owner.dieInstance.get({ id: c });
    expect(card.instance.status).toBe("available");
    expect(card.work).toHaveLength(2);
    const polish = card.work.find((w) => w.kindCode === "polish")!;
    expect(polish).toMatchObject({ note: "Bearing polished", hardness: 980, setOnTrial: false, label: "Polish" });
    expect(polish.workedAt.getTime()).toBe(day);
    expect(polish.actorName).toBeTruthy();
    // Newest work day first.
    expect(card.work[0]!.kindCode).toBe("inspect");

    const audits = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "die_work.add"), eq(auditLog.subjectId, c)));
    expect(audits).toHaveLength(2);
    expect(audits.find((a) => (a.meta as { kind: string }).kind === "polish")?.meta).toMatchObject({ hardness: 980, setOnTrial: false });
    const ledger = await env.db.select().from(stockLedger).where(eq(stockLedger.companyId, p.companyId));
    expect(ledger.filter((r) => r.itemRef === c)).toEqual([]);
  }, SLOW);

  test("a correction may send the copy back on trial; any other kind may not", async () => {
    const p = await opPlant();
    const s = await p.section();
    const c = await p.copy(s, { milli: 12_000 });
    const k = await kindsOf(p);
    await expect(p.as("die_room").dieInstance.work.add({ dieInstanceId: c, reasonCodeId: k.polish!, setOnTrial: true })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Only a correction can send the copy back on trial",
    });
    const res = await p.as("die_room").dieInstance.work.add({ dieInstanceId: c, reasonCodeId: k.correct!, note: "Bearing opened 0.1", setOnTrial: true });
    expect(res.status).toBe("on_trial");
    const card = await p.owner.dieInstance.get({ id: c });
    expect(card.instance.status).toBe("on_trial");
    expect(card.work[0]).toMatchObject({ kindCode: "correct", setOnTrial: true });
    const trial = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "die_work.trial"), eq(auditLog.subjectId, c)));
    expect(trial[0]?.meta).toMatchObject({ from: "available", to: "on_trial" });
    // On trial already: more work is fine; a second correction leaves it there.
    const again = await p.as("die_room").dieInstance.work.add({ dieInstanceId: c, reasonCodeId: k.correct!, setOnTrial: true });
    expect(again.status).toBe("on_trial");
    expect((await p.owner.dieInstance.get({ id: c })).work[0]).toMatchObject({ setOnTrial: false });
  }, SLOW);

  test("refusals: off the rack, other without a note, a future day, a foreign kind or copy, no die.card", async () => {
    const p = await opPlant();
    const s = await p.section();
    const c = await p.copy(s, { milli: 12_000 });
    const k = await kindsOf(p);
    const dr = p.as("die_room").dieInstance.work;
    for (const [status, msg] of [
      ["in_use", "issued to a press"],
      ["at_maker", "at the die maker"],
      ["at_nitriding", "out at nitriding"],
      ["retired", "is retired"],
    ] as const) {
      await setStatus(c, status);
      await expect(dr.add({ dieInstanceId: c, reasonCodeId: k.clean! })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining(msg) });
    }
    await setStatus(c, "available");
    await expect(dr.add({ dieInstanceId: c, reasonCodeId: k.other! })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Say what was done in the note" });
    await expect(dr.add({ dieInstanceId: c, reasonCodeId: k.other!, note: "Fixed the porthole" })).resolves.toMatchObject({ status: "available" });
    await expect(dr.add({ dieInstanceId: c, reasonCodeId: k.clean!, workedAt: Date.now() + 3 * 86_400_000 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "The work date is in the future",
    });
    // A downtime code is not a work kind.
    const [downtime] = await env.db
      .select({ id: reasonCode.id })
      .from(reasonCode)
      .where(and(eq(reasonCode.companyId, p.companyId), eq(reasonCode.kind, "downtime")))
      .limit(1);
    await expect(dr.add({ dieInstanceId: c, reasonCodeId: downtime!.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Pick what was done" });
    // Another plant's copy is not found; floor roles cannot log.
    const q = await opPlant();
    const qs = await q.section();
    const qc = await q.copy(qs);
    await expect(dr.add({ dieInstanceId: qc, reasonCodeId: k.clean! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.as("packer").dieInstance.work.add({ dieInstanceId: c, reasonCodeId: k.clean! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("press").dieInstance.work.add({ dieInstanceId: c, reasonCodeId: k.clean! })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);
});
