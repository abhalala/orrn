/**
 * FP-PF-07 bought modules (C42; platform spec §4 Modules, §6 Commercial switches and modules):
 * a mutation of a module that is off is FORBIDDEN at the router level, whatever the role allows;
 * empty list = all on; reads stay open (the die pick inside pack); Godseye validates + audits.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, company } from "@orrn/db/schema";
import { COMPANY_MODULES, type CompanyModule } from "@orrn/domain";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
let gate: typeof import("../src/lib/moduleGate");

beforeAll(async () => {
  env = await createTestEnv();
  gate = await import("../src/lib/moduleGate");
});

afterAll(async () => {
  await env.dispose();
});

const MSG = "That module is not on for this plant";

type Caller = ReturnType<TestEnv["caller"]>;
/** One mutation per gated router, called with an empty input (the gate runs before the input). */
const MUTATIONS: { module: CompanyModule; path: string; call: (c: Caller) => Promise<unknown> }[] = [
  { module: "customers", path: "customer.create", call: (c) => c.customer.create({} as never) },
  { module: "dies", path: "die.create", call: (c) => c.die.create({} as never) },
  { module: "dies", path: "dieInstance.addReading", call: (c) => c.dieInstance.addReading({} as never) },
  { module: "bundles", path: "bundle.createReceipt", call: (c) => c.bundle.createReceipt({} as never) },
  { module: "bundles", path: "count.start", call: (c) => c.count.start({} as never) },
  { module: "dispatches", path: "dispatch.create", call: (c) => c.dispatch.create({} as never) },
  { module: "dispatches", path: "packingList.create", call: (c) => c.packingList.create({} as never) },
  { module: "orders", path: "orders.create", call: (c) => c.orders.create({} as never) },
  { module: "foundry", path: "foundry.returnStreams.seedDefaults", call: (c) => c.foundry.returnStreams.seedDefaults() },
  { module: "store", path: "store.receive", call: (c) => c.store.receive({} as never) },
  { module: "purchase", path: "purchase.scrapItems.create", call: (c) => c.purchase.scrapItems.create({} as never) },
];

async function failure(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
}

describe("assertModule at the router level", () => {
  for (const m of MUTATIONS) {
    test(`${m.path}: FORBIDDEN when ${m.module} is off, even for the owner`, async () => {
      const others = COMPANY_MODULES.filter((x) => x !== m.module);
      const { companyId } = await env.seedCompany({ modules: [...others] });
      const e = await failure(m.call(env.caller({ role: "owner", companyId })));
      expect(e?.code).toBe("FORBIDDEN");
      expect(e?.message).toBe(MSG);
    });

    test(`${m.path}: not refused for the module when modules is empty (all on) or lists ${m.module}`, async () => {
      for (const modules of [[], [m.module]]) {
        const { companyId } = await env.seedCompany({ modules });
        const e = await failure(m.call(env.caller({ role: "owner", companyId })));
        // It goes on to the input / business rules; never the module refusal.
        expect(e?.message ?? "").not.toBe(MSG);
      }
    });
  }

  test("a real write passes with the module on and fails with it off", async () => {
    const on = await env.seedCompany({ modules: ["customers"] });
    const created = await env.caller({ role: "owner", companyId: on.companyId }).customer.create({ name: "Patel Traders" } as never);
    expect(created).toBeTruthy();
    const off = await env.seedCompany({ modules: ["dies"] });
    await expect(env.caller({ role: "owner", companyId: off.companyId }).customer.create({ name: "Patel Traders" } as never)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: MSG,
    });
  });

  test("reads stay open: the packer resolves dies with bundles on and dies off", async () => {
    const { companyId } = await env.seedCompany({ modules: ["bundles"] });
    await env.seedDie(companyId);
    const list = await env.caller({ role: "packer", companyId }).die.list({} as never);
    expect(list).toBeTruthy();
  });

  test("a module switched off applies on the next request", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await owner.customer.create({ name: "First" } as never);
    await env.db.update(company).set({ modules: ["dies"] }).where(eq(company.id, companyId));
    await expect(owner.customer.create({ name: "Second" } as never)).rejects.toMatchObject({ message: MSG });
  });

  test("the router map covers every gated module and later routers (press, ageing, plans)", () => {
    expect(gate.moduleForPath("press.runs.start")).toBe("press");
    expect(gate.moduleForPath("ageing.batches.load")).toBe("ageing");
    expect(gate.moduleForPath("plans.release")).toBe("orders");
    expect(gate.moduleForPath("company.updateSettings")).toBeNull();
    expect(gate.moduleForPath("dashboard.today")).toBeNull();
    expect(gate.moduleForPath("toString")).toBeNull();
    const covered = new Set(Object.values(gate.ROUTER_MODULE));
    for (const m of COMPANY_MODULES) expect({ m, covered: covered.has(m) }).toEqual({ m, covered: true });
  });

  test("assertModule helper: empty = all on; listed = on; missing = FORBIDDEN", async () => {
    const all = await env.seedCompany({ modules: [] });
    await gate.assertModule({ db: env.db, companyId: all.companyId }, "press");
    const some = await env.seedCompany({ modules: ["press"] });
    await gate.assertModule({ db: env.db, companyId: some.companyId }, "press");
    await expect(gate.assertModule({ db: env.db, companyId: some.companyId }, "ageing")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: MSG,
    });
  });
});

describe("platform.updatePlanAndModules (platform.companies.update)", () => {
  test("lower-cases and de-duplicates, refuses unknown keys, allows purchase (D6), audits the change", async () => {
    const { companyId } = await env.seedCompany();
    const staff = env.caller({ platformRole: "admin" });
    const res = await staff.platform.updatePlanAndModules({ companyId, plan: "growth", modules: ["Dies", "bundles", "dies", "purchase"] });
    expect(res.modules).toEqual(["dies", "bundles", "purchase"]);
    const row = await env.db.select({ modules: company.modules }).from(company).where(eq(company.id, companyId)).get();
    expect(row!.modules).toEqual(["dies", "bundles", "purchase"]);

    await expect(staff.platform.updatePlanAndModules({ companyId, plan: "growth", modules: ["dies", "payroll"] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Unknown module: payroll",
    });

    const audits = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "platform.company.modules.update")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({ from: [], to: ["dies", "bundles", "purchase"], planTo: "growth" });
    expect(audits[0]!.actorId).toBeTruthy();

    // No change = no audit row.
    await staff.platform.updatePlanAndModules({ companyId, plan: "growth", modules: ["dies", "bundles", "purchase"] });
    const again = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "platform.company.modules.update")));
    expect(again).toHaveLength(1);
  });

  test("plant roles cannot call it", async () => {
    const { companyId } = await env.seedCompany();
    await expect(
      env.caller({ role: "owner", companyId }).platform.updatePlanAndModules({ companyId, plan: "x", modules: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
