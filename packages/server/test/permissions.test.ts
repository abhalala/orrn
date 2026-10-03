import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  auditLog,
  bundle,
  bundleGroup,
  bundleStatusEvent,
  customer,
  die,
  dispatch,
  dispatchItem,
  packingList,
  packingListLine,
} from "@orrn/db/schema";
import { eq, inArray } from "drizzle-orm";

import { can, type Action } from "../src/lib/permissions";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

// The five original roles plus the plant roles (spec P9). Allowed/denied comes from can();
// plant-roles.test.ts pins the matrix itself.
const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];

type Api = ReturnType<TestEnv["caller"]>;

type Fx = {
  companyId: string;
  owner: Api;
  dieId: string;
  customerId: string;
  bundles: { id: string; serial: string }[];
  /** draft dispatch holding bundles[0]. */
  draft(): Promise<string>;
  /** reserved dispatch holding bundles[0]. */
  reserved(): Promise<string>;
  /** completed dispatch (packing list auto-created); returns both ids. */
  completed(): Promise<{ dispatchId: string; plId: string }>;
};

async function fixture(): Promise<Fx> {
  const { companyId } = await env.seedCompany();
  const owner = env.caller({ role: "owner", companyId });
  const dieId = await env.seedDie(companyId);
  const customerId = await env.seedCustomer(companyId);
  const bundles = await env.seedBundles(companyId, dieId, 3);
  const draft = async () => {
    const { id } = await owner.dispatch.create({ customerId });
    await owner.dispatch.addBundle({ id, bundleId: bundles[0]!.id });
    return id;
  };
  const reserved = async () => {
    const id = await draft();
    await owner.dispatch.reserve({ id });
    return id;
  };
  const completed = async () => {
    const dispatchId = await reserved();
    await owner.dispatch.complete({ id: dispatchId });
    const pl = await owner.packingList.byDispatch({ dispatchId });
    return { dispatchId, plId: pl!.id };
  };
  return { companyId, owner, dieId, customerId, bundles, draft, reserved, completed };
}

const dieRow = (code: string) => ({ series: "P", sectionCode: code, weightMinG: 1_000, weightMaxG: 2_000 });

type Case = {
  name: string;
  action: Action;
  /** validateImport only reports duplicates; an allowed call changes no rows. */
  readOnly?: boolean;
  /** Runs as the owner to arrange state; returns what `run` needs. */
  prep(fx: Fx): Promise<unknown>;
  run(api: Api, arg: never, fx: Fx): Promise<unknown>;
};

// Typed helper so each case keeps its own `prep` -> `run` argument type.
function c<A>(
  name: string,
  action: Action,
  prep: (fx: Fx) => Promise<A>,
  run: (api: Api, arg: A, fx: Fx) => Promise<unknown>,
): Case {
  return { name, action, prep, run: run as Case["run"] };
}

