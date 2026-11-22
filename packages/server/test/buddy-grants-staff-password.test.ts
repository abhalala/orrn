/**
 * N7 (delta round, decision 12): the ops script `src/infra/scripts/set-staff-password.ts` sets a password straight in
 * D1, so it must end the person's buddy grants like a password reset does (`password_reset`), with their pending
 * drafts. The script talks to D1 over the HTTP query API; its revoke step is the same statements as
 * `@orrn/auth/buddy-revoke`, run here against the test D1. Importing the script runs nothing. Synthetic data only.
 */
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, test } from "bun:test";

import { buddyDraft, buddyGrant, buddyLink } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { buddyPlant, connect, setHermesEnv } from "./buddy-fixture";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  setHermesEnv(false);
  await env.dispose();
});

beforeEach(() => setHermesEnv(true));
afterEach(() => setHermesEnv(false));

describe("set-staff-password revokes buddy grants (N7)", () => {
  test("every grant of the person ends (password_reset) with its pending drafts and links; other people keep theirs", async () => {
    const p = await buddyPlant(env);
    const { grantId } = await connect(p);
    const { createId } = await import("../src/lib/id");
    const draftId = createId();
    await env.db.insert(buddyDraft).values({
      id: draftId,
      companyId: p.companyId,
      requestedByUserId: p.users.owner.id,
      grantId,
      path: "customer.create",
      inputJson: { name: "Synthetic Co" },
      summary: "Add a customer",
      status: "pending",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const q = await buddyPlant(env);
    const other = await connect(q);

    const { buddyRevokeQueries } = await import("../src/infra/scripts/set-staff-password");
    const at = new Date();
    const queries = buddyRevokeQueries(p.users.owner.id, at);
    expect(queries.length).toBeGreaterThan(0);
    for (const { sql, params } of queries) await env.d1.prepare(sql).bind(...params).run();

    const g = await env.db.select().from(buddyGrant).where(eq(buddyGrant.id, grantId)).get();
    expect(g).toMatchObject({ revokedReason: "password_reset" });
    expect(g!.revokedAt!.getTime()).toBe(at.getTime());
    expect((await env.db.select().from(buddyDraft).where(eq(buddyDraft.id, draftId)).get())!.status).toBe("expired");
    expect((await env.db.select().from(buddyLink).where(eq(buddyLink.userId, p.users.owner.id)).get())!.status).toBe("revoked");
    expect((await env.db.select().from(buddyGrant).where(eq(buddyGrant.id, other.grantId)).get())!.revokedAt).toBeNull();
  });
});
