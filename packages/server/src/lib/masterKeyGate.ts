import type { MiddlewareHandler } from "hono";

import { isUnsafeMasterKey } from "@orrn/crypto";

/**
 * Fail closed (security review 2026-11-04, MEDIUM 4): a production Worker whose ORRN_MASTER_KEY is
 * missing or is the public all-zero dev key answers every request with 503 rather than signing
 * links and wrapping secrets with a key anyone with the source knows. The deploy refuses that key
 * first (infra/masterKey.ts); this catches a binding changed after the deploy. Development and
 * test stages are not affected (local dev uses the all-zero key on purpose).
 */
export function masterKeyGate(env: () => { NODE_ENV?: string; ORRN_MASTER_KEY?: string }): MiddlewareHandler {
  return async (c, next) => {
    const vars = env();
    if (vars.NODE_ENV === "production" && isUnsafeMasterKey(vars.ORRN_MASTER_KEY)) {
      console.error("ORRN_MASTER_KEY is missing or is the public dev key: refusing to serve.");
      return c.text("Server is not configured", 503);
    }
    await next();
  };
}