const CASES: Case[] = [
  c("customer.create", "customer.create", async () => null, (api) => api.customer.create({ name: "New Cust" })),
  c("customer.update", "customer.update", async (fx) => fx.customerId, (api, id) =>
    api.customer.update({ id, name: "Renamed" }),
  ),
  c("customer.delete", "customer.delete", async (fx) => fx.customerId, (api, id) => api.customer.delete({ id })),
  c("customer.importCsv", "customer.import", async () => null, (api) =>
    api.customer.importCsv([{ name: "Imp A" }, { name: "Imp B" }]),
  ),

  c("die.create", "die.create", async () => null, (api) => api.die.create(dieRow("C1"))),
  c("die.update", "die.update", async (fx) => fx.dieId, (api, id) =>
    api.die.update({ ...dieRow("U1"), id, dimensions: {}, status: "active" }),
  ),
  c("die.delete", "die.delete", async (fx) => env.seedDie(fx.companyId), (api, id) => api.die.delete({ id })),
  {
    ...c("die.validateImport", "die.import", async () => null, (api) => api.die.validateImport([dieRow("V1")])),
    readOnly: true,
  },
  c("die.processImport", "die.import", async () => null, (api) =>
    api.die.processImport({ newRows: [dieRow("I1")], updatedRows: [] }),
  ),

  c("bundle.createReceipt", "bundle.create", async (fx) => fx.dieId, (api, dieId) =>
    api.bundle.createReceipt({ dieId, unit: "pcs", rows: [{ quantity: 10, weightG: 25_000, lengthMm: 3_000 }] }),
  ),
  c("bundle.transitionStatus", "bundle.transition", async (fx) => fx.bundles[0]!.id, (api, id) =>
    api.bundle.transitionStatus({ id, toStatus: "void" }),
  ),
  c("bundle.bulkImport", "bundle.import", async () => null, (api) =>
    api.bundle.bulkImport({
      rows: [{ dieSeries: "BI", dieSectionCode: "X1", quantity: 10, weightG: 25_000, lengthMm: 3_000 }],
    }),
  ),

  c("dispatch.create", "dispatch.create", async (fx) => fx.customerId, (api, customerId) =>
    api.dispatch.create({ customerId }),
  ),
  c("dispatch.update", "dispatch.update", async (fx) => (await fx.owner.dispatch.create({ customerId: fx.customerId })).id,
    (api, id) => api.dispatch.update({ id, notes: "edited" }),
  ),
  c("dispatch.addBundle", "dispatch.addBundle",
    async (fx) => (await fx.owner.dispatch.create({ customerId: fx.customerId })).id,
    (api, id, fx) => api.dispatch.addBundle({ id, bundleId: fx.bundles[0]!.id }),
  ),
  c("dispatch.addBundlesBySerial", "dispatch.addBundle",
    async (fx) => (await fx.owner.dispatch.create({ customerId: fx.customerId })).id,
    (api, id, fx) => api.dispatch.addBundlesBySerial({ id, serials: [fx.bundles[0]!.serial] }),
  ),
  c("dispatch.setItemGroupLabel", "dispatch.addBundle", (fx) => fx.draft(), (api, id, fx) =>
    api.dispatch.setItemGroupLabel({ id, bundleId: fx.bundles[0]!.id, groupLabel: "A" }),
  ),
  c("dispatch.removeBundle", "dispatch.addBundle", (fx) => fx.draft(), (api, id, fx) =>
    api.dispatch.removeBundle({ id, bundleId: fx.bundles[0]!.id }),
  ),
  c("dispatch.reserve", "dispatch.reserve", (fx) => fx.draft(), (api, id) => api.dispatch.reserve({ id })),
  c("dispatch.unreserve", "dispatch.reserve", (fx) => fx.reserved(), (api, id) => api.dispatch.unreserve({ id })),
  c("dispatch.complete", "dispatch.complete", (fx) => fx.reserved(), (api, id) => api.dispatch.complete({ id })),
  c("dispatch.cancel", "dispatch.cancel", (fx) => fx.reserved(), (api, id) => api.dispatch.cancel({ id })),
  c("dispatch.softDelete", "dispatch.delete", (fx) => fx.draft(), (api, id) => api.dispatch.softDelete({ id })),

  c("packingList.create", "dispatch.complete",
    async (fx) => {
      // complete() auto-creates the packing list; drop it so create() has work to do.
      const { dispatchId, plId } = await fx.completed();
      await env.db.delete(packingListLine).where(eq(packingListLine.packingListId, plId));
      await env.db.delete(packingList).where(eq(packingList.id, plId));
      return dispatchId;
    },
    (api, dispatchId) => api.packingList.create({ dispatchId }),
  ),
  c("packingList.regenerate", "packingList.regenerate", async (fx) => (await fx.completed()).plId, (api, id) =>
    api.packingList.regenerate({ id }),
  ),
];

// Every row the denied call could have touched, for a before/after comparison.
async function snapshot() {
  const tables = [
    customer,
    die,
    bundleGroup,
    bundle,
    bundleStatusEvent,
    dispatch,
    dispatchItem,
    packingList,
    packingListLine,
    auditLog,
  ];
  const rows = await Promise.all(tables.map((t) => env.db.select().from(t)));
  return JSON.stringify(rows);
}

