import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";
import { errorMetaOf } from "./lib/errorMeta";
import { assertModule, moduleForPath } from "./lib/moduleGate";
import { can, canAny, type Action } from "./lib/permissions";

export const t = initTRPC.context<Context>().create({
  // `TRPCMetaError.meta` (e.g. a duplicate band's `existing`) reaches the client as `error.data.meta`.
  errorFormatter({ shape, error }) {
    const meta = errorMetaOf(error);
    return meta ? { ...shape, data: { ...shape.data, meta } } : shape;
  },
});

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
  if (ctx.companyHeaderRejected) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't have access to that plant",
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

export const companyProcedure = authedProcedure.use(async ({ ctx, next, path, type }) => {
  if (!ctx.companyId || !ctx.membership || !ctx.role) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Company access required",
    });
  }

  // FP-PF-07: a mutation of a module that is off for this plant is refused at the router level
  // (lib/moduleGate ROUTER_MODULE), whatever the role allows. Reads are not gated.
  if (type === "mutation") {
    const module = moduleForPath(path);
    if (module) await assertModule({ db: ctx.db, companyId: ctx.companyId }, module);
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

/**
 * Company procedure that also requires the caller's role to allow `action` in
 * the permission matrix. The server is authoritative; hiding buttons is only a
 * convenience. Use on every mutation that changes ops data.
 */
export function actionProcedure(action: Action) {
  return companyProcedure.use(({ ctx, next }) => {
    const me = { company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null };
    if (!can(me, action)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You don't have permission to do that",
      });
    }
    return next({ ctx });
  });
}

/** Like {@link actionProcedure}, but any one of `actions` is enough (e.g. die.card OR masters.publish). */
export function anyActionProcedure(...actions: readonly Action[]) {
  return companyProcedure.use(({ ctx, next }) => {
    const me = { company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null };
    if (!canAny(me, actions)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You don't have permission to do that",
      });
    }
    return next({ ctx });
  });
}

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
