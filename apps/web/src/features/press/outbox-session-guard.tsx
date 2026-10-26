/**
 * FP-PR-19 (W4-NEXTROWS, review I-1): mounted once in the signed-in shell. It tells `outbox-session` who
 * is signed in (person and plant), and says how many press changes are still waiting when that person
 * signs out or switches plant. The changes stay saved under their own key; they never go out as someone else.
 */
import { useT } from "@orrn/i18n";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useMe } from "@/shared/lib/me";

import { registerLeaveWarning, setActiveSession } from "./outbox-session";

export function OutboxSessionGuard() {
  const { t } = useT();
  const { data: me } = useMe();
  const companyId = me?.company?.id ?? null;
  const userId = me?.user?.id ?? null;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    setActiveSession(companyId && userId ? { companyId, userId } : null);
  }, [companyId, userId]);

  useEffect(
    () =>
      registerLeaveWarning((count, why) => {
        const key =
          why === "signOut" ? "press.console.outbox.signOutLeft" : why === "offline" ? "press.console.outbox.offlineLeft" : "press.console.outbox.plantLeft";
        toast.warning(tRef.current(key, { count }), { duration: 12_000 });
      }),
    [],
  );
  return null;
}
