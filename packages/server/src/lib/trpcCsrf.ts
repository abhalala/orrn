import { isAllowedOrigin } from "./corsOrigin";

/**
 * CSRF guard for `/trpc/*` (fix round item 15, BUDDY-SECURITY-REVIEW M5).
 *
 * The session cookie is `SameSite=None`, and tRPC's fetch adapter also takes multipart and other non-JSON bodies
 * for a mutation. A page on another site could then auto-submit a form that runs a mutation as the signed-in
 * person. Two rules, applied to every POST before tRPC sees it:
 *
 * - The body must be JSON (`application/json`, any parameters). Anything else is 415. A browser form can only send
 *   `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`, so no form can pass.
 * - An `Origin` header, when present, must be one the CORS middleware allows (the same allowlist). A request with
 *   no Origin (the native app, server to server) still works: a browser always sends Origin on a cross-site POST.
 *
 * GET (queries) is unchanged. Better Auth and the `/files/*` routes are not under `/trpc` and are not touched.
 */
export type CsrfEnv = { NODE_ENV?: string; CORS_ORIGIN: string; CORS_ALLOWED_ORIGINS?: string };

export type CsrfRefusal = { status: 415 | 403; message: string };

/** Why a request fails the guard, or null when it may go on to tRPC. The Worker answers with `c.text`, so CORS headers stay. */
export function trpcCsrfRefusal(env: CsrfEnv, request: Request): CsrfRefusal | null {
  if (request.method !== "POST") return null;
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") return { status: 415, message: "Send this request as JSON" };
  const origin = request.headers.get("origin");
  if (origin !== null && !isAllowedOrigin(env, origin)) return { status: 403, message: "This site may not send requests to orrn" };
  return null;
}
