import type { createDb } from "@orrn/db";
import { APIError } from "better-auth/api";

import { clientIp, throttleHit } from "./reset-throttle";

type Db = ReturnType<typeof createDb>;

/**
 * Council round 1, A10: `GET /passkey/generate-authenticate-options` is public (the sign-in page asks
 * for it before anyone is known) and writes a challenge row on every call. It is limited per client IP
 * in `auth_throttle`, generously: the web sign-in page asks on every visit and a plant's phones and
 * PCs share one IP behind its router. A request with no readable IP (local dev, e2e) is not limited.
 */
export const PASSKEY_OPTIONS_PATH = "/passkey/generate-authenticate-options";
export const PASSKEY_OPTIONS_LIMIT = { max: 120, windowMs: 10 * 60 * 1000 } as const;

export async function limitPasskeyOptions(db: Db, ctx: { path?: string; request?: Request; headers?: Headers }): Promise<void> {
  if (ctx.path !== PASSKEY_OPTIONS_PATH) return;
  const ip = clientIp(ctx.request?.headers ?? ctx.headers);
  if (!ip) return;
  if (!(await throttleHit(db, `passkey-options:i:${ip}`, Date.now(), PASSKEY_OPTIONS_LIMIT))) {
    throw new APIError("TOO_MANY_REQUESTS", { message: "Too many requests. Try again in a few minutes." });
  }
}
