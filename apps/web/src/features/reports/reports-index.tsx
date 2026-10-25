import { useT } from "@orrn/i18n";
import { ActionTile } from "@orrn/ui/components/action-tile";
import { PageHeader } from "@orrn/ui/components/page-header";
import { CalendarClock, Cylinder, Factory, ListChecks } from "lucide-react";

import { ReportsGate } from "./report-chrome";

/** `/reports`: the four office reports (reports.read). */
export function ReportsIndex() {
  const { t } = useT();
  const items = [
    { to: "/reports/production", title: t("reports.list.production"), hint: t("reports.list.productionBody"), icon: <Factory aria-hidden="true" className="size-5" />, accent: "green" as const },
    { to: "/reports/die-life", title: t("reports.list.dieLife"), hint: t("reports.list.dieLifeBody"), icon: <Cylinder aria-hidden="true" className="size-5" />, accent: "red" as const },
    { to: "/reports/stock-age", title: t("reports.list.stockAge"), hint: t("reports.list.stockAgeBody"), icon: <CalendarClock aria-hidden="true" className="size-5" />, accent: "amber" as const },
    { to: "/reports/orders", title: t("reports.list.orders"), hint: t("reports.list.ordersBody"), icon: <ListChecks aria-hidden="true" className="size-5" />, accent: "blue" as const },
  ];
  return (
    <>
      <PageHeader title={t("reports.title")} subtitle={t("reports.subtitle")} />
      <ReportsGate>
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2" data-testid="reports-list">
          {items.map((i) => (
            <li key={i.to} className="min-w-0">
              <ActionTile tone="neutral" accent={i.accent} to={i.to} title={i.title} hint={i.hint} icon={i.icon} className="h-full" />
            </li>
          ))}
        </ul>
      </ReportsGate>
    </>
  );
}
