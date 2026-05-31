const STORAGE_KEY = "orrn:impersonate-company-id";

/** Company id sent as `x-orrn-impersonate-company` while impersonating. */
export function getImpersonateCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setImpersonateCompanyId(companyId: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, companyId);
  } catch {
    // private browsing / quota
  }
}

export function clearImpersonateCompanyId() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
