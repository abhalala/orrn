/**
 * FP-PF-05 shifts + production day, FP-PF-06 commercial switches, FP-PF-09 standards, FP-PF-13
 * locale: `company.updateSettings` / `company.getSettings` / `company.standards` and the pure
 * `productionDayWindow` helper (platform spec §4 Settings, Shifts helper; §6 Production day).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { auditLog, bundle, company, pressRun } from "@orrn/db/schema";
import { and, eq, inArray } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
let dw: typeof import("../src/lib/dayWindow");
let clock: typeof import("../src/lib/clock");
let cs: typeof import("../src/lib/companySettings");

beforeAll(async () => {
  env = await createTestEnv();
  dw = await import("../src/lib/dayWindow");
  clock = await import("../src/lib/clock");
  cs = await import("../src/lib/companySettings");
});

afterAll(async () => {
  await env.dispose();
});

afterEach(() => {
  clock.setClockForTests(null);
});

const ist = (iso: string) => new Date(`${iso}+05:30`);
const DAY = { name: "Day", seq: 1, startMin: 8 * 60, endMin: 20 * 60 };
const NIGHT = { name: "Night", seq: 2, startMin: 20 * 60, endMin: 8 * 60 };

async function errorOf(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; message: string };
  }
  throw new Error("expected the call to fail");
}

describe("shift validation (FP-PF-05, C14): every rule refused with BAD_REQUEST", () => {
  const cases: { rule: string; shifts: { id?: string; name: string; seq: number; startMin: number; endMin: number }[]; message: RegExp }[] = [
    { rule: "zero shifts", shifts: [], message: /one to four shifts/ },
    {
      rule: "five shifts",
      shifts: [0, 1, 2, 3, 4].map((i) => ({ name: `S${i}`, seq: i + 1, startMin: i * 288, endMin: ((i + 1) * 288) % 1440 })),
      message: /one to four shifts/,
    },
    { rule: "duplicate names (case-insensitive)", shifts: [DAY, { ...NIGHT, name: "day" }], message: /same name/ },
    { rule: "seq not 1..n", shifts: [DAY, { ...NIGHT, seq: 3 }], message: /order must be 1, 2, 3, 4/ },
    { rule: "gap", shifts: [DAY, { ...NIGHT, startMin: 21 * 60 }], message: /20:00-21:00 uncovered/ },
    { rule: "overlap", shifts: [DAY, { ...NIGHT, startMin: 19 * 60, endMin: 9 * 60 }], message: /overlap/ },
    { rule: "zero-length shift among several", shifts: [DAY, { ...NIGHT, startMin: 600, endMin: 600 }], message: /start and end at the same time/ },
    { rule: "one shift that is not the whole day", shifts: [DAY], message: /uncovered/ },
    { rule: "duplicate ids", shifts: [{ ...DAY, id: "same" }, { ...NIGHT, id: "same" }], message: /own id/ },
  ];
  for (const c of cases) {
    test(c.rule, async () => {
      const { companyId } = await env.seedCompany();
      const e = await errorOf(env.caller({ role: "owner", companyId }).company.updateSettings({ shifts: c.shifts }));
      expect(e.code).toBe("BAD_REQUEST");
      expect(e.message).toMatch(c.message);
    });
  }

  test("a name over 40 characters is refused by the input", async () => {
    const { companyId } = await env.seedCompany();
    const e = await errorOf(
      env.caller({ role: "owner", companyId }).company.updateSettings({ shifts: [{ ...DAY, name: "x".repeat(41) }, NIGHT] }),
    );
    expect(e.code).toBe("BAD_REQUEST");
  });

  test("valid: Day/Night touching at 08:00 and 20:00; one whole-day shift; three shifts; ids are issued", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const res = await owner.company.updateSettings({ shifts: [DAY, NIGHT] });
    const saved = res.settings.shifts as { id: string; name: string }[];
    expect(saved.map((s) => s.name)).toEqual(["Day", "Night"]);
    for (const s of saved) expect(s.id).toMatch(/[0-9a-f-]{36}/);
    await owner.company.updateSettings({ shifts: [{ name: "All day", seq: 1, startMin: 360, endMin: 360 }] });
    await owner.company.updateSettings({
      shifts: [
        { name: "A", seq: 1, startMin: 360, endMin: 840 },
        { name: "B", seq: 2, startMin: 840, endMin: 1320 },
        { name: "C", seq: 3, startMin: 1320, endMin: 360 },
      ],
    });
    expect((await owner.company.getSettings()).shifts.map((s) => s.name)).toEqual(["A", "B", "C"]);
  });

  test("rename and reorder keep ids; deleting a shift a press run cites is refused; an unused one may go", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const first = (await owner.company.updateSettings({ shifts: [DAY, NIGHT] })).settings.shifts as { id: string }[];
    const [dayId, nightId] = [first[0]!.id, first[1]!.id];

    // Rename Night and make it seq 1: ids unchanged.
    const renamed = (
      await owner.company.updateSettings({
        shifts: [
          { id: dayId, name: "Day", seq: 2, startMin: 480, endMin: 1200 },
          { id: nightId, name: "Raat", seq: 1, startMin: 1200, endMin: 480 },
        ],
      })
    ).settings.shifts as { id: string; name: string; seq: number }[];
    expect(renamed.find((s) => s.id === nightId)).toMatchObject({ name: "Raat", seq: 1 });

    const dieId = await env.seedDie(companyId);
    await env.db.insert(pressRun).values({
      id: crypto.randomUUID(),
      companyId,
      number: "PR-1",
      period: "2026-27",
      sectionId: dieId,
      shiftId: nightId,
    });
    const e = await errorOf(owner.company.updateSettings({ shifts: [{ id: dayId, name: "Day", seq: 1, startMin: 0, endMin: 0 }] }));
    expect(e.code).toBe("BAD_REQUEST");
    expect(e.message).toContain("Raat has press runs");

    // Day has no run: replacing it with a whole-day Night is fine.
    await owner.company.updateSettings({ shifts: [{ id: nightId, name: "Raat", seq: 1, startMin: 0, endMin: 0 }] });
    expect((await owner.company.getSettings()).shifts.map((s) => s.id)).toEqual([nightId]);
  });

  test("settings.update is owner and admin only (C41)", async () => {
    const { companyId } = await env.seedCompany();
    for (const role of ["manager", "office", "supervisor", "viewer"] as const) {
      const e = await errorOf(env.caller({ role, companyId }).company.updateSettings({ shifts: [DAY, NIGHT] }));
      expect(e.code).toBe("FORBIDDEN");
    }
    await env.caller({ role: "admin", companyId }).company.updateSettings({ shifts: [DAY, NIGHT] });
  });
});

describe("production day (C15) in Asia/Kolkata", () => {
  const settings = {
    timezone: "Asia/Kolkata",
    shifts: [
      { id: "d", ...DAY },
      { id: "n", ...NIGHT },
    ],
  };

  test("no shifts: calendar midnight to midnight", () => {
    const w = dw.productionDayWindow({ timezone: "Asia/Kolkata" }, ist("2026-10-24T02:00:00").getTime());
    expect(w.productionDay).toBe("2026-10-24");
    expect(w.shiftsSet).toBe(false);
    expect(w.shift).toBeNull();
    expect(new Date(w.startMs).toISOString()).toBe(ist("2026-10-24T00:00:00").toISOString());
    expect(new Date(w.endMs).toISOString()).toBe(ist("2026-10-25T00:00:00").toISOString());
    expect(w).toMatchObject(dw.dayWindow("Asia/Kolkata", ist("2026-10-24T02:00:00").getTime()));
  });

  test("before shift 1 starts (24 Oct 02:00) = production day 23 Oct, Night; window 23 Oct 08:00 -> 24 Oct 08:00", () => {
    const w = dw.productionDayWindow(settings, ist("2026-10-24T02:00:00").getTime());
    expect(w.productionDay).toBe("2026-10-23");
    expect(w.shift).toEqual({ id: "n", name: "Night", seq: 2 });
    expect(new Date(w.startMs).toISOString()).toBe(ist("2026-10-23T08:00:00").toISOString());
    expect(new Date(w.endMs).toISOString()).toBe(ist("2026-10-24T08:00:00").toISOString());
  });

  test("at and after shift 1 starts (24 Oct 08:00, 21:30) = production day 24 Oct", () => {
    const at8 = dw.productionDayWindow(settings, ist("2026-10-24T08:00:00").getTime());
    expect(at8.productionDay).toBe("2026-10-24");
    expect(at8.shift?.name).toBe("Day");
    expect(new Date(at8.startMs).toISOString()).toBe(ist("2026-10-24T08:00:00").toISOString());
    const at2130 = dw.productionDayWindow(settings, ist("2026-10-24T21:30:00").getTime());
    expect(at2130.productionDay).toBe("2026-10-24");
    expect(at2130.shift?.name).toBe("Night");
    expect(at2130.endMs).toBe(ist("2026-10-25T08:00:00").getTime());
  });

  test("one minute before the boundary belongs to yesterday; month and year edges roll back", () => {
    expect(dw.productionDayWindow(settings, ist("2026-10-24T07:59:00").getTime()).productionDay).toBe("2026-10-23");
    expect(dw.productionDayWindow(settings, ist("2026-11-01T03:00:00").getTime()).productionDay).toBe("2026-10-31");
    expect(dw.productionDayWindow(settings, ist("2027-01-01T03:00:00").getTime()).productionDay).toBe("2026-12-31");
  });

  test("a stored list that breaks the rules is ignored (calendar midnight), never half-applied", () => {
    const broken = { timezone: "Asia/Kolkata", shifts: [{ id: "d", ...DAY }] };
    const w = dw.productionDayWindow(broken, ist("2026-10-24T02:00:00").getTime());
    expect(w.shiftsSet).toBe(false);
    expect(w.productionDay).toBe("2026-10-24");
  });

  test("Today: a bundle at 02:00 counts in yesterday's production day; a shift change applies from the next read only", async () => {
    const { companyId } = await env.seedCompany({ settings: { timezone: "Asia/Kolkata" } });
    const owner = env.caller({ role: "owner", companyId });
    const manager = env.caller({ role: "manager", companyId });
    const dieId = await env.seedDie(companyId);
    const [early, late] = await env.seedBundles(companyId, dieId, 2);
    await env.db.update(bundle).set({ createdAt: ist("2026-10-24T02:00:00") }).where(eq(bundle.id, early!.id));
    await env.db.update(bundle).set({ createdAt: ist("2026-10-24T09:00:00") }).where(eq(bundle.id, late!.id));

    clock.setClockForTests(ist("2026-10-24T10:00:00"));
    // No shifts: calendar day 24 Oct holds both.
    let today = await manager.dashboard.today();
    expect(today.date).toBe("2026-10-24");
    expect(today.productionDay.shiftsSet).toBe(false);
    expect(today.packedToday.bundles).toBe(2);

    // Shifts saved: the very next read uses 08:00 -> 08:00; the 02:00 bundle is yesterday's.
    await owner.company.updateSettings({ shifts: [DAY, NIGHT] });
    today = await manager.dashboard.today();
    expect(today.productionDay).toMatchObject({ day: "2026-10-24", shiftsSet: true, shift: { name: "Day", seq: 1 } });
    expect(today.packedToday.bundles).toBe(1);

    // At 03:00 on the 25th it is still production day 24 Oct (Night).
    clock.setClockForTests(ist("2026-10-25T03:00:00"));
    today = await manager.dashboard.today();
    expect(today.date).toBe("2026-10-24");
    expect(today.productionDay.shift?.name).toBe("Night");
    expect(today.packedToday.bundles).toBe(1);
  });

  test("the Today trend ends on the production day, so its so-far day is the KPI blocks' day", async () => {
    const { companyId } = await env.seedCompany({ settings: { timezone: "Asia/Kolkata" } });
    const owner = env.caller({ role: "owner", companyId });
    await owner.company.updateSettings({ shifts: [DAY, NIGHT] });
    // 03:00 on the 25th: still production day 24 Oct (Night shift past midnight).
    clock.setClockForTests(ist("2026-10-25T03:00:00"));
    const [today, days] = await Promise.all([owner.dashboard.today(), owner.analytics.trends({ days: 7 })]);
    expect(today.date).toBe("2026-10-24");
    expect(days.at(-1)?.date).toBe(today.date);
    expect(days).toHaveLength(7);
    // After the day shift starts the production day and the calendar day agree again.
    clock.setClockForTests(ist("2026-10-25T08:30:00"));
    expect((await owner.analytics.trends({ days: 7 })).at(-1)?.date).toBe("2026-10-25");
  });
});

describe("commercial switches, standards, locale, cast series (FP-PF-06/09/13)", () => {
  test("defaults: bands on, price off, die required on, portal off, locale en, no standards", async () => {
    const { companyId } = await env.seedCompany();
    const s = await env.caller({ role: "viewer", companyId }).company.getSettings();
    expect(s).toMatchObject({
      dieBands: true,
      priceOnSalesOrder: false,
      dieRequiredOnSalesOrder: true,
      portalEnabled: false,
      requireCastOnBundle: null,
      locale: "en",
      standards: {},
      shifts: [],
      castSeriesStart: null,
      modules: [],
      timezone: "Asia/Kolkata",
    });
    expect(JSON.stringify(s)).not.toMatch(/spoolApiKey|r2Key|wrapped/i);
  });

  test("switches and locale gu save, audit { changed, previous } for the patched keys only", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await owner.company.updateSettings({
      priceOnSalesOrder: true,
      dieRequiredOnSalesOrder: false,
      portalEnabled: true,
      dieBands: false,
      requireCastOnBundle: true,
      locale: "gu",
    });
    const s = await owner.company.getSettings();
    expect(s).toMatchObject({
      priceOnSalesOrder: true,
      dieRequiredOnSalesOrder: false,
      portalEnabled: true,
      dieBands: false,
      requireCastOnBundle: true,
      locale: "gu",
    });
    const [row] = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "company.settings.update")));
    expect(row!.meta).toMatchObject({
      changed: { priceOnSalesOrder: true, locale: "gu", portalEnabled: true },
      previous: { priceOnSalesOrder: null, locale: null },
    });
    expect(Object.keys((row!.meta as { changed: object }).changed).sort()).toEqual(
      ["dieBands", "dieRequiredOnSalesOrder", "locale", "portalEnabled", "priceOnSalesOrder", "requireCastOnBundle"].sort(),
    );
    await expect(owner.company.updateSettings({ locale: "fr" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("support contact (FP-PF-14): name, phone, hours merge into settings.support; blank clears one; the stored email stays; audited old -> new", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await owner.company.updateSettings({ support: { name: "  Lalu uncle ", phone: "+91 98250 00000", hours: "Mon-Sat, 9 to 6" } });
    const stored = async () =>
      ((await env.db.select({ s: company.settings }).from(company).where(eq(company.id, companyId)).get())!.s as Record<string, unknown>).support;
    expect(await stored()).toEqual({ name: "Lalu uncle", phone: "+91 98250 00000", hours: "Mon-Sat, 9 to 6" });

    // Staff-written email survives an edit; a blank field clears only that field.
    await env.db
      .update(company)
      .set({ settings: { support: { name: "Lalu uncle", phone: "+91 98250 00000", hours: "Mon-Sat, 9 to 6", email: "help@plant.test" } } })
      .where(eq(company.id, companyId));
    await owner.company.updateSettings({ support: { hours: "" } });
    expect(await stored()).toEqual({ name: "Lalu uncle", phone: "+91 98250 00000", hours: null, email: "help@plant.test" });

    const rows = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "company.settings.update")));
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => "support" in (r.meta as { changed: object }).changed)).toBe(true);

    await expect(owner.company.updateSettings({ support: { name: "x".repeat(101) } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.company.updateSettings({ support: { phone: "x".repeat(41) } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(env.caller({ role: "manager", companyId }).company.updateSettings({ support: { name: "Me" } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("standards: partial update, a blank pair clears it, over 40 characters refused", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await owner.company.updateSettings({
      standards: { solid: { standard: "IS 733", cml: "CM/L-1234567" }, hollow: { standard: "IS 1285", cml: "" } },
    });
    await owner.company.updateSettings({ standards: { semi: { standard: "IS 733 semi", cml: "" } } });
    let s = await owner.company.getSettings();
    expect(Object.keys(s.standards).sort()).toEqual(["hollow", "semi", "solid"]);
    await owner.company.updateSettings({ standards: { semi: { standard: "", cml: "" } } });
    s = await owner.company.getSettings();
    expect(Object.keys(s.standards).sort()).toEqual(["hollow", "solid"]);
    await expect(
      owner.company.updateSettings({ standards: { solid: { standard: "x".repeat(41), cml: "" } } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("standards resolution: semi falls back to solid, null kind uses solid, blank CM/L omits the licence line", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await owner.company.updateSettings({
      standards: { solid: { standard: "IS 733", cml: "CM/L-7654321" }, hollow: { standard: "IS 1285", cml: "" } },
    });
    const res = await env.caller({ role: "packer", companyId }).company.standards();
    expect(res.resolved.solid).toEqual({ standard: "IS 733", cml: "CM/L-7654321" });
    expect(res.resolved.semi).toEqual({ standard: "IS 733", cml: "CM/L-7654321" });
    expect(res.resolved.unknown).toEqual({ standard: "IS 733", cml: "CM/L-7654321" });
    expect(res.resolved.hollow).toEqual({ standard: "IS 1285", cml: null });

    // A semi pair of its own wins over solid.
    await owner.company.updateSettings({ standards: { semi: { standard: "IS 733 (semi)", cml: "" } } });
    expect((await owner.company.standards()).resolved.semi).toEqual({ standard: "IS 733 (semi)", cml: null });

    // Nothing set: nothing to print.
    const empty = await env.seedCompany();
    const none = await env.caller({ role: "owner", companyId: empty.companyId }).company.standards();
    expect(none.resolved.solid).toEqual({ standard: null, cml: null });
    expect(cs.standardFor({ solid: { standard: "IS 733", cml: "   " } } as never, "semi")).toEqual({ standard: "IS 733", cml: null });
  });

  test("castSeriesStart: saved for a month with no cast, refused once that month has one", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await owner.company.updateSettings({ castSeriesStart: { period: "2026-11", start: 31 } });
    expect((await owner.company.getSettings()).castSeriesStart).toEqual({ period: "2026-11", start: 31 });
    await expect(owner.company.updateSettings({ castSeriesStart: { period: "2026-13", start: 1 } })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const { cast } = await import("@orrn/db/schema");
    await env.db.insert(cast).values({
      id: crypto.randomUUID(),
      companyId,
      number: "K1",
      period: "2026-10",
      year: 2026,
      month: 10,
      seq: 1,
      alloy: "6063",
      openedAt: new Date(),
    } as never);
    const e = await errorOf(owner.company.updateSettings({ castSeriesStart: { period: "2026-10", start: 40 } }));
    expect(e.message).toContain("already has a cast");
  });
});

describe("migration 0025 is additive", () => {
  test("only ALTER TABLE … ADD statements; 0023 untouched", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/src/migrations");
    const sqlText = readFileSync(join(dir, "0025_platform_wave1.sql"), "utf8");
    const statements = sqlText.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) expect(s).toMatch(/^ALTER TABLE `[a-z_]+` ADD `[a-z_]+`/);
  });

  test("press runs untouched by a settings save (no rows rewritten)", async () => {
    const { companyId } = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const id = crypto.randomUUID();
    await env.db.insert(pressRun).values({ id, companyId, number: "PR-9", period: "2026-27", sectionId: dieId, shiftId: "old" });
    await env.caller({ role: "owner", companyId }).company.updateSettings({ shifts: [DAY, NIGHT] });
    const rows = await env.db.select({ shiftId: pressRun.shiftId }).from(pressRun).where(inArray(pressRun.id, [id]));
    expect(rows[0]!.shiftId).toBe("old");
  });
});
