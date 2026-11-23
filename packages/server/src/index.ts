import { initTRPC, TRPCError } from "@trpc/server";
import { isStrongSession } from "@orrn/auth/session-method";
import { company } from "@orrn/db/schema/tenant";
import { eq } from "drizzle-orm";

import type { Context } from "./context";
import { errorMetaOf, TRPCMetaError } from "./lib/errorMeta";
import { isOptInModule } from "@orrn/domain";

import { assertModule, modulesForPath } from "./lib/moduleGate";
import { PORTAL_REFUSALS, resolvePortalAccess } from "./lib/portal";
import { COMPANY_HEADER, IMPERSONATE_HEADER } from "./lib/tenantContext";
import { can, canAny, type Action } from "./lib/permissions";
import { ScanRefusalError } from "./lib/scanRefusal";

export const t = initTRPC.context<Context>().create({
  // `TRPCMetaError.meta` (e.g. a duplicate band's `existing`) reaches the client as `error.data.meta`.
  /** A dispatch add refusal (D12) carries its machine `{code, reason}` to clients as `data.refusal`. */
  errorFormatter({ shape, error }) {
    const meta = errorMetaOf(error);
    const refusal = error.cause instanceof ScanRefusalError ? error.cause.refusal : null;
    return { ...shape, data: { ...shape.data, refusal, ...(meta ? { meta } : {}) } };
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

/**
 * The refusal reasons `companyProcedure` puts in `error.data.meta.reason` when the active plant requires
 * secure sign-in (council round 1, A4; spec "Amendment 2: enforcement"):
 * - `STRONG_SIGN_IN_NEEDED`: the person has a passkey, Google or the authenticator app, but this
 *   session was made without one (a password alone). Clients sign out and ask for one of them.
 * - `STRONG_METHOD_NEEDED`: the person has none yet. Clients read `auth.me` again; its tenant guard
 *   sends them to the mandatory "Secure your sign-in" step (web) or "finish on the web" (phone).
 */
export const STRONG_SIGN_IN_NEEDED = "STRONG_SIGN_IN_NEEDED";
export const STRONG_METHOD_NEEDED = "STRONG_METHOD_NEEDED";

/**
 * "Require secure sign-in" is enforced here, for every tenant procedure. Only `auth.*` (authed, not
 * tenant: `auth.me`, `auth.signInMethods`, `auth.completeOnboarding`, the password steps),
 * `company.switch` and Better Auth's own endpoints (passkey add, the authenticator app, Google link)
 * stay open, which is all the secure step and the plant picker need. An impersonating platform admin is
 * never held by it: support must be able to reach a locked-out plant.
 */
async function assertStrongSignIn(ctx: Context & { companyId: string; membership: NonNullable<Context["membership"]> }) {
  if (ctx.impersonation || ctx.membership.requireStrongSignIn !== true) return;
  const session = ctx.session?.session as { signInMethod?: unknown } | undefined;
  if (isStrongSession(session?.signInMethod)) return;
  const userId = ctx.session?.user.id;
  if (!userId) return;
  // Loaded here, not at module scope: it pulls in better-auth, which would run at Worker startup (10021).
  const { hasStrongMethod, signInMethodsFor } = await import("@orrn/auth/sign-in-methods");
  const strong = hasStrongMethod(await signInMethodsFor(ctx.db, userId));
  const plant = await ctx.db.select({ name: company.name }).from(company).where(eq(company.id, ctx.companyId)).get();
  throw new TRPCMetaError({
    code: "FORBIDDEN",
    message: strong
      ? "This plant needs a passkey, Google or your authenticator code. Sign in with one of them."
      : "This plant needs a passkey, Google or an authenticator app. Add one first.",
    meta: { reason: strong ? STRONG_SIGN_IN_NEEDED : STRONG_METHOD_NEEDED, plant: plant?.name ?? null },
  });
}

export const companyProcedure = authedProcedure.use(async ({ ctx, next, path, type }) => {
  if (!ctx.companyId || !ctx.membership || !ctx.role) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Company access required",
    });
  }

  await assertStrongSignIn({ ...ctx, companyId: ctx.companyId, membership: ctx.membership });

  // FP-PF-07: a mutation of a module that is off for this plant is refused at the router level
  // (lib/moduleGate ROUTER_MODULE), whatever the role allows. Reads of a standard module are not gated;
  // reads of an opt-in (XE) module are (PROD-GATE, owner rule 2026-11-23): off means nothing is served.
  // A nested XE router also needs its parent's module on writes (`store.po.create`: `store_buy` and `store`).
  for (const module of modulesForPath(path)) {
    if (type === "mutation" || isOptInModule(module)) {
      await assertModule({ db: ctx.db, companyId: ctx.companyId }, module);
    }
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
 * The action(s) a procedure's guard checks, keyed by the guard middleware itself. Read only by the buddy
 * registry (`lib/buddy/registry.ts`), which walks `_def.middlewares` to tell Hermes which action a
 * procedure needs and whether the person's role holds it. The guard itself is unchanged.
 */
export type GuardActions = { mode: "all" | "any"; actions: readonly Action[] };
export const GUARD_ACTIONS = new WeakMap<object, GuardActions>();

function tagGuard<F extends object>(guard: GuardActions, fn: F): F {
  GUARD_ACTIONS.set(fn, guard);
  return fn;
}

/**
 * Company procedure that also requires the caller's role to allow `action` in
 * the permission matrix. The server is authoritative; hiding buttons is only a
 * convenience. Use on every mutation that changes ops data.
 */
export function actionProcedure(action: Action) {
  return companyProcedure.use(
    tagGuard({ mode: "all", actions: [action] }, ({ ctx, next }) => {
      const me = { company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null };
      if (!can(me, action)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to do that",
        });
      }
      return next({ ctx });
    }),
  );
}

/** Like {@link actionProcedure}, but any one of `actions` is enough (e.g. die.card OR masters.publish). */
export function anyActionProcedure(...actions: readonly Action[]) {
  return companyProcedure.use(
    tagGuard({ mode: "any", actions }, ({ ctx, next }) => {
      const me = { company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null };
      if (!canAny(me, actions)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to do that",
        });
      }
      return next({ ctx });
    }),
  );
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

/**
 * Party portal procedure (FP-PF-01, C29; specs §E7 "Rules"). NOT a company role and no `can()`:
 * session + an active `customer_portal_user` row + company active + `portalEnabled`, and the user
 * holds no membership in that plant. Company AND customer come from the portal row, never from the
 * input; `x-orrn-company` only picks among the party's own plants. Impersonation never enters the
 * portal (a platform admin signs in as a demo party instead).
 */
export const portalProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required", cause: "No session" });
  }
  if (ctx.impersonation || ctx.impersonationHeaderRejected || ctx.request.headers.get(IMPERSONATE_HEADER)) {
    throw new TRPCError({ code: "FORBIDDEN", message: PORTAL_REFUSALS.impersonation });
  }
  const portal = await resolvePortalAccess(ctx.db, {
    userId: ctx.session.user.id,
    companyHeader: ctx.request.headers.get(COMPANY_HEADER),
  });
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      portal,
      companyId: portal.companyId,
      // A party is never a member: no role, no membership, no impersonation downstream.
      membership: null,
      role: null,
      impersonation: null,
    },
  });
});
