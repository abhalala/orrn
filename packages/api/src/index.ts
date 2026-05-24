import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  if (ctx.impersonationHeaderRejected) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Invalid, expired, or revoked impersonation grant",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

export const protectedProcedure = authedProcedure;

export const companyProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.companyId || !ctx.membership || !ctx.role) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Company access required",
    });
  }

  return next({
    ctx: {
      ...ctx,
      companyId: ctx.companyId,
      membership: ctx.membership,
      role: ctx.role,
    },
  });
});

export const platformProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.isPlatformAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Platform admin access required",
    });
  }

  return next({
    ctx: {
      ...ctx,
      isPlatformAdmin: true,
    },
  });
});

type Role = NonNullable<Context["role"]>;

export function roleGuard(...allowedRoles: Role[]) {
  return companyProcedure.use(({ ctx, next }) => {
    if (!allowedRoles.includes(ctx.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Insufficient permissions",
      });
    }

    return next({ ctx });
  });
}
