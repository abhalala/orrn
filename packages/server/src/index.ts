import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";
import { can, type Action } from "./lib/permissions";

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
  if (!ctx.isPlatformAdmin || !ctx.platformRole) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Platform staff access required",
    });
  }

  return next({
    ctx: {
      ...ctx,
      isPlatformAdmin: true,
      platformRole: ctx.platformRole,
    },
  });
});

/** Platform staff route guard — checks internal staff role against permissions matrix. */
export function platformGuard(action: Action) {
  return platformProcedure.use(({ ctx, next }) => {
    const me = {
      company: null,
      isPlatformAdmin: true,
      platformRole: ctx.platformRole,
    };
    if (!can(me, action)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Insufficient platform permissions",
      });
    }
    return next({ ctx });
  });
}

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
