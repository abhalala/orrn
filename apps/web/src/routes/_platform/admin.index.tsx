import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { motionClass, riseDelay } from "@orrn/ui/components/motion";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { UiLink } from "@orrn/ui/components/link";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { formatAgo, formatDay } from "@/features/admin/format";
import { companyStatusKey, companyStatusTone } from "@/features/admin/status";
import { showsLoadError } from "@/features/admin/query-state";
import type { Overview } from "@/features/admin/types";
import { LoadError, Panel } from "@/features/admin/ui";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_platform/admin/")({
  component: AdminOverview,
});

/**
 * Godseye home (spec §3 Godseye): the KPI row is the screen's one loud
 * element (Active companies in violet, attention in amber), then two quiet
 * lists. Each block and list only renders when the staff role can see it
 * (the server sends null for the rest).
 */
function AdminOverview() {
  const { t } = useT();
  const overview = useQuery(trpc.platform.overview.queryOptions());
  const data = overview.data;

  return (
    <div className="@container flex min-w-0 flex-col gap-6">
      <PageHeader title={t("admin.overview.title")} subtitle={t("admin.overview.subtitle")} />

      {showsLoadError(overview) ? (
        <LoadError message={t("admin.overview.loadError")} onRetry={() => void overview.refetch()} />
      ) : null}

      <section aria-labelledby="godseye-kpis" aria-busy={overview.isPending || undefined}>
        <h2 id="godseye-kpis" className="sr-only">
          {t("admin.overview.kpis")}
        </h2>
        {overview.isPending ? <KpiSkeleton /> : data ? <Kpis data={data} /> : null}
      </section>

      {overview.isPending ? (
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2" aria-hidden="true">
          <ListSkeleton />
          <ListSkeleton />
        </div>
      ) : data && (data.waitlist || data.companies) ? (
        <div className="grid grid-cols-1 gap-4 @3xl:grid-flow-col @3xl:auto-cols-fr">
          {data.waitlist ? <WaitingList rows={data.waitlist.recent} /> : null}
          {data.companies ? <RecentCompanies rows={data.companies.recent} /> : null}
        </div>
      ) : null}
    </div>
  );
}

const KPI_GRID = "grid grid-cols-2 gap-3 @md:gap-4 @4xl:grid-cols-4";

function Kpis({ data }: { data: Overview }) {
  const { t } = useT();
  const blocks: ReactNode[] = [];
  if (data.companies) {
    const { active, suspended, total } = data.companies;
    blocks.push(
      <StatusBlock
        key="active"
        tone="violet"
        title={t("admin.overview.active")}
        meta={t("admin.overview.activeMeta", { count: total })}
        value={active}
        href="/admin/companies?status=active"
      />,
      <StatusBlock
        key="suspended"
        tone={suspended > 0 ? "amber" : "neutral"}
        title={t("admin.overview.suspended")}
        meta={t("admin.overview.suspendedMeta")}
        value={suspended}
        href="/admin/companies?status=suspended"
      />,
    );
  }
  if (data.waitlist) {
    const pending = data.waitlist.pending;
    blocks.push(
      <StatusBlock
        key="requests"
        tone={pending > 0 ? "amber" : "green"}
        title={t("admin.overview.pending")}
        meta={pending > 0 ? t("admin.overview.pendingMeta") : t("admin.overview.pendingNone")}
        value={pending}
        href="/admin/requests"
      />,
    );
  }
  if (data.staff) {
    blocks.push(
      <StatusBlock
        key="staff"
        tone="neutral"
        title={t("admin.overview.staff")}
        meta={t("admin.overview.staffMeta")}
        value={data.staff.total}
        href="/admin/staff"
      />,
    );
  }
  return (
    <ul className={`m-0 list-none p-0 ${KPI_GRID}`}>
      {blocks.map((block, i) => (
        <li key={i} className={`flex min-w-0 ${motionClass.rise}`} style={riseDelay(i)}>
          {block}
        </li>
      ))}
    </ul>
  );
}

