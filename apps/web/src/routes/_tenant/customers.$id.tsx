import { dispatchTone, formatKgTotal, type DispatchStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { FormActions } from "@orrn/ui/components/form-actions";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { riseDelay } from "@orrn/ui/components/motion";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Mail, Pencil, Phone, Trash2 } from "lucide-react";
import { lazy, Suspense, useId, useState } from "react";
import { toast } from "sonner";

import { addressLines, addressToDraft, EMPTY_ADDRESS, sameDraft } from "@/features/customers/address";
import { ChartCardSkeleton } from "@/features/customers/chart-card-skeleton";
import { BundleNumbersCard } from "@/features/customers/bundle-numbers-card";
import { CustomerForm, type StoredCustomer } from "@/features/customers/customer-form";
import { formatDay, formatDispatchDay } from "@/features/customers/dates";
import { KpiTile, KpiTileSkeleton } from "@/features/customers/kpi-tile";
import { customerShare, formatSharePct } from "@/features/customers/leaderboard";
import { customerFactsLine, type Period } from "@/features/customers/period";
import { PeriodRow } from "@/features/customers/period-row";
import { periodSearch, rememberPeriod, usePeriod, type PeriodState } from "@/features/customers/use-period";
import { CustomerPortalCard } from "@/features/portal/customer-portal-card";
import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc } from "@/shared/utils/trpc";

// The chart kit loads only for analytics.view roles (never in the entry chunk).
const VolumeCard = lazy(() => import("@/features/customers/customer-charts").then((m) => ({ default: m.VolumeCard })));
const SectionsCard = lazy(() => import("@/features/customers/customer-charts").then((m) => ({ default: m.SectionsCard })));

type CustomerSearch = { period?: Period };

export const Route = createFileRoute("/_tenant/customers/$id")({
  validateSearch: (search: Record<string, unknown>): CustomerSearch => ({ period: periodSearch(search.period) }),
  component: CustomerRoute,
});

function CustomerRoute() {
  const { id } = Route.useParams();
  // Keyed by id: the router reuses this component when only $id changes, and a customer's pager
  // offset or open sheet must not carry over to the next customer.
  return id === "new" ? <NewCustomer /> : <CustomerDetail key={id} id={id} />;
}

function NewCustomer() {
  const { t } = useT();
  const navigate = useNavigate();
  const formId = useId();
  const [pending, setPending] = useState(false);
  const back = { to: "/customers", label: t("nav.customers") };
  return (
    <Can
      do="customer.create"
      fallback={
        <>
          <PageHeader back={back} title={t("customers.form.titleNew")} />
          <EmptyState
            title={t("customers.form.cantAdd")}
            action={
              <Button asChild variant="secondary">
                <Link to="/customers">{t("customers.detail.backToList")}</Link>
              </Button>
            }
          />
        </>
      }
    >
      <PageHeader back={back} title={t("customers.form.titleNew")} actions={<HowToButton slug="add-customer" />} />
      <div className="flex w-full max-w-[720px] flex-col gap-6 rounded-card border border-border bg-card p-4 sm:p-6">
        <CustomerForm
          formId={formId}
          onPendingChange={setPending}
          onSaved={(newId) => navigate({ to: "/customers/$id", params: { id: newId }, replace: true })}
        />
        <FormActions className="max-sm:bottom-[calc(var(--shell-tabbar-offset)+12px)]">
          <Button variant="secondary" asChild>
            <Link to="/customers">{t("common.cancel")}</Link>
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {t("customers.form.submit")}
          </Button>
        </FormActions>
      </div>
    </Can>
  );
}

