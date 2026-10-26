import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { user } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

/**
 * Pack screens (Task 20): the sessions list and session page show who packed
 * each session ("Packed by"), so listGroups and getGroup carry the packer's
 * name. Read-only, tenant-scoped like the rest of the bundle router.
 */

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const row = { quantity: 21, weightG: 52_400, lengthMm: 3505 };

async function nameOf(userId: string) {
  const [u] = await env.db.select({ name: user.name }).from(user).where(eq(user.id, userId));
  return u!.name;
}

describe("pack sessions carry the packer's name", () => {
  test("listGroups returns createdByName for each session", async () => {
    const { companyId, users } = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const operator = env.caller({ role: "operator", companyId });
    const created = await operator.bundle.createReceipt({ dieId, unit: "inch", rows: [row, row] });

    const res = await env.caller({ role: "viewer", companyId }).bundle.listGroups({ limit: 10, offset: 0 });
    const item = res.items.find((i) => i.id === created.groupId);
    expect(item).toBeDefined();
    expect(item!.createdByName).toBe(await nameOf(users.operator.id));
    expect(item!.bundleCount).toBe(2);
    expect(item!.totalWeightG).toBe(104_800);
    expect(res.total).toBe(1);
  });

  test("a session whose packer was deleted lists with a null name (not dropped)", async () => {
    const { companyId } = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const ghost = await env.seedUser("Ghost");
    await env.addMembership(ghost, companyId, "operator");
    const created = await env.callerForUser(ghost).bundle.createReceipt({ dieId, unit: "mm", rows: [row] });
    // user.onDelete = set null on bundle_group.created_by
    await env.db.delete(user).where(eq(user.id, ghost));

    const res = await env.caller({ role: "owner", companyId }).bundle.listGroups({ limit: 10, offset: 0 });
    const item = res.items.find((i) => i.id === created.groupId);
    expect(item).toBeDefined();
    expect(item!.createdByName).toBeNull();
  });

  test("getGroup returns packedByName and stays tenant-scoped", async () => {
    const { companyId, users } = await env.seedCompany();
    const other = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const created = await env
      .caller({ role: "owner", companyId })
      .bundle.createReceipt({ dieId, unit: "inch", purchaseOrderRef: "PO-77", rows: [row] });

    const res = await env.caller({ role: "operator", companyId }).bundle.getGroup({ id: created.groupId });
    expect(res.packedByName).toBe(await nameOf(users.owner.id));
    expect(res.group.purchaseOrderRef).toBe("PO-77");
    expect(res.bundles).toHaveLength(1);
    expect(res.bundles[0]!.lengthMm).toBe(3505);

    await expect(
      env.caller({ role: "owner", companyId: other.companyId }).bundle.getGroup({ id: created.groupId }),
    ).rejects.toThrow(/not found/i);
  });
});

/**
 * Plant ruling RP11: a voided bundle is out of every packed figure. The Pack
 * list row and the session page totals must agree with Today (T19), which
 * already leaves void out.
 */
describe("pack session totals leave void bundles out (RP11)", () => {
  const heavy = { quantity: 20, weightG: 47_900, lengthMm: 3505 };

  test("voiding one bundle drops it from listGroups and getGroup totals", async () => {
    const { companyId } = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const operator = env.caller({ role: "operator", companyId });
    const created = await operator.bundle.createReceipt({ dieId, unit: "inch", rows: [heavy, heavy, row] });
    const before = await operator.bundle.getGroup({ id: created.groupId });
    const voided = before.bundles.find((b) => b.weightG === 52_400)!;
    // BACKLOG 51: the supervisor voids (the floor operator no longer holds bundle.void).
    await env.caller({ role: "supervisor", companyId }).bundle.transitionStatus({ id: voided.id, toStatus: "void", reason: "Weighed twice" });

    const list = await operator.bundle.listGroups({ limit: 10, offset: 0 });
    const item = list.items.find((i) => i.id === created.groupId)!;
    expect(item.bundleCount).toBe(2);
    expect(item.totalWeightG).toBe(95_800);
    expect(item.totalQuantity).toBe(40);

    const group = await operator.bundle.getGroup({ id: created.groupId });
    // The session page still lists every bundle (the Void chip says what happened) ...
    expect(group.bundles).toHaveLength(3);
    // ... but its totals count only the bundles still in play.
    expect(group.totals).toEqual({ bundles: 2, pieces: 40, weightG: 95_800 });
  });

  test("a session whose bundles are all void still lists, with 0 bundles and 0 kg", async () => {
    const { companyId } = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const owner = env.caller({ role: "owner", companyId });
    const created = await owner.bundle.createReceipt({ dieId, unit: "mm", rows: [row] });
    const [only] = (await owner.bundle.getGroup({ id: created.groupId })).bundles;
    await owner.bundle.transitionStatus({ id: only!.id, toStatus: "void" });

    const list = await owner.bundle.listGroups({ limit: 10, offset: 0 });
    const item = list.items.find((i) => i.id === created.groupId);
    expect(item).toBeDefined();
    expect(item!.bundleCount).toBe(0);
    expect(item!.totalWeightG).toBe(0);
    expect(list.total).toBe(1);

    const group = await owner.bundle.getGroup({ id: created.groupId });
    expect(group.totals).toEqual({ bundles: 0, pieces: 0, weightG: 0 });
  });
});

/**
 * The Pack die picker lists active dies only; archived dies must not take
 * places in its first page, and `total` must count what the picker can show.
 */
describe("die.list status filter", () => {
  test("status 'active' leaves archived dies out of items and total", async () => {
    const { companyId } = await env.seedCompany();
    const kept = await env.seedDie(companyId, { sectionCode: "10001" });
    await env.seedDie(companyId, { sectionCode: "10002", status: "archived" });
    const viewer = env.caller({ role: "viewer", companyId });

    const active = await viewer.die.list({ status: "active", limit: 100, offset: 0 });
    expect(active.items.map((d) => d.id)).toEqual([kept]);
    expect(active.total).toBe(1);

    const all = await viewer.die.list({ limit: 100, offset: 0 });
    expect(all.total).toBe(2);
  });
});
