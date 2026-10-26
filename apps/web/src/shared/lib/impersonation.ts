const STORAGE_KEY = "orrn:impersonate-company-id";

export type StoredImpersonation = { companyId: string; expiresAt: number };

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" || !sessionStorage ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** True when sessionStorage holds any value under the impersonation key (even a corrupt one). */
export function hasStoredImpersonation(): boolean {
  try {
    return storage()?.getItem(STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

export function clearImpersonation() {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Active impersonation target, or null. Expired, corrupt, or legacy values are
 * dropped on read so a stale grant can never keep the header on every request
 * (the server answers FORBIDDEN to all calls, `auth.me` included).
 */
export function getImpersonation(now: number = Date.now()): StoredImpersonation | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw == null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const { companyId, expiresAt } = parsed as Record<string, unknown>;
      if (
        typeof companyId === "string" &&
        companyId.length > 0 &&
        typeof expiresAt === "number" &&
        Number.isFinite(expiresAt) &&
        expiresAt > now
      ) {
        return { companyId, expiresAt };
      }
    }
  } catch {
    // fall through: corrupt value
  }
  clearImpersonation();
  return null;
}

/** Remember the target company until the grant's `expiresAt` (ISO string or Date). */
export function setImpersonation(companyId: string, expiresAtIso: string | Date) {
  const expiresAt = new Date(expiresAtIso).getTime();
  if (!companyId || !Number.isFinite(expiresAt)) return;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ companyId, expiresAt }));
  } catch {
    // private browsing / quota
  }
}
