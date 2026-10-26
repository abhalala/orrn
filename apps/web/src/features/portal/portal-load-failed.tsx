import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { useRouter } from "@tanstack/react-router";
import { WifiOff } from "lucide-react";

/**
 * `/portal*` when the door could not ask the server (offline, a server error). Not "no plants":
 * the party is told to try again. The layout's error screen (`_portal` errorComponent).
 */
export function PortalLoadFailed() {
  const { t } = useT();
  const router = useRouter();
  return (
    <main id="main" tabIndex={-1} className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-background px-4 py-16 text-center text-foreground outline-none">
      <div aria-hidden="true" className="flex size-14 items-center justify-center rounded-card bg-surface-sunken">
        <WifiOff size={26} aria-hidden="true" />
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="m-0 font-display text-2xl font-extrabold tracking-[-0.03em]">{t("portal.errors.loadFailed")}</h1>
        <p className="m-0 text-[15px] leading-6 text-muted-foreground">{t("portal.errors.loadFailedBody")}</p>
      </div>
      <Button onClick={() => void router.invalidate()}>{t("common.retry")}</Button>
    </main>
  );
}
