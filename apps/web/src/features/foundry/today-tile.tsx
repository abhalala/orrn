import { useT } from "@orrn/i18n";
import { UiLink } from "@orrn/ui/components/link";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { useQuery } from "@tanstack/react-query";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { todayCounts } from "./model";
import { TodaySpectroInbox } from "./today-inbox";

/**
 * Today's Foundry tile for the people who enter casts (cast.enter): open casts, melts in progress
 * (drafts) and spectro files waiting for a melt. Figures come from the list of open casts and the inbox (a simulated file can only be dismissed, so it is not counted as waiting: final fixes 5, L9); the
 * spectro chip below keeps its own link to the inbox.
 */
export function TodayFoundryTile() {
  const { t } = useT();
  const casts = useQuery({ ...trpc.foundry.casts.list.queryOptions({ status: "open", limit: 200, offset: 0 }), meta: INLINE_ERROR_META });
  const inbox = useQuery({ ...trpc.foundry.spectroInbox.list.queryOptions(), meta: INLINE_ERROR_META });
  const n = todayCounts(casts.data, (inbox.data ?? []).filter((r) => !r.simulated).length);
  return (
    <section aria-labelledby="today-foundry" data-testid="today-foundry" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-foundry" className="m-0 text-[17px] font-semibold">
          {t("foundry.today.title")}
        </h2>
        <UiLink to="/casts" className="text-[14px] font-semibold text-foreground underline underline-offset-4">
          {t("foundry.today.open")}
        </UiLink>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatusBlock tone="blue" title={t("foundry.today.openCasts")} meta={t("foundry.today.openCastsMeta")} value={n.openCasts} countUp={false} href="/casts?status=open" />
        <StatusBlock tone={n.meltsInProgress > 0 ? "amber" : "neutral"} title={t("foundry.today.melts")} meta={t("foundry.today.meltsMeta")} value={n.meltsInProgress} countUp={false} href="/casts?status=open" />
        <StatusBlock tone={n.spectroPending > 0 ? "amber" : "neutral"} title={t("foundry.today.spectro")} meta={t("foundry.today.spectroMeta")} value={n.spectroPending} countUp={false} href="/casts/inbox" />
      </div>
      <TodaySpectroInbox />
    </section>
  );
}
