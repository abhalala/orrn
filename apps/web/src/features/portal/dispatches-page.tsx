import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { trpc } from "@/shared/utils/trpc";

import { usePortalMe } from "./hooks";
import { kgText, pcsText } from "./model";
import { dateText, PortalError } from "./ui";

const STEP = 20;

/** `/portal/dispatches`: this party's completed dispatches only. */
export function PortalDispatchesPage() {
  const { t, locale } = useT();
  const me = usePortalMe();
  const [limit, setLimit] = useState(STEP);
  const list = useQuery({ ...trpc.portal.dispatches.list.queryOptions({ limit }), placeholderData: keepPreviousData, retry: false });
  type Row = NonNullable<typeof list.data>["items"][number];
  const zone = me.data?.timeZone ?? "Asia/Kolkata";

  const columns: ResponsiveListColumn<Row>[] = [
    { key: "code", header: t("portal.dispatches.code"), cell: (d) => <span className="font-mono font-semibold whitespace-nowrap">{d.code}</span> },
    { key: "date", header: t("portal.dispatches.date"), cell: (d) => <span className="whitespace-nowrap">{dateText(d.completedAt, locale, zone)}</span> },
    { key: "pl", header: t("portal.dispatches.plNo"), hideOnPhone: true, cell: (d) => <span className="font-mono">{d.plNumber ?? ""}</span> },
    { key: "vehicle", header: t("portal.dispatches.vehicle"), hideOnPhone: true, cell: (d) => <span className="font-mono">{d.vehicleNo ?? ""}</span> },
    { key: "bundles", header: t("portal.dispatches.bundlesLabel"), align: "end", cell: (d) => <span className="font-mono tabular-nums">{pcsText(d.bundles)}</span> },
    { key: "weight", header: t("portal.dispatches.weight"), align: "end", cell: (d) => <span className="font-mono tabular-nums">{kgText(d.weightG)}</span> },
  ];

  return (
    <>
      <PageHeader title={t("portal.dispatches.title")} subtitle={t("portal.dispatches.subtitle")} />
      {list.isError && !list.data ? (
        <PortalError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <>
          <ResponsiveList<Row>
            label={t("portal.dispatches.title")}
            rows={list.data?.items ?? []}
            columns={columns}
            rowKey={(d) => d.id}
            rowHref={(d) => `/portal/dispatches/${d.id}`}
            loading={list.isPending}
            empty={<EmptyState title={t("portal.dispatches.empty")} />}
          />
          {list.data?.nextOffset != null ? (
            <div>
              <Button variant="secondary" onClick={() => setLimit((n) => n + STEP)}>
                {t("portal.orders.showMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
