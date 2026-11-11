/**
 * Units layer, slice b: the plant's unit settings. `company.updateSettings({ units })` (the same
 * `settings.update` guard as every company setting), `company.getSettings` and the resolved set that rides
 * in `auth.me`. A plant that changed nothing resolves to the orrn default set.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, company } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

async function errorOf(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; message: string };
  }
  throw new Error("expected the call to fail");
}

async function storedSettings(companyId: string): Promise<Record<string, unknown>> {
  const row = await env.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).get();
  return (row?.settings ?? {}) as Record<string, unknown>;
}

describe("a plant that changed nothing", () => {
  test("auth.me carries the default set: kg, mm, kg/12ft, Indian grouping, dmy, 24 hour", async () => {
    const { companyId } = await env.seedCompany();
    const me = await env.caller({ role: "viewer", companyId }).auth.me();
    const u = me.company?.units;
    expect(u?.units.mass).toBe("kg");
    expect(u?.units.length).toBe("mm");
    expect(u?.units.linear_mass).toBe("kg_12ft");
    expect(u?.number).toEqual({ grouping: "indian", decimal: ".", group: "," });
    expect(u?.date.order).toBe("dmy");
    expect(u?.clock).toBe("h23");
  });

  test("an inch plant (legacy lengthUnit) resolves to feet and inches without any units block", async () => {
    const { companyId } = await env.seedCompany({ settings: { lengthUnit: "inch" } });
    const me = await env.caller({ role: "viewer", companyId }).auth.me();
    expect(me.company?.units?.units.length).toBe("ft_in");
    expect(me.company?.units?.inchGrid).toBe(4);
  });

  test("junk in the stored block falls back to the default", async () => {
    const { companyId } = await env.seedCompany({ settings: { units: { units: { mass: "furlong" }, clock: 7 } } });
    const me = await env.caller({ role: "viewer", companyId }).auth.me();
    expect(me.company?.units?.units.mass).toBe("kg");
    expect(me.company?.units?.clock).toBe("h23");
  });
});

describe("who may change the units", () => {
  const choice = { units: { mass: "lb", length: "mm" }, number: { grouping: "international" }, clock: "h12" };

  test("owner and admin write; the resolved set follows", async () => {
    const { companyId } = await env.seedCompany();
    await env.caller({ role: "owner", companyId }).company.updateSettings({ units: choice });
    const me = await env.caller({ role: "viewer", companyId }).auth.me();
    expect(me.company?.units?.units.mass).toBe("lb");
    expect(me.company?.units?.number.grouping).toBe("international");
    expect(me.company?.units?.clock).toBe("h12");
    await env.caller({ role: "admin", companyId }).company.updateSettings({ units: { units: { mass: "t", length: "m" } } });
    const again = await env.caller({ role: "viewer", companyId }).auth.me();
    expect(again.company?.units?.units.mass).toBe("t");
    expect(again.company?.units?.units.length).toBe("m");
    // Keys not sent stay: the number style and the clock of the first write.
    expect(again.company?.units?.number.grouping).toBe("international");
    expect(again.company?.units?.clock).toBe("h12");
  });

  for (const role of ["manager", "supervisor", "operator", "packer", "viewer"] as const) {
    test(`${role} is refused and nothing is written`, async () => {
      const { companyId } = await env.seedCompany();
      const e = await errorOf(env.caller({ role, companyId }).company.updateSettings({ units: choice }));
      expect(e.code).toBe("FORBIDDEN");
      expect((await storedSettings(companyId)).units).toBeUndefined();
    });
  }

  test("a write names its audit row with the old and the new block", async () => {
    const { companyId } = await env.seedCompany();
    await env.caller({ role: "owner", companyId }).company.updateSettings({ units: choice });
    const rows = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "company.settings.update")));
    expect(rows.length).toBe(1);
    const meta = rows[0]!.meta as { changed: Record<string, unknown>; previous: Record<string, unknown> };
    expect(Object.keys(meta.changed)).toContain("units");
    expect(meta.previous.units).toBeNull();
  });
});

describe("another plant is never touched", () => {
  test("a write in one plant leaves the other on the default; each sees only its own set", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    await env.caller({ role: "owner", companyId: a.companyId }).company.updateSettings({ units: { units: { mass: "lb" } } });
    const meA = await env.caller({ role: "viewer", companyId: a.companyId }).auth.me();
    const meB = await env.caller({ role: "viewer", companyId: b.companyId }).auth.me();
    expect(meA.company?.units?.units.mass).toBe("lb");
    expect(meB.company?.units?.units.mass).toBe("kg");
    expect((await storedSettings(b.companyId)).units).toBeUndefined();
    const sB = await env.caller({ role: "viewer", companyId: b.companyId }).company.getSettings();
    expect(sB.resolvedUnits.units.mass).toBe("kg");
  });

  test("a caller of one plant cannot name a company id in the input to reach another", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    // The input has no company id; a stray one is dropped by zod, the write lands on the caller's plant.
    const input = { units: { units: { mass: "lb" } }, companyId: b.companyId } as never;
    await env.caller({ role: "owner", companyId: a.companyId }).company.updateSettings(input);
    expect((await storedSettings(b.companyId)).units).toBeUndefined();
    expect((await storedSettings(a.companyId)).units).toBeDefined();
  });
});

describe("bad values are refused with BAD_REQUEST and nothing is written", () => {
  const bad: { what: string; units: Record<string, unknown>; message: RegExp }[] = [
    { what: "an unknown unit", units: { units: { mass: "furlong" } }, message: /unknown unit furlong/ },
    { what: "a unit of another kind", units: { units: { mass: "mm" } }, message: /not a unit of mass/ },
    { what: "an unknown kind", units: { units: { weight: "kg" } }, message: /unknown kind weight/ },
    { what: "a registry unit this release does not offer", units: { units: { mass: "quintal" } }, message: /quintal is not offered for mass/ },
    { what: "a display-only unit", units: { units: { mass: "g", length: "um" } }, message: /not offered/ },
    { what: "a unit for a kind that stays on its default", units: { units: { temperature: "f" } }, message: /f is not offered for temperature/ },
    { what: "a bad grouping", units: { number: { grouping: "lakh" } }, message: /bad number.grouping/ },
    { what: "the same mark for decimal and group", units: { number: { decimal: ",", group: "," } }, message: /must differ/ },
    { what: "a bad clock", units: { clock: "h24" }, message: /clock must be/ },
    { what: "a bad date order", units: { date: { order: "ydm" } }, message: /./ },
    { what: "a bad inch grid", units: { inchGrid: 3 }, message: /inchGrid/ },
    { what: "a lock (next release)", units: { lock: ["mass"] }, message: /locking a unit is not offered/ },
    { what: "document units (next release)", units: { documents: { packing_list: { units: { mass: "lb" } } } }, message: /document units/ },
    { what: "a block over 2 kB", units: { number: { grouping: "indian" }, pad: "x".repeat(3000) }, message: /over 2048 bytes/ },
  ];
  for (const c of bad) {
    test(c.what, async () => {
      const { companyId } = await env.seedCompany();
      const e = await errorOf(env.caller({ role: "owner", companyId }).company.updateSettings({ units: c.units }));
      expect(e.code).toBe("BAD_REQUEST");
      if (c.what !== "a bad date order") expect(e.message).toMatch(c.message);
      expect((await storedSettings(companyId)).units).toBeUndefined();
    });
  }

  test("an array or a string for units is refused by the input", async () => {
    const { companyId } = await env.seedCompany();
    for (const units of [["kg"], "kg", 7] as never[]) {
      const e = await errorOf(env.caller({ role: "owner", companyId }).company.updateSettings({ units }));
      expect(e.code).toBe("BAD_REQUEST");
    }
  });

  test("a refused write keeps what the plant had", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await owner.company.updateSettings({ units: { units: { mass: "lb" } } });
    await errorOf(owner.company.updateSettings({ units: { units: { mass: "furlong" } } }));
    const me = await env.caller({ role: "viewer", companyId }).auth.me();
    expect(me.company?.units?.units.mass).toBe("lb");
  });
});

describe("the legacy length unit stays true for the phone", () => {
  test("choosing feet and inches writes lengthUnit inch; mm and m write mm", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await owner.company.updateSettings({ units: { units: { length: "ft_in" } } });
    expect((await storedSettings(companyId)).lengthUnit).toBe("inch");
    await owner.company.updateSettings({ units: { units: { length: "m" } } });
    expect((await storedSettings(companyId)).lengthUnit).toBe("mm");
    await owner.company.updateSettings({ units: { units: { length: "mm" } } });
    expect((await storedSettings(companyId)).lengthUnit).toBe("mm");
  });

  test("the Company tab switch (lengthUnit alone) moves the stored length choice", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await owner.company.updateSettings({ units: { units: { mass: "lb", length: "m" } } });
    await owner.company.updateSettings({ lengthUnit: "inch" });
    const me = await env.caller({ role: "viewer", companyId }).auth.me();
    expect(me.company?.units?.units.length).toBe("ft_in");
    expect(me.company?.units?.units.mass).toBe("lb");
  });

  test("a plant on the legacy key only keeps feet and inches when it saves a number style", async () => {
    const { companyId } = await env.seedCompany({ settings: { lengthUnit: "inch" } });
    await env.caller({ role: "owner", companyId }).company.updateSettings({ units: { number: { grouping: "international" } } });
    const me = await env.caller({ role: "viewer", companyId }).auth.me();
    expect(me.company?.units?.units.length).toBe("ft_in");
    expect(me.company?.units?.number.grouping).toBe("international");
    expect((await storedSettings(companyId)).lengthUnit).toBe("inch");
  });
});

describe("getSettings", () => {
  test("returns the plant's own block and the resolved set", async () => {
    const { companyId } = await env.seedCompany();
    await env.caller({ role: "owner", companyId }).company.updateSettings({ units: { units: { linear_mass: "lb_ft" } } });
    const s = await env.caller({ role: "viewer", companyId }).company.getSettings();
    expect(s.units.units?.linear_mass).toBe("lb_ft");
    expect(s.resolvedUnits.units.linear_mass).toBe("lb_ft");
    expect(s.resolvedUnits.units.mass).toBe("kg");
  });
});
