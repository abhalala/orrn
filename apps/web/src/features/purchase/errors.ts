/**
 * Reading tRPC failures on the purchase and approval screens: a refusal names its code; a save
 * that got no answer at all may still have landed on the server.
 */
type TrpcLike = { data?: { code?: unknown } | null };

export function errorCode(error: unknown): string | undefined {
  const code = error && typeof error === "object" ? (error as TrpcLike).data?.code : undefined;
  return typeof code === "string" ? code : undefined;
}

/** No tRPC code: the request or its reply was lost on the way, so the save may have been committed. */
export function saveMayHaveLanded(error: unknown): boolean {
  return errorCode(error) === undefined;
}

/** "Already decided", "This lot changed": the screen's data is stale; refresh it. */
export function isStaleRefusal(error: unknown): boolean {
  const code = errorCode(error);
  return code === "BAD_REQUEST" || code === "CONFLICT";
}

export function isForbidden(error: unknown): boolean {
  return errorCode(error) === "FORBIDDEN";
}
