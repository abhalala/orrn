type TrpcLike = { data?: { code?: unknown } | null };

/** tRPC error code ("NOT_FOUND", "FORBIDDEN"...), or null when the server never answered. Tiny on purpose: the shell's banner imports it. */
export function errorCode(error: unknown): string | null {
  const code = error && typeof error === "object" ? (error as TrpcLike).data?.code : null;
  return typeof code === "string" ? code : null;
}
