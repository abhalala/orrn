import { Badge, type BadgeTone } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card } from "@orrn/ui/components/card";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Truncate } from "@orrn/ui/components/truncate";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  PauseCircle,
  Printer,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

import { NavCard } from "@/shared/components/admin/nav-card";
import { StatCard } from "@/shared/components/admin/stat-card";
import { Can } from "@/shared/components/can";
import { requirePlatformAdmin } from "@/shared/lib/guards";
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_platform/admin/")({
  component: AdminIndexComponent,
  beforeLoad: requirePlatformAdmin,
});

type RecentCompanyRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string | null;
  createdAt: Date | string | number;
};

type RecentWaitlistRow = {
  id: string;
  companyName: string;
  requesterName: string;
  requesterEmail: string;
  createdAt: Date | string | number;
};

/**
 * Container-aware grids (the content column, not the viewport, decides):
 * stat cards go 4 -> 2, shortcut cards 4 -> 2 -> 1, the two panels sit side by side
 * only when each still gets >= 28rem.
 */
const STATS = "grid grid-cols-2 gap-3 @md:gap-4 @4xl:grid-cols-4";
const FOUR_UP = "grid grid-cols-1 gap-4 @md:grid-cols-2 @4xl:grid-cols-4";
// grid-flow-col + auto-cols-fr: two panels split the row, a lone panel
// (when the viewer can only see one) takes all of it.
const TWO_UP = "grid grid-cols-1 gap-4 @4xl:grid-flow-col @4xl:auto-cols-fr @4xl:grid-cols-none";

function AdminIndexComponent() {
  const { data: me } = useMe();
  const firstName = me?.user.name?.split(" ")[0] ?? "there";

  const overviewQuery = useQuery(trpc.platform.overview.queryOptions());
  const overview = overviewQuery.data;
  const isLoading = overviewQuery.isLoading;
  const pending = overview?.waitlist?.pending ?? 0;

  return (
    <div className="@container flex min-w-0 flex-col gap-6">
      <PageHeader
        eyebrow="Godseye"
        title={`Welcome back, ${firstName}.`}
        description="Companies, access requests, staff and printing at a glance."
      />

      {overviewQuery.isError ? (
        <Card role="alert" className="flex-row flex-wrap items-center justify-between gap-3">
          <p className="m-0 min-w-0 flex-1 text-sm text-foreground">
            The overview did not load. Check your connection, then try again.
          </p>
          <Button variant="outline" size="sm" onPress={() => overviewQuery.refetch()}>
            Try again
          </Button>
        </Card>
      ) : null}

      <section aria-label="At a glance" className={STATS}>
        {overview?.companies || isLoading ? (
          <StatCard
            label="Active companies"
            value={overview?.companies?.active ?? 0}
            hint={overview?.companies ? `${overview.companies.total} in total` : undefined}
            icon={<Building2 size={18} />}
            tone="primary"
            to="/admin/companies"
            isLoading={isLoading}
          />
        ) : null}
        {overview?.companies || isLoading ? (
          <StatCard
            label="Suspended"
            value={overview?.companies?.suspended ?? 0}
            hint="Access paused"
            icon={<PauseCircle size={18} />}
            tone="warning"
            to="/admin/companies"
            isLoading={isLoading}
          />
        ) : null}
        {overview?.waitlist || isLoading ? (
          <StatCard
            label="Access requests"
            value={pending}
            hint={pending > 0 ? "Waiting for review" : "All reviewed"}
            icon={<ClipboardList size={18} />}
            tone={pending > 0 ? "warning" : "success"}
            to="/admin/waitlist"
            isLoading={isLoading}
          />
        ) : null}
        {overview?.staff || isLoading ? (
          <StatCard
            label="Staff accounts"
            value={overview?.staff?.total ?? 0}
            hint="Godseye logins"
            icon={<Users size={18} />}
            tone="neutral"
            to="/admin/staff"
            isLoading={isLoading}
          />
        ) : null}
      </section>

      <div className={TWO_UP}>
        <Can do="platform.waitlist.review">
          <Panel
            title="Access requests"
            icon={<ClipboardList size={18} />}
            viewAll={
              <Link to="/admin/waitlist" className="no-underline">
                View all<span className="sr-only"> access requests</span>
              </Link>
            }
          >
            <PanelList
              isLoading={isLoading}
              rows={overview?.waitlist?.recent ?? []}
              empty={
                <EmptyState
                  icon={<CheckCircle2 size={20} />}
                  title="No requests waiting"
                  description="New access requests show up here."
                />
              }
              renderRow={(r) => <WaitlistRow key={r.id} row={r} />}
            />
          </Panel>
        </Can>
        <Can do="platform.company.manage">
          <Panel
            title="Recent companies"
            icon={<Building2 size={18} />}
            viewAll={
              <Link to="/admin/companies" search={{ status: "all" }} className="no-underline">
                View all<span className="sr-only"> companies</span>
              </Link>
            }
          >
            <PanelList
              isLoading={isLoading}
              rows={overview?.companies?.recent ?? []}
              empty={
                <EmptyState
                  icon={<Building2 size={20} />}
                  title="No companies yet"
                  description="Approved access requests become companies here."
                />
              }
              renderRow={(r) => <CompanyRow key={r.id} row={r} />}
            />
          </Panel>
        </Can>
      </div>

      <section aria-labelledby="quick-actions" className="flex flex-col gap-3">
        <h2 id="quick-actions" className="m-0 text-base font-semibold tracking-[-0.01em] text-foreground">
          Quick actions
        </h2>
        <div className={FOUR_UP}>
          <Can do="platform.company.manage">
            <NavCard
              title="Manage companies"
              description="Browse companies, pause access and open support sessions."
              to="/admin/companies"
              icon={<Building2 size={18} />}
            />
          </Can>
          <Can do="platform.waitlist.review">
            <NavCard
              title="Review requests"
              description="Approve or decline requests for ORRN access."
              to="/admin/waitlist"
              icon={<ClipboardList size={18} />}
            />
          </Can>
          <Can do="platform.staff.list">
            <NavCard
              title="Staff accounts"
              description="Create Godseye logins and set what each person can do."
              to="/admin/staff"
              icon={<Users size={18} />}
            />
          </Can>
          <Can do="platform.spool.manage">
            <NavCard
              title="Printing"
              description="Set up print stations and rotate their keys."
              to="/admin/spool"
              icon={<Printer size={18} />}
            />
          </Can>
        </div>
      </section>
    </div>
  );
}

