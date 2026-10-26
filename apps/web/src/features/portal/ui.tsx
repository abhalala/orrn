import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Skeleton } from "@orrn/ui/components/skeleton";

import { portalErrorKey } from "./model";

/** A refusal or a failed load, in the party's words, with Try again. A miss is "Not found" and offers no retry. */
export function PortalError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useT();
  const key = portalErrorKey(error);
  return (
    <div role="alert" className="rounded-card border border-border bg-card">
      <EmptyState
        title={t(key)}
        action={
          onRetry && key !== "portal.errors.notFound" ? (
            <Button variant="secondary" onClick={onRetry}>
              {t("common.retry")}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

export function PortalSkeleton({ rows = 3 }: { rows?: number }) {
  const { t } = useT();
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{t("common.loading")}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-[96px] w-full rounded-card" />
      ))}
    </div>
  );
}

export { bookDate } from "./model";
