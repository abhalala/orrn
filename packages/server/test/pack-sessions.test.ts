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
