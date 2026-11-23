import type { createDb } from "@orrn/db";

type Db = ReturnType<typeof createDb>;

/**
 * What `@orrn/server` lends the auth package (it cannot import `@orrn/server`). Its own module, with
 * no runtime imports, so `@orrn/server`'s `context.ts` can register it at load without evaluating
 * better-auth at Worker startup (Cloudflare 10021 startup CPU cap). Read by `google-guard.ts`.
 */
export type AuthHooks = {
  /** Accepts every live invite for the email; returns how many. Refusals are skipped, never thrown. */
  acceptLiveInvitesFor?: (db: Db, userId: string, email: string) => Promise<number>;
};

// Module state on purpose: `resetAuthForTests` drops auth instances, never this registration.
let registered: AuthHooks = {};

/** Called once by `@orrn/server` when it loads (`context.ts`, next to `createAuth`). */
export function configureAuthHooks(hooks: AuthHooks): void {
  registered = { ...registered, ...hooks };
}

/** The hooks registered so far. */
export function registeredAuthHooks(): AuthHooks {
  return registered;
}
