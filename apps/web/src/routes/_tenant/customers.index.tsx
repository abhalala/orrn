import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { cn } from "@orrn/ui/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FileUp, Plus } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";

import { ListSearch } from "@/features/catalog/list-search";
import { OverflowMenu } from "@/features/catalog/overflow-menu";
import { offsetParam, searchTermParam } from "@/features/catalog/search-param";
import { ChartCardSkeleton } from "@/features/customers/chart-card-skeleton";
import { PeriodRow } from "@/features/customers/period-row";
import { periodSearch, rememberPeriod, usePeriod } from "@/features/customers/use-period";
import type { Period } from "@/features/customers/period";
import { Can } from "@/shared/components/can";
import { ImportCustomersModal } from "@/shared/components/import-customers-modal";
import { can, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

// The chart kit loads only for analytics.view roles (never in the entry chunk).
const LeaderboardCard = lazy(() => import("@/features/customers/customer-charts").then((m) => ({ default: m.LeaderboardCard })));

const PAGE = 50;

type CustomersSearch = { q?: string; offset?: number; period?: Period };

export const Route = createFileRoute("/_tenant/customers/")({
  validateSearch: (search: Record<string, unknown>): CustomersSearch => ({
    q: searchTermParam(search.q),
    offset: offsetParam(search.offset),
    period: periodSearch(search.period),
  }),
  component: CustomersList,
});

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  taxId: string | null;
  billingAddress: Record<string, unknown> | null;
};

function cityOf(c: CustomerRow): string {
  const city = c.billingAddress?.city;
  return typeof city === "string" ? city : "";
}

function CustomersList() {
  const { t } = useT();
  const { data: me } = useMe();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [importing, setImporting] = useState(false);
  const q = search.q ?? "";
  const offset = search.offset ?? 0;
  const analytics = can(me, "analytics.view");
  const { period, range, today } = usePeriod(search.period);

  const list = useQuery({
    ...trpc.customer.list.queryOptions({ search: q || undefined, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  const kg = useQuery({
    ...trpc.analytics.customerKg.queryOptions({ from: range.from, to: range.to }),
    enabled: analytics,
    placeholderData: keepPreviousData,
  });
  const kgById = useMemo(() => new Map((kg.data?.rows ?? []).map((r) => [r.customerId, r.kgG])), [kg.data]);

  const setPeriod = (next: Period) => {
    rememberPeriod(next);
    navigate({ search: (prev: CustomersSearch) => ({ ...prev, period: next }), replace: true });
  };

  const columns: ResponsiveListColumn<CustomerRow>[] = [
    { key: "name", header: t("customers.columns.name"), cell: (c) => c.name },
    {
      key: "city",
      header: t("customers.columns.city"),
      cell: (c) => cityOf(c),
    },
    {
      key: "phone",
      header: t("customers.columns.phone"),
      cell: (c) => (c.phone ? <span className="whitespace-nowrap tabular-nums">{c.phone}</span> : null),
    },
    {
      key: "gstin",
      header: t("customers.columns.gstin"),
      hideOnPhone: true,
      cell: (c) =>
        c.taxId ? (
          <span data-no-truncate="" className="font-mono text-[13px] whitespace-nowrap">
            {c.taxId}
          </span>
        ) : null,
    },
  ];
  // The kg column is known only when customerKg has answered: pending or failed reads leave the
  // cells empty (never "0.0", which would say the customer took nothing), and a previous period's
  // figures stay dimmed while the new period loads.
  const kgKnown = kg.data !== undefined;
  const kgFailed = kg.isError && !kgKnown;
  const kgStale = kg.isPlaceholderData;
  if (analytics) {
    columns.push({
      key: "kg",
      header: t("customers.columns.kg"),
      align: "end",
      cell: (c) => {
        if (!kgKnown) return null;
        const g = kgById.get(c.id) ?? 0;
        return (
          <span
            data-no-truncate=""
            aria-busy={kgStale || undefined}
            className={cn(
              "font-mono whitespace-nowrap transition-opacity",
              g > 0 ? "font-semibold" : "text-muted-foreground",
              kgStale && "opacity-60",
            )}
          >
            {formatKgTotal(g / 1000)}
          </span>
        );
      },
    });
  }

  const rows = (list.data?.items ?? []) as CustomerRow[];

  return (
    <>
      <PageHeader
        title={t("customers.title")}
        subtitle={t("customers.subtitle")}
        actions={
          <>
            <HowToButton slug="add-customer" />
            <OverflowMenu
              items={
                can(me, "customer.import")
                  ? [
                      {
                        key: "import",
                        label: t("customers.importCsv"),
                        icon: <FileUp aria-hidden="true" strokeWidth={2} />,
                        onSelect: () => setImporting(true),
                      },
                    ]
                  : []
              }
            />
            <Can do="customer.create">
              <Button asChild>
                <Link to="/customers/$id" params={{ id: "new" }}>
                  <Plus aria-hidden="true" strokeWidth={2} />
                  {t("customers.newCustomer")}
                </Link>
              </Button>
            </Can>
          </>
        }
      />

      <Can do="analytics.view">
        <PeriodRow period={period} range={range} today={today} onChange={setPeriod} />
        <Suspense fallback={<ChartCardSkeleton plotHeight={320} />}>
          <LeaderboardCard range={range} />
        </Suspense>
      </Can>

      <ListSearch
        label={t("customers.searchLabel")}
        placeholder={t("customers.search")}
        value={q}
        onSearch={(term) => navigate({ search: (prev: CustomersSearch) => ({ ...prev, q: term || undefined, offset: undefined }), replace: true })}
        className="sm:max-w-[420px]"
      />

      {analytics && kgFailed ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-card p-4">
          <p className="m-0 flex-1 text-[15px] font-medium">{t("customers.kgFailed")}</p>
          <Button variant="secondary" onClick={() => kg.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}

      <ResponsiveList
        label={t("customers.listLabel")}
        rows={rows}
        columns={columns}
        rowKey={(c) => c.id}
        rowHref={(c) => `/customers/${c.id}`}
        total={list.data?.total}
        loading={list.isFetching}
        page={{
          offset,
          limit: PAGE,
          onChange: (next) => navigate({ search: (prev: CustomersSearch) => ({ ...prev, offset: next || undefined }) }),
        }}
        empty={
          list.isError ? (
            <EmptyState
              title={t("errors.generic")}
              action={
                <Button variant="secondary" onClick={() => list.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : offset > 0 ? (
            // A link or Back past the last page: there may be customers on page one.
            <EmptyState
              title={t("customers.pageEmpty")}
              action={
                <Button asChild variant="secondary">
                  <Link to="/customers" search={(prev: CustomersSearch) => ({ ...prev, offset: undefined })}>
                    {t("customers.firstPage")}
                  </Link>
                </Button>
              }
            />
          ) : q ? (
            <EmptyState title={t("common.noResults", { query: q })} />
          ) : (
            <EmptyState
              title={t("customers.empty")}
              body={t("customers.emptyBody")}
              action={
                <Can do="customer.create">
                  <Button asChild>
                    <Link to="/customers/$id" params={{ id: "new" }}>
                      {t("customers.emptyAction")}
                    </Link>
                  </Button>
                </Can>
              }
            />
          )
        }
      />

      {importing ? (
        <ImportCustomersModal
          onClose={() => setImporting(false)}
          onSuccess={() => {
            setImporting(false);
            list.refetch();
          }}
        />
      ) : null}
    </>
  );
}