describe("server-side action guards", () => {
  test("the case table covers every ops mutation exactly once", () => {
    const names = CASES.map((x) => x.name).sort();
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      [
        "customer.create", "customer.update", "customer.delete", "customer.importCsv",
        "die.create", "die.update", "die.delete", "die.validateImport", "die.processImport",
        "bundle.createReceipt", "bundle.transitionStatus", "bundle.bulkImport",
        "dispatch.create", "dispatch.update", "dispatch.addBundle", "dispatch.addBundlesBySerial",
        "dispatch.setItemGroupLabel", "dispatch.removeBundle", "dispatch.reserve", "dispatch.unreserve",
        "dispatch.complete", "dispatch.cancel", "dispatch.softDelete",
        "packingList.create", "packingList.regenerate",
      ].sort(),
    );
  });

  for (const tc of CASES) {
    describe(tc.name, () => {
      for (const role of ROLES) {
        const allowed = can({ company: { role }, isPlatformAdmin: false, platformRole: null }, tc.action);
        test(`${role} -> ${allowed ? "allowed" : "FORBIDDEN"} (${tc.action})`, async () => {
          const fx = await fixture();
          const arg = await tc.prep(fx);
          const api = env.caller({ role, companyId: fx.companyId });
          const before = await snapshot();

          const result = tc.run(api, arg as never, fx);
          if (allowed) {
            await expect(result).resolves.toBeDefined();
            if (!tc.readOnly) expect(await snapshot()).not.toBe(before);
            return;
          }

          const err = await result.then(
            () => null,
            (e: unknown) => e as { code?: string; message?: string },
          );
          expect(err).not.toBeNull();
          expect(err?.code).toBe("FORBIDDEN");
          expect(err?.message).toBe("You don't have permission to do that");
          expect(await snapshot()).toBe(before);
        });
      }
    });
  }

  test("viewer cannot complete a dispatch (reservation and bundles untouched)", async () => {
    const fx = await fixture();
    const id = await fx.reserved();
    const viewer = env.caller({ role: "viewer", companyId: fx.companyId });
    await expect(viewer.dispatch.complete({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [d] = await env.db.select().from(dispatch).where(eq(dispatch.id, id));
    expect(d?.status).toBe("reserved");
    const items = await env.db.select().from(dispatchItem).where(eq(dispatchItem.dispatchId, id));
    const bundles = await env.db
      .select()
      .from(bundle)
      .where(inArray(bundle.id, items.map((i) => i.bundleId)));
    expect(bundles.every((b) => b.status === "reserved")).toBe(true);
  });

  test("operator can book in a receipt but cannot bulk-import (it would auto-create dies)", async () => {
    const fx = await fixture();
    const operator = env.caller({ role: "operator", companyId: fx.companyId });
    await expect(
      operator.bundle.createReceipt({
        dieId: fx.dieId,
        unit: "pcs",
        rows: [{ quantity: 10, weightG: 25_000, lengthMm: 3_000 }],
      }),
    ).resolves.toBeDefined();

    const diesBefore = await env.db.select().from(die).where(eq(die.companyId, fx.companyId));
    await expect(
      operator.bundle.bulkImport({
        rows: [{ dieSeries: "NEW", dieSectionCode: "N1", quantity: 10, weightG: 25_000, lengthMm: 3_000 }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const diesAfter = await env.db.select().from(die).where(eq(die.companyId, fx.companyId));
    expect(diesAfter.length).toBe(diesBefore.length);
  });

  test("reads stay open to every role", async () => {
    const fx = await fixture();
    for (const role of ROLES) {
      const api = env.caller({ role, companyId: fx.companyId });
      await expect(api.customer.list({})).resolves.toBeDefined();
      await expect(api.dispatch.listDispatches({})).resolves.toBeDefined();
    }
  });
});
