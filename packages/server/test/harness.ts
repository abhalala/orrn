/**
 * Server test harness: a real D1 (Miniflare) with every migration applied, the
 * Workers-only `cloudflare:workers` module mocked, and helpers to seed tenants
 * and build tRPC callers without going through Better Auth.
 *
 * Usage:
 *   let env: TestEnv;
 *   beforeAll(async () => { env = await createTestEnv(); });
 *   afterAll(() => env.dispose());
 *
 * Server modules are imported lazily (after the `cloudflare:workers` mock is in
 * place), so test files should not import router/db code before createTestEnv().
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

import type { createDb } from "@orrn/db";
import type { die } from "@orrn/db/schema/catalog";
import type { BundleStatus } from "@orrn/db/schema/inventory";
import type { CompanyRole, PlatformStaffRole } from "@orrn/db/schema/tenant";

import type { Context } from "../src/context";
import type { appRouter } from "../src/routers/index";
import { workersEnv } from "./env-mock";

export type Db = ReturnType<typeof createDb>;
export type DieInsert = typeof die.$inferInsert;
export type { BundleStatus, CompanyRole, PlatformStaffRole };

/** D1 rejects statements with more than 100 bound parameters. */
export const D1_MAX_PARAMS = 100;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/src/migrations");

/** `sessionId` is the Better Auth session row id for the "current session" (optional). */
type CallerAs =
  | { role: CompanyRole; companyId: string; sessionId?: string }
  | { platformRole: PlatformStaffRole; sessionId?: string }
  | null;

export type TestEnv = {
  db: Db;
  d1: D1Database;
  dispose(): Promise<void>;
  seedCompany(opts?: { modules?: string[]; settings?: Record<string, unknown> }): Promise<{
    companyId: string;
    users: Record<CompanyRole, { id: string; email: string }>;
  }>;
  caller(as: CallerAs): ReturnType<typeof appRouter.createCaller>;
  /**
   * Caller for a specific user, with the tenant context resolved exactly as in
   * production (resolveTenantContext): `company` is the `x-orrn-company`
   * header, `impersonate` the impersonation header.
   */
  callerForUser(
    userId: string,
    opts?: { company?: string; impersonate?: string; sessionId?: string },
  ): ReturnType<typeof appRouter.createCaller>;
  /** Insert a bare user (no membership); returns its id. */
  seedUser(name?: string): Promise<string>;
  /** Add a membership for an existing user (a user may belong to several companies). */
  addMembership(
    userId: string,
    companyId: string,
    role: CompanyRole,
    opts?: { createdAt?: Date },
  ): Promise<string>;
  seedDie(companyId: string, over?: Partial<DieInsert>): Promise<string>;
  seedCustomer(companyId: string): Promise<string>;
  seedBundles(
    companyId: string,
    dieId: string,
    n: number,
    status?: BundleStatus,
  ): Promise<{ id: string; serial: string }[]>;
  /**
   * Run `fn` once, right before the next D1 `batch()` (i.e. after a procedure's
   * reads, before its atomic write). Lets tests interleave another mutation
   * deterministically to simulate a race. `fn`'s own batches don't re-trigger it.
   */
  beforeNextBatch(fn: () => Promise<unknown>): void;
};

type BatchHook = { next: (() => Promise<unknown>) | null };

/**
 * Wraps a D1 binding so `prepare(sql).bind(...args)` throws when more than 100
 * parameters are bound, mirroring production D1. `bind()` returns the real
 * statement, so `batch()` (which needs genuine statements) keeps working.
 * `batch()` first runs any pending `beforeNextBatch` hook.
 */