function KpiSkeleton() {
  return (
    <div className={KPI_GRID} aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-[168px] rounded-block" />
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-card p-2">
      <Skeleton className="m-3 h-5 w-40" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 px-3 py-3.5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function ListPanel({
  id,
  title,
  viewAll,
  children,
}: {
  id: string;
  title: string;
  viewAll: { to: string; label: string; srLabel: string };
  children: ReactNode;
}) {
  return (
    <Panel aria-labelledby={id} className="flex flex-col p-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 pt-2 pb-1">
        <h2 id={id} className="m-0 min-w-0 font-display text-[19px] font-bold tracking-[-0.02em] text-foreground">
          {title}
        </h2>
        <UiLink
          to={viewAll.to}
          className="-mr-1 inline-flex min-h-11 items-center rounded-full px-3 text-[14px] font-semibold text-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-accent"
        >
          <span aria-hidden="true">{viewAll.label}</span>
          <span className="sr-only">{viewAll.srLabel}</span>
        </UiLink>
      </div>
      {children}
    </Panel>
  );
}

const ROW_LINK =
  "group flex min-h-14 min-w-0 items-center gap-3 rounded-input px-3 py-3 no-underline transition-colors duration-[var(--dur-fast)] hover:bg-accent";

function WaitingList({ rows }: { rows: NonNullable<Overview["waitlist"]>["recent"] }) {
  const { t, locale } = useT();
  return (
    <ListPanel
      id="godseye-waiting"
      title={t("admin.overview.waiting")}
      viewAll={{ to: "/admin/requests", label: t("admin.overview.viewAll"), srLabel: t("admin.overview.viewAllRequests") }}
    >
      {rows.length === 0 ? (
        <p className="m-0 px-3 pt-2 pb-4 text-[15px] text-muted-foreground">{t("admin.overview.waitingEmpty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((row) => (
            <li key={row.id} className="min-w-0 border-t border-border first:border-t-0">
              <UiLink to="/admin/requests" className={ROW_LINK}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-baseline justify-between gap-3">
                    <span className="min-w-0 text-[15px] font-semibold text-foreground break-words">{row.companyName}</span>
                    <time
                      dateTime={new Date(row.createdAt).toISOString()}
                      className="shrink-0 text-[13px] whitespace-nowrap text-muted-foreground"
                    >
                      {formatAgo(row.createdAt, { locale })}
                    </time>
                  </span>
                  <span className="text-[13px] text-muted-foreground break-words">{row.requesterName}</span>
                  {/* An email has no spaces: on its own line it gets the full width before it may break. */}
                  <span className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{row.requesterEmail}</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
              </UiLink>
            </li>
          ))}
        </ul>
      )}
    </ListPanel>
  );
}

function RecentCompanies({ rows }: { rows: NonNullable<Overview["companies"]>["recent"] }) {
  const { t, locale } = useT();
  return (
    <ListPanel
      id="godseye-recent"
      title={t("admin.overview.recent")}
      viewAll={{ to: "/admin/companies", label: t("admin.overview.viewAll"), srLabel: t("admin.overview.viewAllCompanies") }}
    >
      {rows.length === 0 ? (
        <p className="m-0 px-3 pt-2 pb-4 text-[15px] text-muted-foreground">{t("admin.overview.recentEmpty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((row) => (
            <li key={row.id} className="min-w-0 border-t border-border first:border-t-0">
              <UiLink to={`/admin/companies/${encodeURIComponent(row.id)}`} className={ROW_LINK}>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[15px] font-semibold text-foreground break-words">{row.name}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                    <Chip tone={companyStatusTone(row.status)} truncate={false}>{t(companyStatusKey(row.status))}</Chip>
                    <span className="whitespace-nowrap">{formatDay(row.createdAt, { locale })}</span>
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
              </UiLink>
            </li>
          ))}
        </ul>
      )}
    </ListPanel>
  );
}