function Panel({
  title,
  icon,
  viewAll,
  children,
}: {
  title: string;
  icon: ReactNode;
  viewAll: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-2 p-0">
      <div className="flex min-w-0 items-center gap-3 px-5 pb-1 pt-4">
        <span aria-hidden="true" className="shrink-0 text-muted-foreground">
          {icon}
        </span>
        <h2 className="m-0 min-w-0 flex-1 truncate text-base font-semibold tracking-[-0.01em] text-foreground">
          {title}
        </h2>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          {viewAll}
        </Button>
      </div>
      <div className="px-2 pb-2">{children}</div>
    </Card>
  );
}

function PanelList<Row>({
  rows,
  isLoading,
  empty,
  renderRow,
}: {
  rows: Row[];
  isLoading: boolean;
  empty: ReactNode;
  renderRow: (row: Row) => ReactNode;
}) {
  if (isLoading) {
    return (
      <ul aria-label="Loading" className="m-0 flex list-none flex-col p-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="flex flex-col gap-2 px-3 py-3.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3.5 w-1/2" />
          </li>
        ))}
      </ul>
    );
  }
  if (rows.length === 0) return <div className="px-3 pb-2">{empty}</div>;
  return <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">{rows.map(renderRow)}</ul>;
}

const ROW_LINK =
  "group flex min-h-14 min-w-0 items-center gap-3 rounded-input px-3 py-3 no-underline transition-colors duration-[var(--dur-fast)] hover:bg-accent";

function WaitlistRow({ row }: { row: RecentWaitlistRow }) {
  const created = new Date(row.createdAt);
  return (
    <li className="min-w-0">
      <Link to="/admin/waitlist" className={ROW_LINK}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-3">
            <Truncate className="flex-1 text-[15px] font-semibold text-foreground">{row.companyName}</Truncate>
            <time
              dateTime={created.toISOString()}
              title={format(created, "PPp")}
              className="shrink-0 text-[13px] text-muted-foreground"
            >
              {formatDistanceToNow(created, { addSuffix: true })}
            </time>
          </div>
          <div className="flex min-w-0 items-baseline gap-1.5 text-[13px] text-muted-foreground">
            <Truncate className="max-w-[45%] shrink-0">{row.requesterName}</Truncate>
            <span aria-hidden="true" className="shrink-0">
              ·
            </span>
            <Truncate className="flex-1">{row.requesterEmail}</Truncate>
          </div>
        </div>
        <ChevronRight
          size={16}
          aria-hidden="true"
          className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
        />
      </Link>
    </li>
  );
}

const COMPANY_TONE: Record<string, BadgeTone> = {
  active: "success",
  suspended: "danger",
  pending: "neutral",
};

function CompanyRow({ row }: { row: RecentCompanyRow }) {
  const status = row.status.charAt(0).toUpperCase() + row.status.slice(1);
  return (
    <li className="min-w-0">
      <Link to="/admin/companies/$id" params={{ id: row.id }} className={ROW_LINK}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Truncate className="text-[15px] font-semibold text-foreground">{row.name}</Truncate>
            <Badge tone={COMPANY_TONE[row.status] ?? "neutral"}>{status}</Badge>
          </div>
          <div className="flex min-w-0 items-baseline gap-1.5 text-[13px] text-muted-foreground">
            <Truncate mono className="text-xs">
              {row.slug}
            </Truncate>
            <span aria-hidden="true" className="shrink-0">
              ·
            </span>
            <span className="shrink-0 whitespace-nowrap">Joined {joinedLabel(new Date(row.createdAt))}</span>
          </div>
        </div>
        <ChevronRight
          size={16}
          aria-hidden="true"
          className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
        />
      </Link>
    </li>
  );
}

/** "Oct 3" this year, "Oct 3, 2025" otherwise. */
function joinedLabel(date: Date): string {
  return format(date, date.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy");
}
