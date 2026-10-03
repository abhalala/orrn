import type { Me } from "@orrn/server/lib/permissions";

import { isUnauthorized } from "./session";

/**
 * The native auth gate (audit N3): one decision, made in the root layout, for
 * which group of screens a person may see. Pure so it is unit-tested; the
 * layout turns it into `Stack.Protected` guards.
 */
export type GateRoute = "/(auth)/sign-in" | "/(tabs)/today" | "/no-access";
export type GateState = GateRoute | "loading" | "offline";

/**
 * Where a person belongs. Unlike web there is no welcome step: company setup
 * happens on the web, and a floor worker with only a phone must not be stuck
 * behind it (ruling T28-1). A temporary password still has to be replaced first.
 */
export function routeForMe(me: Me | null | undefined): GateRoute {
  if (!me) return "/(auth)/sign-in";
  if (me.user.mustChangePassword) return "/no-access";
  if (!me.company) return "/no-access";
  return "/(tabs)/today";
}

export type NoAccessReason = "no-company" | "staff" | "set-password";

/** Why `routeForMe` chose `/no-access`, so the screen can say what to do next. */
export function noAccessReason(me: Me | null | undefined): NoAccessReason | null {
  if (!me) return null;
  if (me.user.mustChangePassword) return "set-password";
  if (!me.company) return me.isPlatformAdmin && me.platformRole ? "staff" : "no-company";
  return null;
}

export type GateInput = {
  /** A Better Auth session cookie is stored on this device. */
  hasSession: boolean;
  /** Last `auth.me` data (may be stale). */
  me: Me | undefined;
  /** Last `auth.me` error, if the latest fetch failed. */
  error: unknown;
  /** No `auth.me` result yet. */
  isPending: boolean;
};

export function resolveGate({ hasSession, me, error, isPending }: GateInput): GateState {
  // Never signed in on this phone: sign-in works without asking the server first.
  if (!hasSession) return "/(auth)/sign-in";
  // The server says the session is gone; stale data must not keep the app open.
  if (isUnauthorized(error)) return "/(auth)/sign-in";
  // Cached data survives a network blip.
  if (me) return routeForMe(me);
  if (isPending) return "loading";
  return "offline";
}

/**
 * Every root Stack screen, by gate. `__tests__/routes.test.ts` fails when a
 * screen exists under `app/` without being listed here, so a new screen can't
 * slip out from behind the gate. Add new signed-in screens (e.g. `b/[serial]`)
 * to `app`.
 */
export const ROOT_ROUTES = {
  /** Signed in with a company. */
  app: ["(tabs)", "more"],
  /** Signed out. */
  auth: ["(auth)"],
  /** Signed in, but no company or a temporary password. */
  noAccess: ["no-access"],
  /**
   * Anyone. `index` is "/" and the Stack's fallback: it redirects to the gate's
   * choice, so it must stay first and unguarded. Invite links open signed in or out.
   */
  public: ["index", "invite/[token]"],
} as const satisfies Record<string, readonly string[]>;
