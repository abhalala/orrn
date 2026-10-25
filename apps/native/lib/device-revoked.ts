/** The machine reason `device.register` puts in `error.data.meta.reason` when this install was turned off (routers/release.ts). */
export const DEVICE_REVOKED_REASON = "device_revoked";

/**
 * True when `device.register` refused because this install was turned off for the plant. Decided on the
 * server's code (`data.meta.reason`), never on its English sentence, so a reworded or translated message
 * cannot keep a turned-off phone signed in. Another FORBIDDEN (a suspended plant) is not a revoke.
 */
export function isDeviceRevoked(error: unknown): boolean {
  const e = error as { data?: { code?: unknown; meta?: { reason?: unknown } | null } | null } | null | undefined;
  return e?.data?.code === "FORBIDDEN" && e.data.meta?.reason === DEVICE_REVOKED_REASON;
}
