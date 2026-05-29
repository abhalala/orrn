import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import { Building2, CheckCircle2, ClipboardList, PauseCircle, Users } from "lucide-react";

import { NavCard } from "@orrn/web-shared/components/admin/nav-card";
import { StatCard } from "@orrn/web-shared/components/admin/stat-card";
import { Can } from "@orrn/web-shared/components/can";
import { requirePlatformAdmin } from "@orrn/web-shared/lib/admin-guards";
import { useMe } from "@orrn/web-shared/lib/me";
import { trpc } from "@orrn/web-shared/utils/trpc";

export const Route = createFileRoute("/admin/")({
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

function AdminIndexComponent() {
  const { data: me } = useMe();
  const firstName = me?.user.name?.split(" ")[0] ?? "there";

  const overviewQuery = useQuery(trpc.platform.overview.queryOptions());
  const overview = overviewQuery.data;
  const isLoading = overviewQuery.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform"
        title={`Welcome back, ${firstName}.`}
        description="Operational snapshot for the orrn.app staff console."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {overview?.companies || isLoading ? (
          <StatCard
            label="Active companies"
            value={overview?.companies?.active ?? 0}
            hint={
              overview?.companies
                ? `${overview.companies.total} total tenants`
                : undefined
            }
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
            hint="Access disabled"
            icon={<PauseCircle size={18} />}
            tone="warning"
            to="/admin/companies"
            isLoading={isLoading}
          />
        ) : null}

        {overview?.waitlist || isLoading ? (
          <StatCard
            label="Pending waitlist"
            value={overview?.waitlist?.pending ?? 0}
            hint="Awaiting review"
            icon={<ClipboardList size={18} />}
            tone={
              (overview?.waitlist?.pending ?? 0) > 0 ? "warning" : "success"
            }
            to="/admin/waitlist"
            isLoading={isLoading}
          />
        ) : null}

        {overview?.staff || isLoading ? (
          <StatCard
            label="Staff accounts"
            value={overview?.staff?.total ?? 0}
            hint="orrn.app logins"
            icon={<Users size={18} />}
            tone="neutral"
            to="/admin/staff"
            isLoading={isLoading}
          />
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Can do="platform.waitlist.review">
          <RecentWaitlistCard
            rows={overview?.waitlist?.recent ?? []}
            isLoading={isLoading}
          />
        </Can>
        <Can do="platform.company.manage">
          <RecentCompaniesCard
            rows={overview?.companies?.recent ?? []}
            isLoading={isLoading}
          />
        </Can>
      </div>

      <div>
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-3">
          Quick actions
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Can do="platform.company.manage">
            <NavCard
              title="Manage companies"
              description="Browse tenants, suspend access, and start impersonation grants."
              to="/admin/companies"
              icon={<Building2 size={18} />}
            />
          </Can>
          <Can do="platform.waitlist.review">
            <NavCard
              title="Review waitlist"
              description="Approve or reject inbound SaaS waitlist requests."
              to="/admin/waitlist"
              icon={<ClipboardList size={18} />}
            />
          </Can>
          <Can do="platform.staff.list">
            <NavCard
              title="Staff accounts"
              description="Create orrn.app staff logins with role-based permissions."
              to="/admin/staff"
              icon={<Users size={18} />}
            />
          </Can>
        </div>
      </div>
    </div>
  );
}

function RecentWaitlistCard({
  rows,
  isLoading,
}: {
  rows: RecentWaitlistRow[];
  isLoading: boolean;
}) {
  const columns: DataTableColumn<RecentWaitlistRow>[] = [
    {
      id: "company",
      header: "Company",
      cell: (r) => (
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{r.companyName}</p>
          <p className="text-xs text-muted-foreground truncate">{r.requesterEmail}</p>
        </div>
      ),
      flex: 2,
    },
    {
      id: "when",
      header: "Submitted",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
        </span>
      ),
      align: "right",
      flex: 1,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <ClipboardList size={16} /> Pending waitlist
          </span>
          <Link to="/admin/waitlist" className="no-underline">
            <Button variant="outline" size="sm">
              View all
            </Button>
          </Link>
        </CardTitle>
      </CardHeader>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            icon={<CheckCircle2 size={20} />}
            title="No pending requests"
            description="New waitlist submissions will appear here."
          />
        }
      />
    </Card>
  );
}

function RecentCompaniesCard({
  rows,
  isLoading,
}: {
  rows: RecentCompanyRow[];
  isLoading: boolean;
}) {
  const columns: DataTableColumn<RecentCompanyRow>[] = [
    {
      id: "name",
      header: "Company",
      cell: (r) => (
        <Link
          to="/admin/companies/$id"
          params={{ id: r.id }}
          className="text-sm font-medium text-foreground hover:underline"
        >
          {r.name}
        </Link>
      ),
      flex: 2,
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <Badge
          tone={r.status === "active" ? "success" : r.status === "suspended" ? "danger" : "neutral"}
        >
          {r.status}
        </Badge>
      ),
      flex: 1,
    },
    {
      id: "created",
      header: "Joined",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {format(new Date(r.createdAt), "MMM d")}
        </span>
      ),
      align: "right",
      flex: 1,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Building2 size={16} /> Recent companies
          </span>
          <Link to="/admin/companies" search={{ status: "all" }} className="no-underline">
            <Button variant="outline" size="sm">
              View all
            </Button>
          </Link>
        </CardTitle>
      </CardHeader>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            icon={<Building2 size={20} />}
            title="No companies yet"
            description="Approved waitlist requests will appear here."
          />
        }
      />
    </Card>
  );
}
