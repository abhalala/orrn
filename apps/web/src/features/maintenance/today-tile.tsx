import { useT } from "@orrn/i18n";
import { UiLink } from "@orrn/ui/components/link";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { useQuery } from "@tanstack/react-query";

import { useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { maintReady } from "./model";

export type MaintTodayCounts = { overdue: number; soon: number; liveWorkOrders: number; flaggedReadings: number };

/** The four figures of the tile; presentational so tests render it without a server. */
export function MaintTodayBlocks({ data }: { data: MaintTodayCounts }) {
  const { t } = useT();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatusBlock tone={data.overdue > 0 ? "red" : "neutral"} title={t("maint.today.overdue")} meta={t("maint.today.overdueMeta")} value={data.overdue} countUp={false} href="/maintenance" />
      <StatusBlock tone={data.soon > 0 ? "amber" : "neutral"} title={t("maint.today.soon")} meta={t("maint.today.soonMeta")} value={data.soon} countUp={false} href="/maintenance" />
      <StatusBlock tone={data.liveWorkOrders > 0 ? "blue" : "neutral"} title={t("maint.today.live")} meta={t("maint.today.liveMeta")} value={data.liveWorkOrders} countUp={false} href="/maintenance/work-orders" />
      <StatusBlock tone={data.flaggedReadings > 0 ? "amber" : "neutral"} title={t("maint.today.flagged")} meta={t("maint.today.flaggedMeta")} value={data.flaggedReadings} countUp={false} href="/maintenance" />
    </div>
  );
}

/**
 * Today's maintenance tile for the people who raise or plan work (maint.workorder or maint.manage) when
 * the module is on. `<Can>` does not know modules, so the query is enabled only through `maintReady`.
 */
export function TodayMaintTile() {
  const { t } = useT();
  const me = useMe();
  const ready = maintReady(me.data, ["maint.workorder", "maint.manage"]);
  const today = useQuery({ ...trpc.maint.today.queryOptions(), enabled: ready, retry: false, meta: INLINE_ERROR_META });
  if (!ready || !today.data) return null;
  return (
    <section aria-labelledby="today-maint" data-testid="today-maint" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-maint" className="m-0 text-[17px] font-semibold">
          {t("maint.today.title")}
        </h2>
        <UiLink to="/maintenance" className="text-[14px] font-semibold text-foreground underline underline-offset-4">
          {t("maint.today.open")}
        </UiLink>
      </div>
      <MaintTodayBlocks data={today.data} />
    </section>
  );
}
