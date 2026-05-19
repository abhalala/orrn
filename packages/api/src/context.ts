import { createAuth } from "@orrn/auth";
import { createDb } from "@orrn/db";
import { company, membership, platformAdmin } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";
import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const db = createDb();
  const session = await createAuth().api.getSession({
    headers: context.req.raw.headers,
  });

  const userId = session?.user.id;
  const [member] = userId
    ? await db
        .select({
          id: membership.id,
          companyId: membership.companyId,
          role: membership.role,
          companyStatus: company.status,
        })
        .from(membership)
        .innerJoin(company, eq(company.id, membership.companyId))
        .where(and(eq(membership.userId, userId), eq(company.status, "active")))
        .limit(1)
    : [];

  const [platform] = userId
    ? await db.select({ userId: platformAdmin.userId }).from(platformAdmin).where(eq(platformAdmin.userId, userId)).limit(1)
    : [];

  return {
    auth: null,
    db,
    request: context.req.raw,
    session,
    membership: member ?? null,
    companyId: member?.companyId ?? null,
    role: member?.role ?? null,
    isPlatformAdmin: Boolean(platform),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
