/**
 * Infinity Portal merge, lane B (plan D2): `createCaller` runs in production code for the first time.
 * This test signs a person in through Better Auth, builds the context with the real `createContext`
 * (session cookie, tenant resolution), and runs a merge through `ingest.merge.*`. The adapters hand
 * that same context to `appRouter.createCaller`, so the middlewares run on a production-shaped context.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { account, user } from "@orrn/db/schema";

import { createTestEnv, type TestEnv } from "./harness";
import { auditRows, candidateRow, pump, seedCandidate, stagedRows } from "./ingest-merge-fixture";

let env: TestEnv;
const PASSWORD = "merge-context-password-123";

beforeAll(async () => {
  env = await createTestEnv();
  (await import("@orrn/auth")).resetAuthForTests();
}, 60_000);

afterAll(async () => {
  (await import("@orrn/auth")).resetAuthForTests();
  await env.dispose();
});

function authEnv(): Env {
  return {
    DB: env.d1,
    NODE_ENV: "development",
    CORS_ORIGIN: "http://localhost:3001",
    CORS_ALLOWED_ORIGINS: "http://localhost:3001",
    WEB_PUBLIC_URL: "http://localhost:3001",
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "merge-context-test-secret-0123456789",
    ORRN_MASTER_KEY: "",
    WEBHOOK_BASE_URL: "",
    CF_API_TOKEN: "",
    CF_ACCOUNT_ID: "",
    CF_ZONE_ID_IN: "",
  } as unknown as Env;
}

async function signedInAdmin(companyId: string): Promise<{ userId: string; cookie: string }> {
  const { hashPassword } = await import("@orrn/auth/password");
  const userId = crypto.randomUUID();
  const email = `merge.${userId.slice(0, 8)}@test.orrn`;
  await env.db.insert(user).values({ id: userId, name: "Merge admin", email, emailVerified: true } as never);
  await env.db
    .insert(account)
    .values({ id: crypto.randomUUID(), accountId: userId, providerId: "credential", userId, password: await hashPassword(PASSWORD) } as never);
  await env.addMembership(userId, companyId, "admin");
  const { createAuth } = await import("@orrn/auth");
  const res = await createAuth(authEnv()).handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3001" },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  const cookies = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
  const cookie = cookies.map((c) => c.split(";")[0]!).join("; ");
  return { userId, cookie };
}

describe("merge through the real createContext (D2)", () => {
  test("a signed-in admin merges; the procedures run as that person with the source on every audit row", async () => {
    const { companyId } = await env.seedCompany();
    const { userId, cookie } = await signedInAdmin(companyId);
    const customers = await seedCandidate(env, companyId, "customers", [{ values: { name: "Context Alu" } }]);
    const vendors = await seedCandidate(env, companyId, "vendors", [{ values: { name: "Context Scrap" } }]);

    const { createContext } = await import("../src/context");
    const raw = new Request("http://localhost:3000/trpc/ingest.merge.start", { headers: { cookie } });
    const ctx = await createContext({
      context: { env: authEnv(), req: { raw, header: (name: string) => raw.headers.get(name) ?? undefined } } as never,
    });
    expect(ctx.session?.user.id).toBe(userId);
    expect(ctx.companyId).toBe(companyId);
    expect(ctx.role).toBe("admin");
    expect(ctx.ingestSource).toBeUndefined();

    const { appRouter } = await import("../src/routers/index");
    const api = appRouter.createCaller(ctx);
    const { runId } = await api.ingest.merge.start();
    const res = await pump(api, runId, 0);
    expect(res.state).toBe("done");
    expect((await candidateRow(env, customers.candidateId)).state).toBe("merged");
    expect((await candidateRow(env, vendors.candidateId)).state).toBe("merged");
    expect((await stagedRows(env, customers.candidateId))[0]!.mergeState).toBe("written");

    for (const action of ["customer.import", "vendor.create"]) {
      const [row] = await auditRows(env, companyId, action);
      expect(row!.actorId).toBe(userId);
      expect((row!.meta as { source?: { mergeRunId: string } }).source?.mergeRunId).toBe(runId);
    }
    // The person's context is not changed by the merge: the source lives only on the callers it made.
    expect(ctx.ingestSource).toBeUndefined();
  });
});