function CustomerDetail({ id }: { id: string }) {
  const { t } = useT();
  const { data: me } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const routeNavigate = Route.useNavigate();
  const formId = useId();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);
  const analytics = can(me, "analytics.view");
  const periodState = usePeriod(search.period);

  const query = useQuery({ ...trpc.customer.get.queryOptions({ id }), retry: false });

  const remove = useMutation({
    ...trpc.customer.delete.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: trpc.customer.list.queryKey() });
      toast.success(t("customers.detail.deleted"));
      navigate({ to: "/customers" });
    },
    onError: (error) => {
      toast.error(error.data?.code === "FORBIDDEN" ? t("errors.forbidden") : t("errors.generic"));
    },
  });

  const back = { to: "/customers", label: t("nav.customers") };

  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-11 w-28 rounded-full" />
        <Skeleton className="h-10 w-2/3 max-w-[420px]" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiTileSkeleton className="col-span-2 md:col-span-1" />
          <KpiTileSkeleton />
          <KpiTileSkeleton />
          <KpiTileSkeleton className="col-span-2 md:col-span-1" />
        </div>
      </div>
    );
  }

  // Only a first load that failed is an error page: a failed background refetch (focus, retry)
  // keeps data and sets isError, and must not throw good numbers away (T19 21:09Z gotcha).
  if (query.isError && query.data === undefined) {
    const missing = isNotFound(query.error);
    return (
      <>
        <PageHeader back={back} title={t("nav.customers")} />
        <EmptyState
          title={missing ? t("customers.detail.notFound") : t("customers.detail.loadFailed")}
          action={
            missing ? (
              <Button asChild variant="secondary">
                <Link to="/customers">{t("customers.detail.backToList")}</Link>
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => query.refetch()}>
                {t("common.retry")}
              </Button>
            )
          }
        />
      </>
    );
  }

  const customer = query.data as StoredCustomer;

  return (
    <>
      <PageHeader
        back={back}
        title={customer.name}
        subtitle={customer.taxId ? t("customers.detail.gstin", { gstin: customer.taxId }) : undefined}
        actions={
          <>
            <HowToButton slug="add-customer" />
            <Can do="customer.update">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" strokeWidth={2} />
                {t("customers.detail.edit")}
              </Button>
            </Can>
          </>
        }
      />

      {analytics ? (
        <CustomerAnalytics
          customerId={customer.id}
          periodState={periodState}
          onPeriod={(next) => {
            rememberPeriod(next);
            routeNavigate({ search: { period: next }, replace: true });
          }}
        />
      ) : null}

      {/* Contact first in the DOM and on the left at laptop width, so keyboard order follows the page. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <ContactCard customer={customer} />
          <BundleNumbersCard customer={customer} />
        </div>
        <RecentDispatches customerId={customer.id} today={periodState.today} timeZone={periodState.timeZone} />
      </div>

      <Can do="portal.manage">
        <CustomerPortalCard customerId={customer.id} customerName={customer.name} />
      </Can>

      <Sheet
        open={editing}
        onOpenChange={setEditing}
        title={t("customers.detail.editTitle", { name: customer.name })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              {t("customers.form.submit")}
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="flex flex-col gap-6">
            <CustomerForm formId={formId} customer={customer} onPendingChange={setPending} onSaved={() => setEditing(false)} />
            <Can do="customer.delete">
              <div className="border-t border-border pt-4">
                <Button variant="ghost" className="-ml-3 text-destructive hover:text-destructive" onClick={() => setDeleting(true)}>
                  <Trash2 aria-hidden="true" strokeWidth={2} />
                  {t("customers.detail.delete")}
                </Button>
              </div>
            </Can>
          </div>
        ) : null}
      </Sheet>

      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("customers.detail.deleteTitle", { name: customer.name })}
        description={t("customers.detail.deleteBody")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleting(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                setEditing(false);
                remove.mutate({ id: customer.id });
              }}
            >
              {t("customers.detail.delete")}
            </Button>
          </>
        }
      />
    </>
  );
}

/**
 * The owner's view of one customer (analytics addendum §4): when they last took material and how
 * often, the period's KPI tiles, 12 months of volume and what they buy. analytics.view only.
 */
function CustomerAnalytics({
  customerId,
  periodState,
  onPeriod,
}: {
  customerId: string;
  periodState: PeriodState;
  onPeriod(period: Period): void;
}) {
  const { t, locale } = useT();
  const { period, range, months, today } = periodState;

  const year = useQuery({
    ...trpc.analytics.customerSummary.queryOptions({ customerId, from: months.from, to: months.to, bucket: "month" }),
  });
  const current = useQuery({
    ...trpc.analytics.customerSummary.queryOptions({ customerId, from: range.from, to: range.to, bucket: "month" }),
    placeholderData: keepPreviousData,
  });
  // The same query as the /customers leaderboard card (same input, one cache entry): the share
  // tile reads a listed customer's share from it, so the two screens never disagree.
  const board = useQuery({
    ...trpc.analytics.customerLeaderboard.queryOptions({ from: range.from, to: range.to, limit: 10 }),
    placeholderData: keepPreviousData,
  });

  const totals = current.data?.totals;
  // A previous period's figures stay on screen, dimmed, while the new period loads; a share is
  // only worked out when both reads are for the period on screen. Unknown is never drawn as 0.
  const stale = current.isPlaceholderData;
  const boardReady = board.data !== undefined && !board.isPlaceholderData;
  const boardFailed = board.isError && board.data === undefined;
  const share = totals && !stale && boardReady ? customerShare(customerId, totals.kgG, board.data) : null;
  const caption = t("customers.period.range", { from: formatDay(range.from, locale, today), to: formatDay(range.to, locale, today) });
  const openOrders = current.data?.openOrders ?? null;

  return (
    <>
      <div data-slot="customer-facts" className="-mt-2 min-h-6 text-[15px] leading-6 font-medium break-words text-muted-foreground">
        {year.data ? (
          customerFactsLine(t, year.data)
        ) : year.isPending ? (
          <Skeleton className="inline-block h-4 w-60 align-middle" />
        ) : null}
      </div>

      <PeriodRow period={period} range={range} today={today} onChange={onPeriod} />

      {current.isError && !current.data ? (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-card p-4">
          <p className="m-0 flex-1 text-[15px] font-medium">{t("customers.detail.kpi.analyticsFailed")}</p>
          <Button variant="secondary" onClick={() => current.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : totals ? (
        <div
          data-slot="customer-kpis"
          aria-busy={stale || undefined}
          className={`grid grid-cols-2 items-stretch gap-3 transition-opacity sm:gap-4 lg:grid-cols-4 ${stale ? "opacity-60" : ""}`}
        >
          <StatusBlock
            tone="neutral"
            title={t("customers.detail.kpi.kg")}
            meta={caption}
            value={totals.kgG / 1000}
            format={formatKgTotal}
            unit={t("units.kg")}
            className="animate-rise col-span-2 md:col-span-1"
            style={riseDelay(0)}
          />
          <KpiTile
            label={t("customers.detail.kpi.dispatches")}
            value={totals.dispatches}
            className="animate-rise"
            style={riseDelay(1)}
          />
          <KpiTile
            label={t("customers.detail.kpi.avgLoad")}
            value={totals.avgLoadKgG / 1000}
            format={formatKgTotal}
            unit={t("customers.detail.kpi.perDispatch")}
            className="animate-rise"
            style={riseDelay(2)}
          />
          <KpiTile
            label={t("customers.detail.kpi.share")}
            meta={
              boardReady
                ? t("customers.detail.kpi.shareOf", { total: formatKgTotal(board.data.totalKgG / 1000) })
                : boardFailed
                  ? t("customers.detail.kpi.shareFailed")
                  : undefined
            }
            value={share}
            format={formatSharePct}
            fallback={
              boardFailed ? (
                <Button variant="secondary" className="self-start" onClick={() => board.refetch()}>
                  {t("common.retry")}
                </Button>
              ) : undefined
            }
            className="animate-rise col-span-2 md:col-span-1"
            style={riseDelay(3)}
          />
        </div>
      ) : (
        <div aria-busy="true" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <span className="sr-only">{t("common.loading")}</span>
          <KpiTileSkeleton className="col-span-2 md:col-span-1" />
          <KpiTileSkeleton />
          <KpiTileSkeleton />
          <KpiTileSkeleton className="col-span-2 md:col-span-1" />
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Suspense fallback={<ChartCardSkeleton />}>
          <VolumeCard
            series={year.data?.series ?? []}
            state={year.isPending ? "loading" : year.isError && !year.data ? "error" : undefined}
            onRetry={() => year.refetch()}
          />
        </Suspense>
        <Suspense fallback={<ChartCardSkeleton />}>
          <SectionsCard
            sections={current.data?.topSections ?? []}
            state={current.isPending ? "loading" : current.isError && !current.data ? "error" : undefined}
            refreshing={current.isFetching && !current.isPending}
            onRetry={() => current.refetch()}
          />
        </Suspense>
      </div>

      {openOrders ? <OpenOrders orders={openOrders} /> : null}
    </>
  );
}

/** Order book for the customer, once sales orders exist (plant PL-8). Hidden while null. */
function OpenOrders({ orders }: { orders: { orderedG: number; dispatchedG: number; bakiG: number; lines: number } }) {
  const { t } = useT();
  const titleId = useId();
  const cells = [
    { key: "ordered", label: t("customers.detail.openOrders.ordered"), g: orders.orderedG },
    { key: "dispatched", label: t("customers.detail.openOrders.dispatched"), g: orders.dispatchedG },
    { key: "baki", label: t("customers.detail.openOrders.baki"), g: orders.bakiG },
  ];
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={titleId} className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">
          {t("customers.detail.openOrders.title")}
        </h2>
        <span className="text-[13px] font-medium text-muted-foreground">
          {t("customers.detail.openOrders.lines", { count: orders.lines })}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-3 gap-3">
        {cells.map((c) => (
          <div key={c.key} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-[13px] font-medium text-muted-foreground">{c.label}</dt>
            <dd data-no-truncate="" className="m-0 font-mono text-[17px] font-semibold tabular-nums">
              {formatKgTotal(c.g / 1000)} {t("units.kg")}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ContactCard({ customer, className }: { customer: StoredCustomer; className?: string }) {
  const { t } = useT();
  const titleId = useId();
  const billing = addressLines(customer.billingAddress);
  const shippingDraft = addressToDraft(customer.shippingAddress);
  const shippingSame =
    sameDraft(shippingDraft, EMPTY_ADDRESS) || sameDraft(shippingDraft, addressToDraft(customer.billingAddress));
  const shipping = addressLines(customer.shippingAddress);

  return (
    <section aria-labelledby={titleId} className={`flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-5 ${className ?? ""}`}>
      <h2 id={titleId} className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">
        {t("customers.detail.contact")}
      </h2>
      {customer.phone || customer.email ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {customer.phone ? (
            <li>
              <a
                href={`tel:${customer.phone.replace(/\s+/g, "")}`}
                className="-mx-2 inline-flex min-h-11 items-center gap-2.5 rounded-input px-2 text-[15px] font-medium tabular-nums text-foreground no-underline hover:bg-accent"
              >
                <Phone aria-hidden="true" strokeWidth={2} className="size-[18px] shrink-0 text-muted-foreground" />
                <span className="sr-only">{t("customers.form.phone")}: </span>
                {customer.phone}
              </a>
            </li>
          ) : null}
          {customer.email ? (
            <li className="min-w-0">
              <a
                href={`mailto:${customer.email}`}
                className="-mx-2 inline-flex min-h-11 max-w-full items-center gap-2.5 rounded-input px-2 text-[15px] font-medium text-foreground no-underline hover:bg-accent"
              >
                <Mail aria-hidden="true" strokeWidth={2} className="size-[18px] shrink-0 text-muted-foreground" />
                <span className="sr-only">{t("customers.form.email")}: </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{customer.email}</span>
              </a>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="m-0 text-[15px] text-muted-foreground">{t("customers.detail.noContact")}</p>
      )}

      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <h3 className="m-0 text-[13px] font-semibold text-muted-foreground">{t("customers.form.billingAddress")}</h3>
        {billing.length > 0 ? (
          <address className="text-[15px] leading-6 not-italic break-words">
            {billing.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        ) : (
          <p className="m-0 text-[15px] text-muted-foreground">{t("customers.detail.noAddress")}</p>
        )}
      </div>
      {billing.length > 0 || shipping.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-[13px] font-semibold text-muted-foreground">{t("customers.form.shippingAddress")}</h3>
          {shippingSame && billing.length > 0 ? (
            <p className="m-0 text-[15px] leading-6">{t("customers.detail.sameAsBilling")}</p>
          ) : (
            <address className="text-[15px] leading-6 not-italic break-words">
              {shipping.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          )}
        </div>
      ) : null}
      {customer.notes ? (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <h3 className="m-0 text-[13px] font-semibold text-muted-foreground">{t("customers.form.notes")}</h3>
          <p className="m-0 text-[15px] leading-6 break-words whitespace-pre-line">{customer.notes}</p>
        </div>
      ) : null}
    </section>
  );
}

type DispatchRow = {
  id: string;
  code: string;
  status: DispatchStatus;
  shipDate: string | Date | null;
  /** The one ship day (lib/dispatchFigures): the day a completed load left, else the entered ship date. */
  shipDay?: { ymd: string; kind: "dispatched" | "ship" } | null;
  createdAt: string | Date;
  completedAt: string | Date | null;
  itemCount: number;
  totalWeightG: number;
};

const RECENT_PAGE = 10;

/** Every dispatch to this customer, newest first, linking to the dispatch. Visible to every role. */
function RecentDispatches({
  customerId,
  today,
  timeZone,
  className,
}: {
  customerId: string;
  today: string;
  timeZone: string;
  className?: string;
}) {
  const { t, locale } = useT();
  const titleId = useId();
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    ...trpc.dispatch.listDispatches.queryOptions({ customerId, limit: RECENT_PAGE, offset }),
    placeholderData: keepPreviousData,
  });

  const columns: ResponsiveListColumn<DispatchRow>[] = [
    {
      key: "code",
      header: t("customers.detail.recent.code"),
      cell: (d) => (
        <span data-no-truncate="" className="font-mono whitespace-nowrap">
          {d.code}
        </span>
      ),
    },
    {
      key: "date",
      header: t("customers.detail.recent.date"),
      // The server's one ship day (a completed load: the day it left; one being built: its entered ship date),
      // else the day it was started: the same date the dispatch list and detail show.
      cell: (d) => <span className="whitespace-nowrap">{formatDispatchDay(d, locale, timeZone, today)}</span>,
    },
    {
      key: "status",
      header: t("customers.detail.recent.status"),
      cell: (d) => <Chip tone={dispatchTone(d.status)}>{t(`status.dispatch.${d.status}`)}</Chip>,
    },
    {
      key: "bundles",
      header: t("customers.detail.recent.bundles"),
      align: "end",
      cell: (d) => <span className="font-mono">{d.itemCount}</span>,
    },
    {
      key: "kg",
      header: t("customers.detail.recent.kg"),
      align: "end",
      cell: (d) => (
        <span data-no-truncate="" className="font-mono whitespace-nowrap">
          {formatKgTotal(d.totalWeightG / 1000)}
        </span>
      ),
    },
  ];

  return (
    <section aria-labelledby={titleId} className={`flex min-w-0 flex-col gap-3 ${className ?? ""}`}>
      <h2 id={titleId} className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">
        {t("customers.detail.recent.title")}
      </h2>
      <ResponsiveList
        label={t("customers.detail.recent.label")}
        rows={(query.data?.items ?? []) as DispatchRow[]}
        columns={columns}
        rowKey={(d) => d.id}
        rowHref={(d) => `/dispatch/${d.id}`}
        total={query.data?.total}
        loading={query.isFetching}
        page={{ offset, limit: RECENT_PAGE, onChange: setOffset }}
        empty={
          query.isError ? (
            <EmptyState
              title={t("errors.generic")}
              action={
                <Button variant="secondary" onClick={() => query.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t("customers.noDispatches")} />
          )
        }
      />
    </section>
  );
}
