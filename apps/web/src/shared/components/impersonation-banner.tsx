import { useT } from "@orrn/i18n";
import { ImpersonationBanner as SharedImpersonationBanner } from "@orrn/ui/components/impersonation-banner";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { formatTime } from "@/features/admin/format";
import { accessTabPath, impersonationEndsSoon } from "@/features/admin/impersonate";

import { clearImpersonation } from "../lib/impersonation";
import { useMe } from "../lib/me";
import { queryClient, trpc } from "../utils/trpc";

/** Leave the company: forget the grant, drop every cached query, and load Godseye fresh. */
function leaveTo(path: string) {
  clearImpersonation();
  queryClient.clear();
  window.location.assign(path);
}

/**
 * Shown on every signed-in web screen while orrn staff are inside a company.
 * "Stop impersonating" revokes the grant, clears sessionStorage and the
 * query cache, and returns to that company's Access tab in Godseye. When the
 * grant's end time passes it does the same on its own (no request needed:
 * the server already refuses an expired grant).
 */
export function ImpersonationBanner() {
  const { t, locale } = useT();
  const { data: me } = useMe();
  const impersonation = me?.impersonation ?? null;
  const [now, setNow] = useState(() => new Date());

  const revokeMutation = useMutation({
    ...trpc.platform.impersonationRevokeGrant.mutationOptions(),
  });

  const companyId = impersonation?.companyId;
  const expiresAt = impersonation?.expiresAt;

  // One timer to the end of the grant, and one to the "ends soon" moment, so the line updates without polling.
  useEffect(() => {
    if (!companyId || !expiresAt) return;
    const end = new Date(expiresAt).getTime();
    const left = end - Date.now();
    if (left <= 0) {
      leaveTo(accessTabPath(companyId));
      return;
    }
    const timers = [window.setTimeout(() => leaveTo(accessTabPath(companyId)), left)];
    const soonAt = left - 5 * 60_000;
    if (soonAt > 0) timers.push(window.setTimeout(() => setNow(new Date()), soonAt + 50));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [companyId, expiresAt]);

  if (!impersonation) return null;

  const company = me?.company?.name ?? impersonation.companyId;
  const time = formatTime(impersonation.expiresAt, locale);
  const detail = impersonationEndsSoon(impersonation.expiresAt, now)
    ? t("admin.access.endsSoon", { time })
    : t("admin.access.expires", { time });

  return (
    <SharedImpersonationBanner
      companyName={company}
      message={t("admin.access.banner", { company })}
      detail={detail}
      stopLabel={t("admin.access.stop")}
      stopping={revokeMutation.isPending}
      onStop={() => {
        const finish = () => leaveTo(accessTabPath(impersonation.companyId));
        revokeMutation.mutate({ id: impersonation.grantId }, { onSettled: finish });
      }}
    />
  );
}
