/**
 * FP-PF-07 bought modules (C42; platform spec §4 Modules, §6 Commercial switches and modules):
 * a mutation of a module that is off is FORBIDDEN at the router level, whatever the role allows;
 * empty list = all on; reads stay open (the die pick inside pack); Godseye validates + audits.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

import { approval, auditLog, company } from "@orrn/db/schema";
import { COMPANY_MODULES, isModuleOn, type CompanyModule } from "@orrn/domain";
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
  { module: "purchase", path: "vendor.create", call: (c) => c.vendor.create({} as never) },
  { module: "purchase", path: "vendor.merge", call: (c) => c.vendor.merge({} as never) },
  { module: "bundles", path: "stock.move", call: (c) => c.stock.move({} as never) },
  { module: "bundles", path: "stock.openingBalance", call: (c) => c.stock.openingBalance() },
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

  test("stock masters (locations) stay ungated: a store-only plant still keeps its yard list", async () => {
    const { companyId } = await env.seedCompany({ modules: ["store"] });
    const e = await failure(env.caller({ role: "owner", companyId }).stock.locations.seedDefaults());
    expect(e).toBeNull();
    expect(gate.moduleForPath("stock.locations.seedDefaults")).toBeNull();
    expect(gate.moduleForPath("stock.move")).toBe("bundles");
    expect(gate.moduleForPath("stock.balance")).toBeNull();
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

describe("approval.decide checks the module of the request's kind", () => {
  test("every approval kind maps to a module", async () => {
    const { approvalKinds } = await import("@orrn/db/schema");
    for (const k of approvalKinds) expect({ k, known: COMPANY_MODULES.includes(gate.APPROVAL_KIND_MODULE[k]) }).toEqual({ k, known: true });
    expect(gate.APPROVAL_KIND_MODULE.cast_close).toBe("foundry");
    expect(gate.APPROVAL_KIND_MODULE.dc_note).toBe("purchase");
    expect(gate.APPROVAL_KIND_MODULE.die_rerank).toBe("dies");
  });

  for (const [kind, module] of [
    ["cast_close", "foundry"],
    ["dc_note", "purchase"],
    ["die_rerank", "dies"],
  ] as const) {
    test(`${kind}: FORBIDDEN with ${module} off; the request stays pending; with it on the module is not the refusal`, async () => {
      const others = COMPANY_MODULES.filter((x) => x !== module);
      const off = await env.seedCompany({ modules: [...others] });
      const id = crypto.randomUUID();
      const requester = await env.seedUser("Requester");
      await env.db.insert(approval).values({ id, companyId: off.companyId, kind, subjectId: crypto.randomUUID(), requestedBy: requester } as never);
      const e = await failure(env.caller({ role: "owner", companyId: off.companyId }).approval.decide({ id, decision: "rejected" }));
      expect(e).toMatchObject({ code: "FORBIDDEN", message: MSG });
      expect((await env.db.select({ status: approval.status }).from(approval).where(eq(approval.id, id)).get())!.status).toBe("pending");

      const on = await env.seedCompany({ modules: [module] });
      const id2 = crypto.randomUUID();
      await env.db.insert(approval).values({ id: id2, companyId: on.companyId, kind, subjectId: crypto.randomUUID(), requestedBy: requester } as never);
      const e2 = await failure(env.caller({ role: "owner", companyId: on.companyId }).approval.decide({ id: id2, decision: "rejected" }));
      expect(e2?.message ?? "").not.toBe(MSG);
    });
  }
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

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/src/migrations");
const LEGACY_MODULES = ["customers", "dies", "bundles", "dispatches"];

describe("migration 0026_modules_all (D14): the old 4-key module list becomes [] (all on)", () => {
  test("0001-0026 on plants saved by the old Godseye form: legacy list -> []; real choices kept", async () => {
    const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"] });
    try {
      const d1 = await mf.getD1Database("DB");
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
      expect(files).toContain("0026_modules_all.sql");
      const apply = async (file: string) => {
        const statements = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
          .split("--> statement-breakpoint")
          .map((x) => x.trim())
          .filter(Boolean);
        await d1.batch(statements.map((x) => d1.prepare(x)));
      };
      for (const f of files.filter((f) => f < "0026")) await apply(f);
      const plants: [string, string[]][] = [
        ["legacy", LEGACY_MODULES],
        ["legacy-shuffled", ["dispatches", "bundles", "dies", "customers"]],
        ["all", []],
        ["subset", ["dies", "bundles"]],
        ["legacy-plus-orders", [...LEGACY_MODULES, "orders"]],
        ["legacy-with-duplicate", ["customers", "dies", "bundles", "bundles"]],
      ];
      await d1.batch(
        plants.map(([id, modules]) =>
          d1.prepare("insert into company (id, name, slug, modules) values (?, ?, ?, ?)").bind(id, id, id, JSON.stringify(modules)),
        ),
      );
      for (const f of files.filter((f) => f >= "0026")) await apply(f);

      const { results } = await d1.prepare("select id, modules from company").all<{ id: string; modules: string }>();
      const after = Object.fromEntries(results.map((r) => [r.id, JSON.parse(r.modules) as string[]]));
      expect(after).toEqual({
        legacy: [],
        "legacy-shuffled": [],
        all: [],
        subset: ["dies", "bundles"],
        "legacy-plus-orders": [...LEGACY_MODULES, "orders"],
        "legacy-with-duplicate": ["customers", "dies", "bundles", "bundles"],
      });
      // A migrated plant passes the gate for every module the new router gate checks.
      for (const m of COMPANY_MODULES) expect({ m, on: isModuleOn(after.legacy!, m) }).toEqual({ m, on: true });

      // The release.check index exists and device carries auth_session_id.
      const idx = await d1.prepare("select name from sqlite_master where type = 'index' and name = 'device_install_idx'").all();
      expect(idx.results).toHaveLength(1);
      const cols = await d1.prepare("select name from pragma_table_info('device')").all<{ name: string }>();
      expect(cols.results.map((c) => c.name)).toContain("auth_session_id");
    } finally {
      await mf.dispose();
    }
  });

  test("0026 only adds (columns, an index) and runs the one module UPDATE", () => {
    const text = readFileSync(join(MIGRATIONS_DIR, "0026_modules_all.sql"), "utf8");
    const statements = text.split("--> statement-breakpoint").map((x) => x.trim()).filter(Boolean);
    for (const st of statements) {
      expect(st).toMatch(/^(ALTER TABLE `[a-z_]+` ADD `[a-z_]+`|CREATE INDEX `[a-z_]+` ON |UPDATE `company` SET `modules` = '\[\]')/);
    }
    expect(statements.filter((st) => st.startsWith("UPDATE"))).toHaveLength(1);
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.find((e) => e.tag === "0026_modules_all")?.idx).toBe(26);
    const s26 = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/0026_snapshot.json"), "utf8")) as { prevId: string };
    const s25 = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/0025_snapshot.json"), "utf8")) as { id: string };
    expect(s26.prevId).toBe(s25.id);
  });
});
