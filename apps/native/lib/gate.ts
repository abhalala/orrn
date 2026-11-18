import { hasStrongMethod, type Me } from "@orrn/server/lib/permissions";

import { isUnauthorized } from "./session";

/**
 * The native auth gate (audit N3): one decision, made in the root layout, for
 * which group of screens a person may see. Pure so it is unit-tested; the
 * layout turns it into `Stack.Protected` guards.
 */
export type GateRoute = "/(auth)/sign-in" | "/(tabs)/today" | "/no-access" | "/choose-plant";
export type GateState = GateRoute | "loading" | "offline";

/** A passkey, Google or the authenticator app: the shared rule next to `Me` (plan 2026-11-18). */
export { hasStrongMethod };

/** True when the person has more than one plant and owes a pick since the last sign-in (`lib/plant-choice.ts`). */
export function needsPlantChoice(me: Me, pickPending: boolean): boolean {
  return pickPending && Boolean(me.company) && !me.impersonation && (me.memberships?.length ?? 0) > 1;
}

/**
 * Why the active plant cannot be used on the phone yet, if it cannot (owner amendment 2026-11-18,
 * item 6; the phone has no welcome steps, so both go to the "finish on the web" screen):
 * - `secure-on-web`: the plant requires secure sign-in and the person has no strong method (any role);
 * - `finish-on-web`: the plant's setup is open for an owner or admin (company details). A floor role's
 *   open setup is only the closing screen, so it never blocks the phone (ruling T28-1).
 */
/**
 * Whether the phone shows "Setup pending" for a plant: only when that setup is an owner's or admin's to
 * finish (company details, on the web). A floor role's open setup never blocks the phone and nothing on
 * the phone closes it, so the chip would never go away (T28-1).
 */
export function phoneSetupPending(m: { role: string; setupPending?: boolean }): boolean {
  return m.setupPending === true && (m.role === "owner" || m.role === "admin");
}

export function plantBlock(me: Me): "secure-on-web" | "finish-on-web" | null {
  const plant = me.company;
  if (!plant || me.impersonation) return null;
  if (plant.requireStrongSignIn === true && !hasStrongMethod(me)) return "secure-on-web";
  if (phoneSetupPending(plant)) return "finish-on-web";
  return null;
}

/**
 * Where a person belongs. Unlike web there is no welcome step: company setup
 * happens on the web, and a floor worker with only a phone must not be stuck
 * behind it (ruling T28-1). A temporary password still has to be replaced first.
 * A person in several plants picks one after each sign-in (`pickPending`); a
 * plant that requires secure sign-in, or whose setup an owner or admin still
 * owes, sends them to the web (`plantBlock`).
 */
export function routeForMe(me: Me | null | undefined, pickPending = false): GateRoute {
  if (!me) return "/(auth)/sign-in";
  if (me.user.mustChangePassword) return "/no-access";
  if (!me.company) return "/no-access";
  if (needsPlantChoice(me, pickPending)) return "/choose-plant";
  if (plantBlock(me)) return "/no-access";
  return "/(tabs)/today";
}

export type NoAccessReason = "no-company" | "staff" | "set-password" | "secure-on-web" | "finish-on-web";

/** Why `routeForMe` chose `/no-access`, so the screen can say what to do next. */
export function noAccessReason(me: Me | null | undefined): NoAccessReason | null {
  if (!me) return null;
  if (me.user.mustChangePassword) return "set-password";
  if (!me.company) return me.isPlatformAdmin && me.platformRole ? "staff" : "no-company";
  return plantBlock(me);
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
  /**
   * How many `auth.me` fetches have failed (React Query's `errorUpdateCount`).
   * A refetch of an errored query with no data goes back to "pending", so
   * this is what tells "Try again" on the offline screen from a first load.
   */
  failedFetches?: number;
  /** A plant pick is owed since the last sign-in (`lib/plant-choice.ts`). */
  plantChoicePending?: boolean;
};

/**
 * Which copy the offline screen shows. A 5xx means orrn answered and failed,
 * so blaming the phone's connection would send people chasing the wrong fix;
 * anything else (no answer, a timeout, an unreadable reply) is the network.
 */
export function offlineKind(error: unknown): "network" | "server" {
  const e = error as { data?: { httpStatus?: unknown } | null; meta?: { response?: { status?: unknown } } } | null | undefined;
  const status = e?.data?.httpStatus ?? e?.meta?.response?.status;
  return typeof status === "number" && status >= 500 ? "server" : "network";
}

export function resolveGate({ hasSession, me, error, isPending, failedFetches = 0, plantChoicePending = false }: GateInput): GateState {
  // Never signed in on this phone: sign-in works without asking the server first.
  if (!hasSession) return "/(auth)/sign-in";
  // The server says the session is gone; stale data must not keep the app open.
  if (isUnauthorized(error)) return "/(auth)/sign-in";
  // Cached data survives a network blip.
  if (me) return routeForMe(me, plantChoicePending);
  // Retrying after a failure keeps the offline screen (its button spins).
  if (isPending) return failedFetches > 0 ? "offline" : "loading";
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
  app: ["(tabs)", "more", "b/[serial]"],
  /** Signed out. */
  auth: ["(auth)"],
  /** Signed in, but no company, a temporary password, or a plant to finish on the web. */
  noAccess: ["no-access"],
  /** Signed in with several plants, right after a sign-in: pick one (plan 2026-11-18, Task 9). */
  choosePlant: ["choose-plant"],
  /**
   * Anyone. `index` is "/" and the Stack's fallback: it redirects to the gate's
   * choice, so it must stay first and unguarded. Invite links open signed in or out.
   */
  public: ["index", "invite/[token]"],
} as const satisfies Record<string, readonly string[]>;

/**
 * Signed-in root screens that are their own Stack and draw their own header
 * (the root Stack hides its header for them). The first screen of a nested
 * Stack gets no native back chevron, so each of these layouts must give it
 * `headerLeft: () => <HeaderBack />` (__tests__/routes.test.ts). Every other
 * pushed root screen keeps the root header, which has the native Back.
 */
export const NESTED_STACKS: readonly string[] = ["more"];
