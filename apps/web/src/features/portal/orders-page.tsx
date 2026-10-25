import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

import { RouterLink } from "@/shared/components/router-link";
import { trpc } from "@/shared/utils/trpc";

import { isPortalOrderStatus, kgText, PORTAL_STATUS_TONE } from "./model";
import { bookDate, PortalError } from "./ui";

type Show = "open" | "all";
const STEP = 20;

/** `/portal/orders`: this party's orders with ordered / baki. No rate anywhere. */
export function PortalOrdersPage() {
  const { t, locale } = useT();
  const [show, setShow] = useState<Show>("open");
  const [limit, setLimit] = useState(STEP);
  const today = useQuery({ ...trpc.portal.today.queryOptions(), retry: false });
  const list = useQuery({
    ...trpc.portal.orders.list.queryOptions({ status: show, limit }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  type Row = NonNullable<typeof list.data>["items"][number];

  const columns: ResponsiveListColumn<Row>[] = [
    { key: "number", header: t("portal.orders.number"), cell: (o) => <span className="font-mono font-semibold whitespace-nowrap">{o.number}</span> },
    {
      key: "status",
      header: t("portal.orders.statusLabel"),
      phoneWide: true,
      cell: (o) =>
        isPortalOrderStatus(o.status) ? (
          <Chip tone={PORTAL_STATUS_TONE[o.status]} truncate={false}>
            {t(`portal.orders.status.${o.status}`)}
          </Chip>
        ) : (
          o.status
        ),
    },
    { key: "date", header: t("portal.orders.date"), hideOnPhone: true, cell: (o) => <span className="whitespace-nowrap">{bookDate(o.orderDate, locale)}</span> },
    { key: "po", header: t("portal.orders.poNumber"), hideOnPhone: true, cell: (o) => (o.poNumber ? <span className="font-mono break-all">{o.poNumber}</span> : "") },
    { key: "ordered", header: t("portal.orders.ordered"), align: "end", cell: (o) => <span className="font-mono tabular-nums">{kgText(o.totals.orderedG)}</span> },
    { key: "baki", header: t("portal.orders.baki"), align: "end", cell: (o) => <span className="font-mono tabular-nums">{kgText(o.totals.bakiG)}</span> },
  ];

  return (
    <>
      <PageHeader
        title={t("portal.orders.title")}
        actions={
          today.data?.canOrder ? (
            <Button asChild size="lg">
              <RouterLink to="/portal/orders/new">
                <Plus aria-hidden="true" strokeWidth={2} />
                {t("portal.orders.new")}
              </RouterLink>
            </Button>
          ) : undefined
        }
      />
      <SegmentedControl<Show>
        label={t("portal.orders.filterLabel")}
        value={show}
        onChange={(v) => {
          setShow(v);
          setLimit(STEP);
        }}
        options={[
          { value: "open", label: t("portal.orders.filterOpen") },
          { value: "all", label: t("portal.orders.filterAll") },
        ]}
      />
      <p className="m-0 text-[13px] leading-5 text-muted-foreground" data-testid="portal-baki-hint">
        {t("portal.orders.bakiHint")}
      </p>
      {list.isError && !list.data ? (
        <PortalError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <>
          <ResponsiveList<Row>
            label={t("portal.orders.title")}
            rows={list.data?.items ?? []}
            columns={columns}
            rowKey={(o) => o.id}
            rowHref={(o) => `/portal/orders/${o.id}`}
            loading={list.isPending}
            empty={<EmptyState title={t("portal.orders.empty")} />}
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