function withParamLimit(d1: D1Database, hook: BatchHook): D1Database {
  return new Proxy(d1, {
    get(target, prop) {
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const fn = hook.next;
          hook.next = null;
          if (fn) await fn();
          return target.batch(statements);
        };
      }
      if (prop === "prepare") {
        return (query: string) => {
          const stmt = target.prepare(query);
          return new Proxy(stmt, {
            get(stmtTarget, stmtProp) {
              if (stmtProp === "bind") {
                return (...args: unknown[]) => {
                  if (args.length > D1_MAX_PARAMS) {
                    throw new Error("D1_TOO_MANY_PARAMS");
                  }
                  return stmtTarget.bind(...args);
                };
              }
              const value = Reflect.get(stmtTarget, stmtProp, stmtTarget);
              return typeof value === "function" ? value.bind(stmtTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function applyMigrations(d1: D1Database) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    // One batch per file: a single round trip, atomic per migration.
    // (D1 exec() treats each line as a statement, so it can't run multi-line DDL.)
    if (statements.length > 0) {
      await d1.batch(statements.map((s) => d1.prepare(s)));
    }
  }
}

let seq = 0;
function uniq(prefix: string) {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

export async function createTestEnv(): Promise<TestEnv> {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
  });
  const rawD1 = await mf.getD1Database("DB");
  await applyMigrations(rawD1);

  const batchHook: BatchHook = { next: null };
  const d1 = withParamLimit(rawD1, batchHook);
  workersEnv.DB = d1;

  // Server modules read `env.DB` from the mocked `cloudflare:workers`; import
  // them only now that it is populated.
  const { createDb } = await import("@orrn/db");
  const { appRouter } = await import("../src/routers/index");
  const { createId } = await import("../src/lib/id");
  const { formatBundleSerial, formatGroupCode } = await import("../src/lib/bundleSerial");
  const { user, company, membership, platformAdmin, die, customer, bundle, bundleGroup } = await import(
    "@orrn/db/schema"
  );
  const { and, eq } = await import("drizzle-orm");
  const { companyRoles } = await import("@orrn/db/schema/tenant");
  const { resolveTenantContext } = await import("../src/lib/tenantContext");

  const db = createDb();
  const platformUsers = new Map<PlatformStaffRole, { id: string; name: string; email: string }>();

  async function seedCompany(opts: { modules?: string[]; settings?: Record<string, unknown> } = {}) {
    const companyId = createId();
    const tag = uniq("co");
    await db.insert(company).values({
      id: companyId,
      name: `Test Co ${tag}`,
      slug: tag,
      status: "active",
      modules: opts.modules ?? [],
      settings: opts.settings ?? {},
    });

    const users = {} as Record<CompanyRole, { id: string; email: string }>;
    for (const role of companyRoles) {
      const id = createId();
      const email = `${role}.${tag}@test.orrn`;
      await db.insert(user).values({ id, name: `${role} ${tag}`, email });
      await db.insert(membership).values({ id: createId(), userId: id, companyId, role });
      users[role] = { id, email };
    }
    return { companyId, users };
  }

  async function platformUser(role: PlatformStaffRole) {
    const existing = platformUsers.get(role);
    if (existing) return existing;
    const id = createId();
    const row = { id, name: `platform ${role}`, email: `platform.${role}.${uniq("")}@test.orrn` };
    await db.insert(user).values(row);
    await db.insert(platformAdmin).values({ userId: id, role });
    platformUsers.set(role, row);
    return row;
  }

  function caller(as: CallerAs) {
    // createCaller accepts a (possibly async) context factory, which lets
    // caller() stay synchronous while the identity is resolved from the DB.
    return appRouter.createCaller(async (): Promise<Context> => {
      const base = {
        auth: null,
        db,
        request: new Request("https://api.test"),
        impersonation: null,
        impersonationHeaderRejected: false,
        companyHeaderRejected: false,
      };

      if (as === null) {
        return {
          ...base,
          session: null,
          membership: null,
          companyId: null,
          role: null,
          isPlatformAdmin: false,
          platformRole: null,
        };
      }

      if ("platformRole" in as) {
        const u = await platformUser(as.platformRole);
        return {
          ...base,
          session: {
            user: { id: u.id, name: u.name, email: u.email },
            session: { id: as.sessionId ?? "test-session" },
          } as unknown as Context["session"],
          membership: null,
          companyId: null,
          role: null,
          isPlatformAdmin: true,
          platformRole: as.platformRole,
        };
      }

      const [row] = await db
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          membershipId: membership.id,
        })
        .from(membership)
        .innerJoin(user, eq(user.id, membership.userId))
        .where(and(eq(membership.companyId, as.companyId), eq(membership.role, as.role)))
        .limit(1);
      if (!row) {
        throw new Error(`No ${as.role} member in company ${as.companyId}; call seedCompany() first`);
      }
      return {
        ...base,
        session: {
          user: { id: row.userId, name: row.name, email: row.email },
          session: { id: as.sessionId ?? "test-session" },
        } as unknown as Context["session"],
        membership: {
          id: row.membershipId,
          companyId: as.companyId,
          role: as.role,
          companyStatus: "active" as const,
        },
        companyId: as.companyId,
        role: as.role,
        isPlatformAdmin: false,
        platformRole: null,
      };
    });
  }

  async function seedUser(name = "user") {
    const id = createId();
    await db.insert(user).values({ id, name: `${name} ${uniq("")}`, email: `${uniq("u")}@test.orrn` });
    return id;
  }

  async function addMembership(userId: string, companyId: string, role: CompanyRole, opts: { createdAt?: Date } = {}) {
    const id = createId();
    await db.insert(membership).values({ id, userId, companyId, role, ...(opts.createdAt ? { createdAt: opts.createdAt } : {}) });
    return id;
  }

  function callerForUser(userId: string, opts: { company?: string; impersonate?: string; sessionId?: string } = {}) {
    return appRouter.createCaller(async (): Promise<Context> => {
      const [u] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
      if (!u) throw new Error(`No user ${userId}`);
      const tenant = await resolveTenantContext(db, {
        userId,
        companyHeader: opts.company ?? null,
        impersonateHeader: opts.impersonate ?? null,
      });
      return {
        auth: null,
        db,
        request: new Request("https://api.test"),
        session: {
          user: { id: u.id, name: u.name, email: u.email },
          session: { id: opts.sessionId ?? "test-session" },
        } as unknown as Context["session"],
        ...tenant,
      };
    });
  }

  async function seedDie(companyId: string, over: Partial<DieInsert> = {}) {
    const id = over.id ?? createId();
    await db.insert(die).values({
      series: "T",
      sectionCode: uniq("S"),
      weightMinG: 20_000,
      weightMaxG: 30_000,
      ...over,
      id,
      companyId,
    });
    return id;
  }

  async function seedCustomer(companyId: string) {
    const id = createId();
    await db.insert(customer).values({ id, companyId, name: `Customer ${uniq("")}` });
    return id;
  }

  async function seedBundles(companyId: string, dieId: string, n: number, status: BundleStatus = "available") {
    const groupId = createId();
    // Real serials are upper case (formatGroupCode/formatBundleSerial); keep seeds that way so
    // normalizeSerial() lookups match.
    const code = `${formatGroupCode(Math.floor(Math.random() * 900_000) + 100_000)}-${uniq("").toUpperCase()}`;
    await db.insert(bundleGroup).values({ id: groupId, companyId, code, dieId, unit: "pcs" });

    const rows = Array.from({ length: n }, (_, i) => ({
      id: createId(),
      companyId,
      groupId,
      dieId,
      serial: formatBundleSerial(code, i + 1),
      quantity: 10,
      weightG: 25_000,
      lengthMm: 3_000,
      status,
    }));
    // 9 bound params per row; 10 rows = 90 stays under the D1 limit of 100.
    for (let i = 0; i < rows.length; i += 10) {
      await db.insert(bundle).values(rows.slice(i, i + 10));
    }
    return rows.map(({ id, serial }) => ({ id, serial }));
  }

  return {
    db,
    d1,
    async dispose() {
      await mf.dispose();
      // Don't leave a disposed D1 reachable through the shared mocked env.
      delete workersEnv.DB;
    },
    seedCompany,
    caller,
    callerForUser,
    seedUser,
    addMembership,
    seedDie,
    seedCustomer,
    seedBundles,
    beforeNextBatch(fn) {
      batchHook.next = fn;
    },
  };
}
