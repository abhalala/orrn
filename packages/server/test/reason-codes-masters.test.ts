/**
 * BACKLOG 40 (W4-MASTERS): reason-code masters CRUD. `reasonCodes.list/create/rename/setActive` per
 * kind; `other` is fixed and cannot be edited or retired; masters.publish only; audited; the wording
 * can be typed in Hindi and Gujarati per code, and the station pickers (`press.reasons`) carry it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, reasonCode } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

async function plant() {
  const { companyId } = await env.seedCompany();
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  return { companyId, as, manager: as("manager") };
}
const audits = (companyId: string, action: string) =>
  env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, action)));

describe("reasonCodes.list", () => {
  test("any member lists every kind with the standard codes (first read adds them); other is last of its kind", async () => {
    const p = await plant();
    const rows = await p.as("viewer").reasonCodes.list();
    const kinds = new Set(rows.map((r) => r.kind));
    // 8 kinds from W1 + die_work (W4-NEXTROWS, FP-DR-18).
    expect(kinds.size).toBe(9);
    expect(kinds.has("die_work")).toBe(true);
    const downtime = rows.filter((r) => r.kind === "downtime");
    expect(downtime.at(-1)!.code).toBe("other");
    expect(downtime.map((r) => r.code)).toContain("die_change");
    // Retired codes are listed too (so they can be switched back on).
    const bend = rows.find((r) => r.kind === "qc_reject" && r.code === "bend")!;
    await p.manager.reasonCodes.setActive({ id: bend.id, active: false });
    const again = await p.as("viewer").reasonCodes.list({ kind: "qc_reject" });
    expect(again.find((r) => r.code === "bend")).toMatchObject({ active: false });
  });
});

describe("reasonCodes.create", () => {
  test("adds a code from its English wording, with Hindi and Gujarati wording, before other", async () => {
    const p = await plant();
    const out = await p.manager.reasonCodes.create({ kind: "downtime", label: "Cooling water low", labelHi: "ठंडा पानी कम", labelGu: "ઠંડુ પાણી ઓછું" });
    expect(out.code).toBe("cooling_water_low");
    const rows = await p.manager.reasonCodes.list({ kind: "downtime" });
    expect(rows.at(-1)!.code).toBe("other");
    const mine = rows.find((r) => r.id === out.id)!;
    expect(mine).toMatchObject({ label: "Cooling water low", labelHi: "ठंडा पानी कम", labelGu: "ઠંડુ પાણી ઓછું", active: true, requiresNote: false });
    expect(rows.findIndex((r) => r.id === out.id)).toBe(rows.length - 2);
    expect((await audits(p.companyId, "reason_code.create"))[0]).toMatchObject({ subjectType: "reason_code", subjectId: out.id });
    // The pickers read it, with the typed wording.
    const picker = await p.as("press").press.reasons({ kind: "downtime" });
    expect(picker.find((r) => r.id === out.id)).toMatchObject({ labelHi: "ठंडा पानी कम", labelGu: "ઠંડુ પાણી ઓછું" });
  });

  test("a second code with the same wording gets its own key; other cannot be created again", async () => {
    const p = await plant();
    const a = await p.manager.reasonCodes.create({ kind: "void", label: "Wrong colour" });
    const b = await p.manager.reasonCodes.create({ kind: "void", label: "Wrong colour" });
    expect([a.code, b.code]).toEqual(["wrong_colour", "wrong_colour_2"]);
    await expect(p.manager.reasonCodes.create({ kind: "void", label: "Other" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.manager.reasonCodes.create({ kind: "void", label: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // A wording with no Latin letters still gets a usable key.
    const hi = await p.manager.reasonCodes.create({ kind: "void", label: "गलत रंग" });
    expect(hi.code).toMatch(/^code_[a-z0-9]+$/);
  });

  test("masters.publish only: office, supervisor and press cannot add", async () => {
    const p = await plant();
    for (const role of ["office", "supervisor", "press", "viewer"] as const) {
      await expect(p.as(role).reasonCodes.create({ kind: "void", label: "Nope" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await p.as("admin").reasonCodes.create({ kind: "void", label: "By admin" });
  });
});

describe("reasonCodes.rename and setActive", () => {
  test("rename changes the wording (English, Hindi, Gujarati), keeps the key, is audited; null clears a translation", async () => {
    const p = await plant();
    const { id } = await p.manager.reasonCodes.create({ kind: "reprint", label: "Smudged", labelHi: "धुंधला" });
    await p.manager.reasonCodes.rename({ id, label: "Smudged print", labelHi: null, labelGu: "ધૂંધળું" });
    const row = (await p.manager.reasonCodes.list({ kind: "reprint" })).find((r) => r.id === id)!;
    expect(row).toMatchObject({ code: "smudged", label: "Smudged print", labelHi: null, labelGu: "ધૂંધળું" });
    const renamed = await audits(p.companyId, "reason_code.rename");
    expect(renamed).toHaveLength(1);
    // m-1: the audit says what the wording became: the cleared Hindi is null, not the old wording.
    const meta = renamed[0]!.meta as { from: Record<string, unknown>; to: Record<string, unknown> };
    expect(meta.from).toMatchObject({ label: "Smudged", labelHi: "धुंधला", labelGu: null });
    expect(meta.to).toMatchObject({ label: "Smudged print", labelHi: null, labelGu: "ધૂંધળું" });
    // A seeded code can be renamed too; the key stays.
    const seeded = (await p.manager.reasonCodes.list({ kind: "downtime" })).find((r) => r.code === "power")!;
    expect(seeded.standard).toBe(true);
    await p.manager.reasonCodes.rename({ id: seeded.id, label: "Mains power cut" });
    // A renamed standard code shows its own wording, so it is no longer "standard" (the pickers carry the flag too).
    expect((await p.as("press").press.reasons({ kind: "downtime" })).find((r) => r.id === seeded.id)).toMatchObject({ standard: false });
    expect((await p.manager.reasonCodes.list({ kind: "downtime" })).find((r) => r.id === seeded.id)).toMatchObject({ code: "power", label: "Mains power cut" });
  });

  test("deactivate and reactivate; a retired code drops out of the pickers and comes back; each is audited", async () => {
    const p = await plant();
    const row = (await p.manager.reasonCodes.list({ kind: "qc_reject" })).find((r) => r.code === "crack")!;
    await p.manager.reasonCodes.setActive({ id: row.id, active: false });
    expect((await p.as("press").press.reasons({ kind: "qc_reject" })).some((r) => r.code === "crack")).toBe(false);
    await p.manager.reasonCodes.setActive({ id: row.id, active: true });
    expect((await p.as("press").press.reasons({ kind: "qc_reject" })).some((r) => r.code === "crack")).toBe(true);
    expect(await audits(p.companyId, "reason_code.retire")).toHaveLength(1);
    expect(await audits(p.companyId, "reason_code.reactivate")).toHaveLength(1);
    // Setting the state it already has writes nothing more.
    await p.manager.reasonCodes.setActive({ id: row.id, active: true });
    expect(await audits(p.companyId, "reason_code.reactivate")).toHaveLength(1);
  });

  test("other is fixed: it cannot be renamed or retired, in any kind", async () => {
    const p = await plant();
    const rows = await p.manager.reasonCodes.list();
    const others = rows.filter((r) => r.code === "other");
    expect(others).toHaveLength(9); // one per kind, die_work included
    for (const o of others) {
      await expect(p.manager.reasonCodes.rename({ id: o.id, label: "Misc" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(p.manager.reasonCodes.setActive({ id: o.id, active: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    const [still] = await env.db.select().from(reasonCode).where(eq(reasonCode.id, others[0]!.id));
    expect(still).toMatchObject({ label: "Other", active: true, requiresNote: true });
  });

  test("another plant's code is not found; office cannot rename", async () => {
    const a = await plant();
    const b = await plant();
    const row = (await a.manager.reasonCodes.list({ kind: "void" }))[0]!;
    await expect(b.manager.reasonCodes.rename({ id: row.id, label: "Hijack" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.manager.reasonCodes.setActive({ id: row.id, active: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.as("office").reasonCodes.rename({ id: row.id, label: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
