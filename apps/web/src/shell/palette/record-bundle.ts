import type { Me } from "@orrn/server/lib/permissions";
import { useEffect } from "react";

import { useMe } from "@/shared/lib/me";

import { bundleRecent, pushRecent } from "./recents";

/**
 * A bundle becomes a recent only once its page has loaded it (QA F1): a mistyped serial or a bundle of another
 * plant shows "Not found" and is never remembered. Same rules as the palette: per user and plant, and never while
 * impersonating.
 */
export function recordBundleVisit(me: Me | null | undefined, serial: string): void {
  const userId = me?.impersonation ? undefined : me?.user.id;
  const companyId = me?.company?.id;
  if (userId && companyId && serial) pushRecent(userId, companyId, bundleRecent(serial));
}

/** Call from the bundle page's found state, with the bundle's own number. */
export function useRecordBundleVisit(serial: string): void {
  const { data: me } = useMe();
  const userId = me?.impersonation ? undefined : me?.user.id;
  const companyId = me?.company?.id;
  useEffect(() => {
    recordBundleVisit(me, serial);
    // `me` only matters through the ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial, userId, companyId]);
}
