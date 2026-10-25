/**
 * True when `device.register` refused because this install was turned off for the plant: FORBIDDEN with
 * the server's "turned off" sentence (another FORBIDDEN, like a suspended plant, is not a revoke).
 */
export function isDeviceRevoked(error: unknown): boolean {
  const e = error as { data?: { code?: unknown } | null; message?: unknown } | null | undefined;
  return e?.data?.code === "FORBIDDEN" && typeof e.message === "string" && e.message.includes("turned off");
}
