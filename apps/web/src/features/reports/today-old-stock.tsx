import { useT } from "@orrn/i18n";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/shared/utils/trpc";

import { kgWholeText } from "./model";

/**
 * Today's "Stock older than 90 days" tile (FP-PK-16) for the people who see the charts
 * (analytics.view: owner, admin, manager, office, accountant; mounted inside that gate). The count
 * and kg are `analytics.stockAge().over90`, the server's; it opens `/reports/stock-age`.
 */
export function TodayOldStockTile() {
  const { t } = useT();
  const age = useQuery({ ...trpc.analytics.stockAge.queryOptions({}), retry: false });
  if (!age.data) return null;
  const { bundles, kgG } = age.data.over90;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="today-old-stock">
      <StatusBlock
        tone={bundles > 0 ? "amber" : "neutral"}
        title={t("reports.todayTile.title")}
        meta={t("reports.todayTile.meta", { kg: kgWholeText(kgG) })}
        value={bundles}
        countUp={false}
        href="/reports/stock-age"
      />
    </div>
  );
}
