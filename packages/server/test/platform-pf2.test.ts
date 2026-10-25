/**
 * W2-PF2: reason codes for real plants (rank 30) and the thresholds the plant sets (rank 31).
 * - A company approved from a waiting request starts with every default reason code.
 * - `press.reasons` (the picker read) adds the defaults an existing plant is missing, once, and never
 *   duplicates, renames or re-activates anything.
 * - `company.updateSettings` takes drift bands, recovery bands and the press balance warning in
 *   basis points; refuses green >= amber; read-only without `settings.update`; audited.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, reasonCode } from "@orrn/db/schema";
import { company, waitlistRequest } from "@orrn/db/schema/tenant";
import { DEFAULT_REASON_CODES, REASON_CODE_KINDS, defaultReasonCodeRows, readFloorSettings, validateThresholds } from "@orrn/domain";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.dispose());

const TOTAL = defaultReasonCodeRows().length;
const rowsOf = (companyId: string) => env.db.select().from(reasonCode).where(eq(reasonCode.companyId, companyId));

describe("reason codes: a new company has every kind", () => {
  test("approving a waiting request seeds all default codes of all kinds", async () => {
    const { id } = await env.caller(null).waitlist.submit({
      companyName: `Reasons ${crypto.randomUUID().slice(0, 8)}`,
      requesterName: "Requester",
      requesterEmail: `req.${crypto.randomUUID().slice(0, 8)}@test.orrn`,
    });
    const request = await env.db.select().from(waitlistRequest).where(eq(waitlistRequest.id, id)).get();
    expect(await rowsOf(request!.companyId!)).toHaveLength(0); // still pending: nothing yet
    await env.caller({ platformRole: "super_admin" }).platform.waitlistApprove({ id });
    const shell = await env.db.select().from(company).where(eq(company.id, request!.companyId!)).get();
    expect(shell?.status).toBe("active");
    const rows = await rowsOf(request!.companyId!);
    expect(rows).toHaveLength(TOTAL);
    for (const kind of REASON_CODE_KINDS) {
      expect(rows.filter((r) => r.kind === kind).map((r) => r.code).sort()).toEqual(DEFAULT_REASON_CODES[kind].map((r) => r.code).sort());
    }
    expect(rows.every((r) => r.active)).toBe(true);
    expect(rows.find((r) => r.kind === "downtime" && r.code === "other")?.requiresNote).toBe(true);
  });
});

describe("reason codes: ensure on first read for existing plants", () => {
  test("press.reasons on a plant with none gives the kind's defaults, in order, and adds the rest", async () => {
    const { companyId } = await env.seedCompany();
    expect(await rowsOf(companyId)).toHaveLength(0);
    const list = await env.caller({ role: "press", companyId }).press.reasons({ kind: "downtime" });
    expect(list.map((r) => r.code)).toEqual(DEFAULT_REASON_CODES.downtime.map((r) => r.code));
    expect(list.every((r) => r.id && r.label)).toBe(true);
    expect(await rowsOf(companyId)).toHaveLength(TOTAL);
  });

  test("a partial set gets only the missing codes; a renamed, deactivated or plant-added code is left alone", async () => {
    const { companyId, users } = await env.seedCompany();
    const mk = (kind: "downtime" | "void", code: string, label: string, over: Partial<typeof reasonCode.$inferInsert> = {}) => ({
      id: crypto.randomUUID(),
      companyId,
      kind,
      code,
      label,
      requiresNote: code === "other",
      sortOrder: 1,
      createdBy: users.owner.id,
      ...over,
    });
    await env.db.insert(reasonCode).values([
      mk("downtime", "die_change", "Die swap (our word)"),
      mk("downtime", "power", "Power cut", { active: false }),
      mk("downtime", "lunch", "Lunch", { sortOrder: 20 }),
      mk("void", "wrong_entry", "Wrong entry"),
    ]);
    const pressCaller = env.caller({ role: "press", companyId });
    const added = await pressCaller.press.reasons({ kind: "downtime", includeInactive: true });

    const rows = await rowsOf(companyId);
    // Defaults + the one code the plant added itself; none of the three default pairs it had is doubled.
    expect(rows).toHaveLength(TOTAL + 1);
    const pair = (kind: string, code: string) => rows.filter((r) => r.kind === kind && r.code === code);
    expect(pair("downtime", "die_change")).toHaveLength(1);
    expect(pair("downtime", "die_change")[0]!.label).toBe("Die swap (our word)");
    expect(pair("downtime", "power")).toHaveLength(1);
    expect(pair("downtime", "power")[0]!.active).toBe(false);
    expect(pair("downtime", "lunch")).toHaveLength(1);
    expect(pair("void", "wrong_entry")).toHaveLength(1);
    expect(pair("downtime", "billet_wait")).toHaveLength(1);
    expect(pair("reprint", "other")).toHaveLength(1);
    expect(added.map((r) => r.code)).toContain("power");

    // The picker hides the retired code; the plant-added one shows.
    const picker = await pressCaller.press.reasons({ kind: "downtime" });
    expect(picker.map((r) => r.code)).not.toContain("power");
    expect(picker.map((r) => r.code)).toContain("lunch");
    expect(picker.find((r) => r.code === "die_change")?.label).toBe("Die swap (our word)");
  });

  test("repeat and concurrent reads never duplicate (unique on company + kind + code)", async () => {
    const { companyId } = await env.seedCompany();
    const caller = env.caller({ role: "supervisor", companyId });
    await Promise.all([caller.press.reasons({ kind: "qc_reject" }), caller.press.reasons({ kind: "void" }), caller.press.reasons({ kind: "reprint" })]);
    await caller.press.reasons({ kind: "qc_reject" });
    await caller.press.reasons({ kind: "qc_reject" });
    const rows = await rowsOf(companyId);
    expect(rows).toHaveLength(TOTAL);
    expect(new Set(rows.map((r) => `${r.kind}:${r.code}`)).size).toBe(TOTAL);
  });

  test("ensureDefaultReasonCodes returns how many it added", async () => {
    const { ensureDefaultReasonCodes } = await import("../src/lib/reasonCodes");
    const { companyId } = await env.seedCompany();
    expect(await ensureDefaultReasonCodes(env.db, companyId)).toBe(TOTAL);
    expect(await ensureDefaultReasonCodes(env.db, companyId)).toBe(0);
  });

  test("one plant's codes never leak into another's", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    await env.caller({ role: "press", companyId: a.companyId }).press.reasons({ kind: "void" });
    expect(await rowsOf(b.companyId)).toHaveLength(0);
  });
});

describe("thresholds: domain rules (E1 drift 800/1000 bp, E3 recovery bands)", () => {
  test("green < amber, amber min < green min, 0-100 % each", () => {
    expect(validateThresholds({ drift: { greenMaxBp: 800, amberMaxBp: 1000 } })).toEqual([]);
    expect(validateThresholds({ drift: { greenMaxBp: 1000, amberMaxBp: 1000 } })).toEqual(["drift_order"]);
    expect(validateThresholds({ drift: { greenMaxBp: 1200, amberMaxBp: 1000 } })).toEqual(["drift_order"]);
    expect(validateThresholds({ drift: { greenMaxBp: -1, amberMaxBp: 1000 } })).toEqual(["drift_range"]);
    expect(validateThresholds({ drift: { greenMaxBp: 800, amberMaxBp: 10_001 } })).toEqual(["drift_range"]);
    expect(validateThresholds({ recoveryBands: { greenMinBp: 8000, amberMinBp: 7000 } })).toEqual([]);
    expect(validateThresholds({ recoveryBands: { greenMinBp: 7000, amberMinBp: 7000 } })).toEqual(["recovery_order"]);
    expect(validateThresholds({ recoveryBands: { greenMinBp: 10_001, amberMinBp: 7000 } })).toEqual(["recovery_range"]);
    expect(validateThresholds({ balanceWarnBp: 0 })).toEqual([]);
    expect(validateThresholds({ balanceWarnBp: 10_000 })).toEqual([]);
    expect(validateThresholds({ balanceWarnBp: 10_001 })).toEqual(["balance_range"]);
    expect(validateThresholds({ balanceWarnBp: 1.5 })).toEqual(["balance_range"]);
  });
});

describe("thresholds: company.updateSettings", () => {
  test("saves drift, recovery and balance warning; getSettings reads them; audit has old and new", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const before = await owner.company.getSettings();
    expect(before.drift).toEqual({ greenMaxBp: 800, amberMaxBp: 1000 });
    expect(before.recoveryBands).toBeNull();
    expect(before.press.balanceWarnBp).toBe(200);

    await owner.company.updateSettings({ driftGreenMaxBp: 700, driftAmberMaxBp: 900, recoveryBands: { greenMinBp: 8000, amberMinBp: 7000 }, pressBalanceWarnBp: 300 });
    const after = await owner.company.getSettings();
    expect(after.drift).toEqual({ greenMaxBp: 700, amberMaxBp: 900 });
    expect(after.recoveryBands).toEqual({ greenMinBp: 8000, amberMinBp: 7000 });
    expect(after.press.balanceWarnBp).toBe(300);
    // What the screens' tone helpers read.
    const floor = readFloorSettings((await env.db.select().from(company).where(eq(company.id, companyId)).get())!.settings);
    expect(floor.drift.greenMaxBp).toBe(700);

    const rows = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "company.settings.update")));
    expect(rows).toHaveLength(1);
    const meta = rows[0]!.meta as { changed: Record<string, unknown>; previous: Record<string, unknown> };
    expect(meta.changed).toMatchObject({ driftGreenMaxBp: 700, driftAmberMaxBp: 900, recoveryBands: { greenMinBp: 8000, amberMinBp: 7000 }, press: { balanceWarnBp: 300 } });
    expect(meta.previous).toMatchObject({ driftGreenMaxBp: null, driftAmberMaxBp: null, recoveryBands: null, press: null });
  });

  test("a changed drift band changes the tone the bundle checks use", async () => {
    const { driftTone } = await import("@orrn/domain");
    // 900 bp over the band start: amber on the defaults (800/1000), red once the plant tightens to 700/850.
    const input = { latestMilli: 109_000, bandStartMilli: 100_000 };
    expect(driftTone({ ...input, bands: { greenMaxBp: 800, amberMaxBp: 1000 } })).toBe("amber");
    expect(driftTone({ ...input, bands: { greenMaxBp: 700, amberMaxBp: 850 } })).toBe("red");
  });

  test("green must be below amber; one limit alone is checked against the stored other", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await expect(owner.company.updateSettings({ driftGreenMaxBp: 1000, driftAmberMaxBp: 1000 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/green drift limit must be below/) });
    await expect(owner.company.updateSettings({ driftAmberMaxBp: 500 })).rejects.toMatchObject({ code: "BAD_REQUEST" }); // stored green is 800
    await expect(owner.company.updateSettings({ driftGreenMaxBp: 1100 })).rejects.toMatchObject({ code: "BAD_REQUEST" }); // stored amber is 1000
    await expect(owner.company.updateSettings({ driftGreenMaxBp: 10_001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.company.updateSettings({ driftGreenMaxBp: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.company.updateSettings({ driftGreenMaxBp: 8.5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.company.updateSettings({ recoveryBands: { greenMinBp: 7000, amberMinBp: 7500 } })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/amber recovery minimum/) });
    await expect(owner.company.updateSettings({ pressBalanceWarnBp: 10_001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Nothing was stored by any refused call.
    expect((await owner.company.getSettings()).drift).toEqual({ greenMaxBp: 800, amberMaxBp: 1000 });
    expect(await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "company.settings.update")))).toHaveLength(0);
    // One limit alone is fine when it keeps the order.
    await owner.company.updateSettings({ driftAmberMaxBp: 1500 });
    expect((await owner.company.getSettings()).drift).toEqual({ greenMaxBp: 800, amberMaxBp: 1500 });
  });

  test("null clears the recovery bands (no colour); other press settings stay", async () => {
    const { companyId } = await env.seedCompany({ settings: { press: { balanceWarnBp: 250, other: 1 } } });
    const owner = env.caller({ role: "owner", companyId });
    await owner.company.updateSettings({ recoveryBands: { greenMinBp: 8000, amberMinBp: 7000 } });
    await owner.company.updateSettings({ recoveryBands: null });
    expect((await owner.company.getSettings()).recoveryBands).toBeNull();
    await owner.company.updateSettings({ pressBalanceWarnBp: 400 });
    const stored = (await env.db.select().from(company).where(eq(company.id, companyId)).get())!.settings as { press: Record<string, unknown> };
    expect(stored.press).toEqual({ balanceWarnBp: 400, other: 1 });
  });

  test("without settings.update the thresholds cannot be written (supervisor, press), the read still works", async () => {
    const { companyId } = await env.seedCompany();
    for (const role of ["supervisor", "press", "manager"] as const) {
      const caller = env.caller({ role, companyId });
      await expect(caller.company.updateSettings({ driftGreenMaxBp: 700 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await caller.company.getSettings()).drift.greenMaxBp).toBe(800);
    }
  });
});
