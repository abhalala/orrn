import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/shared/utils/trpc";

import { lifeChip, lifeHeader, lifeTone } from "./model";

/**
 * The die card's Runs tab header (W4-ANALYTICS, spec §E1 "Life"): "N % used" or "Life reached",
 * from `analytics.dieLife` for this one copy. A warning only; nothing is blocked by it.
 */
export function DieLifeHeader({ copyId }: { copyId: string }) {
  const { t } = useT();
  const life = useQuery({ ...trpc.analytics.dieLife.queryOptions({ dieInstanceId: copyId, includeRetired: true }), retry: false });
  const item = life.data?.items[0];
  if (!item) return null;
  return (
    <div className="mb-3 flex min-w-0 flex-col gap-1.5" data-testid="die-life-header" data-state={item.state}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Chip tone={lifeTone(item.state)} truncate={false}>
          {lifeChip(item, t)}
        </Chip>
        <span className="text-[14px] leading-5 text-muted-foreground">{lifeHeader(item, t)}</span>
      </div>
      {item.reached ? (
        <p role="note" className="m-0 text-[13px] leading-5 font-medium text-destructive">
          {t("reports.dieLife.cardReached")}
        </p>
      ) : null}
    </div>
  );
}
