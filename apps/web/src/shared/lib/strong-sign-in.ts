/**
 * "Require secure sign-in" is enforced by the server (council round 1, A4): in a plant that requires
 * it, every tenant call made with a session that was not made with a passkey, Google or the
 * authenticator code is FORBIDDEN with `data.meta.reason`:
 *
 * - `STRONG_SIGN_IN_NEEDED` (the person has one of them, but signed in with a password alone): sign out,
 *   then the sign-in page says "<Plant> needs a passkey, Google or your authenticator code. Sign in
 *   with one of them." The plant's name rides in sessionStorage, never in the URL.
 * - `STRONG_METHOD_NEEDED` (they have none yet): read `auth.me` again and go to /welcome, whose
 *   mandatory "Secure your sign-in" step adds one (that upgrades the session, so they get in).
 *
 * Decided on the server's code, never its English sentence.
 */
export type StrongSignInReason = "STRONG_SIGN_IN_NEEDED" | "STRONG_METHOD_NEEDED";

export const STRONG_SIGN_IN_ERROR = "STRONG_SIGN_IN_NEEDED";
export const STRONG_SIGN_IN_PLANT_KEY = "orrn.strongSignInPlant";

type TrpcLike = { data?: { code?: unknown; meta?: { reason?: unknown; plant?: unknown } | null } | null };

/** The refusal's reason and plant name, or null for any other error. */
export function strongSignInRefusal(error: unknown): { reason: StrongSignInReason; plant: string | null } | null {
  const data = (error && typeof error === "object" ? (error as TrpcLike) : null)?.data;
  if (data?.code !== "FORBIDDEN") return null;
  const reason = data.meta?.reason;
  if (reason !== "STRONG_SIGN_IN_NEEDED" && reason !== "STRONG_METHOD_NEEDED") return null;
  const plant = typeof data.meta?.plant === "string" && data.meta.plant.trim() ? data.meta.plant.trim().slice(0, 120) : null;
  return { reason, plant };
}

/**
 * Buddy fix round (decision 5): connecting or renewing Hermes needs a sign-in from the last few minutes. The server
 * refuses with FORBIDDEN and `data.meta.reason = "FRESH_SIGN_IN_NEEDED"`; the screen says "sign in again" plainly.
 */
export function freshSignInNeeded(error: unknown): boolean {
  const data = (error && typeof error === "object" ? (error as TrpcLike) : null)?.data;
  return data?.code === "FORBIDDEN" && data.meta?.reason === "FRESH_SIGN_IN_NEEDED";
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberStrongSignInPlant(plant: string | null, storage: Store | null = sessionStore()): void {
  try {
    if (plant) storage?.setItem(STRONG_SIGN_IN_PLANT_KEY, plant);
    else storage?.removeItem(STRONG_SIGN_IN_PLANT_KEY);
  } catch {
    // Blocked storage: the sign-in page says "This plant" instead.
  }
}

export function readStrongSignInPlant(storage: Store | null = sessionStore()): string | null {
  try {
    return storage?.getItem(STRONG_SIGN_IN_PLANT_KEY) || null;
  } catch {
    return null;
  }
}

export type StrongSignInDeps = {
  /** Ends the session and clears the cache; resolves when done (or failed). */
  signOut(): Promise<unknown>;
  /** Goes to `/login?error=STRONG_SIGN_IN_NEEDED`. */
  toLogin(): Promise<unknown> | void;
  /** Reads `auth.me` again. */
  refreshMe(): Promise<unknown>;
  /** Goes to /welcome (its own guard sends a person who needs nothing back home). */
  toWelcome(): Promise<unknown> | void;
  remember(plant: string | null): void;
};

/**
 * One handler for every refused query and mutation. The tenant shell fires many calls at once, so
 * everything after the first refusal is ignored until the first one is handled.
 */
export function createStrongSignInHandler(deps: StrongSignInDeps, settleMs = 2000) {
  let busy = false;
  return async (refusal: { reason: StrongSignInReason; plant: string | null }): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      if (refusal.reason === "STRONG_SIGN_IN_NEEDED") {
        deps.remember(refusal.plant);
        await deps.signOut().catch(() => {});
        await deps.toLogin();
      } else {
        await deps.refreshMe().catch(() => {});
        await deps.toWelcome();
      }
    } finally {
      // Calls that were already in flight answer the same refusal a moment later: let them settle.
      setTimeout(() => {
        busy = false;
      }, settleMs);
    }
  };
}
