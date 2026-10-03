/** Matches the FORBIDDEN message `authedProcedure` throws for a bad grant (packages/server/src/index.ts). */
export const IMPERSONATION_FORBIDDEN_MESSAGE = "Invalid, expired, or revoked impersonation grant";

type TrpcLike = { message?: unknown; data?: { code?: unknown; httpStatus?: unknown } | null };

function asTrpcLike(error: unknown): TrpcLike | null {
  return error && typeof error === "object" ? (error as TrpcLike) : null;
}

export function isUnauthorized(error: unknown): boolean {
  return asTrpcLike(error)?.data?.code === "UNAUTHORIZED";
}

export function isImpersonationForbidden(error: unknown): boolean {
  const e = asTrpcLike(error);
  return (
    e?.data?.code === "FORBIDDEN" &&
    typeof e.message === "string" &&
    e.message.includes(IMPERSONATION_FORBIDDEN_MESSAGE)
  );
}

/** tRPC 4xx: the request itself is wrong or not allowed, so repeating it cannot help. */
export function isClientError(error: unknown): boolean {
  const status = asTrpcLike(error)?.data?.httpStatus;
  return typeof status === "number" && status >= 400 && status < 500;
}

/** React Query `retry`: no retry on 4xx; transient failures retry up to 3 times. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isClientError(error)) return false;
  return failureCount < 3;
}

const PUBLIC_EXACT = new Set(["/", "/login", "/waitlist", "/request-access"]);

/** Paths that render for signed-out visitors, so an UNAUTHORIZED there must not redirect. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || pathname.startsWith("/invite/");
}
