import { useT } from "@orrn/i18n";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Tabs } from "@orrn/ui/components/tabs";
import { lazy, Suspense } from "react";

import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";

import { useCostingOn } from "./hooks";
import { COST_TABS, type CostingSearch, type CostTab } from "./search";

const OutlookTab = lazy(() => import("./outlook-tab").then((m) => ({ default: m.OutlookTab })));
const CostTabView = lazy(() => import("./cost-tab").then((m) => ({ default: m.CostTab })));
const ProfitTab = lazy(() => import("./profit-tab").then((m) => ({ default: m.ProfitTab })));
const CapacityTab = lazy(() => import("./capacity-tab").then((m) => ({ default: m.CapacityTab })));
const ForecastTab = lazy(() => import("./forecast-tab").then((m) => ({ default: m.ForecastTab })));
const DiesTab = lazy(() => import("./dies-tab").then((m) => ({ default: m.DiesTab })));
const SettingsTab = lazy(() => import("./settings-tab").then((m) => ({ default: m.SettingsTab })));

/**
 * `/costing` (XE parity lane COST, module `costing`, opt-in): cost per kg, profit, press load, the order forecast
 * and the dies due, with the settings behind them. With the module off nothing is asked of the server.
 */
export function CostingPage({ search, onSearch }: { search: CostingSearch; onSearch(next: CostingSearch): void }) {
  const { t } = useT();
  const me = useMe();
  const moduleOn = useCostingOn();
  const tab: CostTab = search.tab ?? "outlook";
  const header = <PageHeader title={t("cost.title")} subtitle={t("cost.subtitle")} back={{ to: "/today", label: t("nav.today") }} />;
  if (me.data === undefined) {
    return (
      <>
        {header}
        <Skeleton className="h-40 rounded-card" />
      </>
    );
  }
  if (!moduleOn) {
    return (
      <>
        {header}
        <p data-testid="costing-module-off" className="m-0 rounded-card border border-border bg-card px-4 py-3 text-[15px]">
          {t("cost.moduleOff")}
        </p>
      </>
    );
  }
  const go = (next: CostTab) => onSearch(next === "outlook" ? {} : { tab: next });
  return (
    <>
      {header}
      <Can do="cost.view" fallback={<p className="m-0 rounded-card border border-border bg-card px-4 py-3 text-[15px]">{t("cost.noAccess")}</p>}>
        <Tabs label={t("cost.title")} items={COST_TABS.map((id) => ({ id, label: t(`cost.tabs.${id}`) }))} value={tab} onValueChange={(next) => go(next as CostTab)}>
          <div className="min-w-0 pt-4" data-testid={`costing-tab-${tab}`}>
            <Suspense fallback={<Skeleton className="h-40 rounded-card" />}>
              {tab === "outlook" ? <OutlookTab onTab={go} /> : null}
              {tab === "cost" ? <CostTabView /> : null}
              {tab === "profit" ? <ProfitTab /> : null}
              {tab === "capacity" ? <CapacityTab /> : null}
              {tab === "forecast" ? <ForecastTab /> : null}
              {tab === "dies" ? <DiesTab /> : null}
              {tab === "settings" ? <SettingsTab /> : null}
            </Suspense>
          </div>
        </Tabs>
      </Can>
    </>
  );
}
