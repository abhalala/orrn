/**
 * BACKLOG 100: the audit log names what a row is about (the dispatch code, the order number, the party, the bundle serial)
 * instead of a raw id, for the plant's own rows only; an id of another plant, or a type with no name, stays unnamed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, dispatch, packingList, salesOrder } from "@orrn/db/schema";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.dispose();
});

async function audit(companyId: string, actorId: string, subjectType: string, subjectId: string | null, at: number) {
  const id = crypto.randomUUID();
  await env.db.insert(auditLog).values({ id, companyId, actorId, action: "x.y", subjectType, subjectId, meta: {}, at: new Date(at) });
  return id;
}

describe("audit.list subjectLabel (BACKLOG 100)", () => {
  test("the plant's own dispatch, order, packing list, party, bundle and copy are named; foreign and unknown subjects are not", async () => {
    const { companyId, users } = await env.seedCompany();
    const other = await env.seedCompany();
    const customerId = await env.seedCustomer(companyId);
    const otherCustomerId = await env.seedCustomer(other.companyId);
    const dieId = await env.seedDie(companyId);
    const [b] = await env.seedBundles(companyId, dieId, 1);
    const dispatchId = crypto.randomUUID();
    await env.db.insert(dispatch).values({ id: dispatchId, companyId, code: "DSP-000042", customerId, status: "completed", completedAt: new Date() });
    const orderId = crypto.randomUUID();
    await env.db.insert(salesOrder).values({ id: orderId, companyId, period: "2026-27", number: "SO-77", customerId, orderDate: "2026-10-24", status: "confirmed" } as never);
    const plId = crypto.randomUUID();
    await env.db.insert(packingList).values({ id: plId, companyId, dispatchId, code: "PL/2026-27/5", snapshot: {}, revision: 1 });
    const foreignDispatch = crypto.randomUUID();
    await env.db.insert(dispatch).values({ id: foreignDispatch, companyId: other.companyId, code: "DSP-FOREIGN", customerId: otherCustomerId, status: "completed", completedAt: new Date() });

    const base = Date.now() - 60_000;
    const ids = {
      dispatch: await audit(companyId, users.office.id, "dispatch", dispatchId, base),
      order: await audit(companyId, users.office.id, "sales_order", orderId, base + 1),
      pl: await audit(companyId, users.office.id, "packing_list", plId, base + 2),
      party: await audit(companyId, users.office.id, "customer", customerId, base + 3),
      bundle: await audit(companyId, users.office.id, "bundle", b!.id, base + 4),
      foreign: await audit(companyId, users.office.id, "dispatch", foreignDispatch, base + 5),
      unknownType: await audit(companyId, users.office.id, "approval", crypto.randomUUID(), base + 6),
      noSubject: await audit(companyId, users.office.id, "company", null, base + 7),
      gone: await audit(companyId, users.office.id, "dispatch", crypto.randomUUID(), base + 8),
    };
    const res = await env.caller({ role: "manager", companyId }).audit.list({});
    const label = (id: string) => res.items.find((r) => r.id === id)!.subjectLabel;
    expect(label(ids.dispatch)).toBe("DSP-000042");
    expect(label(ids.order)).toBe("SO-77");
    expect(label(ids.pl)).toBe("PL/2026-27/5");
    expect(label(ids.party)).toEqual(expect.any(String));
    expect(label(ids.party)).not.toBe("");
    expect(label(ids.bundle)).toBe(b!.serial);
    expect(label(ids.foreign)).toBeNull();
    expect(label(ids.unknownType)).toBeNull();
    expect(label(ids.noSubject)).toBeNull();
    expect(label(ids.gone)).toBeNull();
    // forSubject carries the same label.
    const own = await env.caller({ role: "manager", companyId }).audit.forSubject({ subjectType: "dispatch", subjectId: dispatchId });
    expect(own.items[0]!.subjectLabel).toBe("DSP-000042");
  });
});
