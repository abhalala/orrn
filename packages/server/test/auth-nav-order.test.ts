import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { customerPortalUser, membership } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

async function preferencesOf(companyId: string, userId: string) {
  const row = await env.db
    .select({ preferences: membership.preferences })
    .from(membership)
    .where(and(eq(membership.companyId, companyId), eq(membership.userId, userId)))
    .get();
  return row?.preferences;
}

describe("auth.setNavOrder", () => {
  test("a member saves and reads back their order and divider without losing other preferences", async () => {
    const { companyId, users } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    expect((await owner.auth.me()).company?.navOrder).toBeNull();

    await env.db
      .update(membership)
      .set({ preferences: { appearance: { compact: true } } })
      .where(and(eq(membership.companyId, companyId), eq(membership.userId, users.owner.id)));
    await owner.auth.setNavOrder({ order: ["orders", "today", "guides", "stock"], moreFrom: "guides" });

    expect((await owner.auth.me()).company?.navOrder).toEqual({
      order: ["orders", "today", "guides", "stock"],
      moreFrom: "guides",
    });
    expect(await preferencesOf(companyId, users.owner.id)).toEqual({
      appearance: { compact: true },
      nav: { v: 1, order: ["orders", "today", "guides", "stock"], moreFrom: "guides" },
    });
  });

  test("an empty order clears only the nav preference", async () => {
    const { companyId, users } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await env.db
      .update(membership)
      .set({ preferences: { appearance: { compact: true } } })
      .where(and(eq(membership.companyId, companyId), eq(membership.userId, users.owner.id)));
    await owner.auth.setNavOrder({ order: ["orders", "today"], moreFrom: null });
    await owner.auth.setNavOrder({ order: [] });

    expect((await owner.auth.me()).company?.navOrder).toBeNull();
    expect(await preferencesOf(companyId, users.owner.id)).toEqual({ appearance: { compact: true } });
  });

  test("another member of the same plant keeps the default order", async () => {
    const { companyId, users } = await env.seedCompany();
    await env.caller({ role: "owner", companyId }).auth.setNavOrder({ order: ["audit", "today"] });

    const office = env.caller({ role: "office", companyId });
    expect((await office.auth.me()).company?.navOrder).toBeNull();
    expect(await preferencesOf(companyId, users.office.id)).toEqual({});
  });

  test("the same person in another plant keeps a separate order", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    await env.addMembership(a.users.owner.id, b.companyId, "viewer");
    await env.caller({ role: "owner", companyId: a.companyId }).auth.setNavOrder({ order: ["orders", "today"] });

    const inB = env.callerForUser(a.users.owner.id, { company: b.companyId });
    expect((await inB.auth.me()).company?.navOrder).toBeNull();
    await inB.auth.setNavOrder({ order: ["guides", "stock"], moreFrom: "stock" });

    expect((await env.callerForUser(a.users.owner.id, { company: a.companyId }).auth.me()).company?.navOrder).toEqual({
      order: ["orders", "today"],
    });
    expect((await inB.auth.me()).company?.navOrder).toEqual({ order: ["guides", "stock"], moreFrom: "stock" });
  });

  test("a plant guard refuses to save into a different active plant", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    await env.addMembership(a.users.owner.id, b.companyId, "owner");
    const inA = env.callerForUser(a.users.owner.id, { company: a.companyId });
    await inA.auth.setNavOrder({ order: ["today"], expectCompanyId: a.companyId });

    await expect(
      inA.auth.setNavOrder({ order: ["orders"], expectCompanyId: b.companyId }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "The plant changed. Open the menu again and arrange it for this plant.",
    });
    expect((await inA.auth.me()).company?.navOrder).toEqual({ order: ["today"] });
    expect(await preferencesOf(b.companyId, a.users.owner.id)).toEqual({});
  });

  test("bad shapes are refused and the saved value is unchanged", async () => {
    const { companyId, users } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await owner.auth.setNavOrder({ order: ["today", "orders"] });
    const before = await preferencesOf(companyId, users.owner.id);
    const badInputs = [
      { order: ["today", "today"] },
      { order: Array.from({ length: 61 }, (_, i) => `item-${i}`) },
      { order: ["x".repeat(41)] },
      { order: [""] },
      { order: ["today"], moreFrom: "missing" },
      { order: ["today"], companyId: "another-plant" },
    ];

    for (const input of badInputs) {
      await expect(owner.auth.setNavOrder(input as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await preferencesOf(companyId, users.owner.id)).toEqual(before);
  });

  test("hostile stored preferences read as default and can be repaired", async () => {
    const { companyId, users } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const hostileValues = [
      "not json{",
      "[1,2]",
      "7",
      "x".repeat(1024 * 1024),
      JSON.stringify({ nav: { v: 1, order: [1, 2, 3] } }),
    ];

    for (const stored of hostileValues) {
      await env.d1
        .prepare("update membership set preferences = ? where company_id = ? and user_id = ?")
        .bind(stored, companyId, users.owner.id)
        .run();
      expect((await owner.auth.me()).company?.navOrder).toBeNull();
      await owner.auth.setNavOrder({ order: ["today", "orders"] });
      expect((await owner.auth.me()).company?.navOrder).toEqual({ order: ["today", "orders"] });
    }
  });

  test("a customer portal login cannot save a member menu order", async () => {
    const { companyId } = await env.seedCompany();
    const customerId = await env.seedCustomer(companyId);
    const userId = await env.seedUser("Portal");
    await env.db.insert(customerPortalUser).values({
      id: crypto.randomUUID(),
      companyId,
      customerId,
      email: `portal.${crypto.randomUUID()}@test.orrn`,
      userId,
      status: "active",
      acceptedAt: new Date(),
    });

    await expect(
      env.callerForUser(userId).auth.setNavOrder({ order: ["today"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Company access required" });
  });
});
