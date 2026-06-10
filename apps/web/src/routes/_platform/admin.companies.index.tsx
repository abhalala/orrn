import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Tabs } from "@orrn/ui/components/tabs";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { setImpersonateCompanyId } from "@/shared/lib/impersonation";
import { requirePlatformAdmin } from "@/shared/lib/guards";
import { queryClient, trpc } from "@/shared/utils/trpc";

const COMPANY_STATUSES = ["pending", "active", "suspended"] as const;
type CompanyStatus = (typeof COMPANY_STATUSES)[number];
type StatusFilter = CompanyStatus | "all";

export const Route = createFileRoute("/_platform/admin/companies/")({
  component: AdminCompaniesComponent,
  beforeLoad: requirePlatformAdmin,
  validateSearch: (search: Record<string, unknown>) => ({
    status: (search.status as StatusFilter | undefined) ?? "all",
  }),
});

type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string | null;
  createdAt: Date | string | number;
  memberCount: number;
};

function AdminCompaniesComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const status = search.status ?? "all";
  const qc = useQueryClient();
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    ...trpc.platform.companiesList.queryOptions({
      limit: 100,
      offset: 0,
      search: query || undefined,
      status: status === "all" ? undefined : status,
    }),
  });

  const suspendMutation = useMutation({
    ...trpc.platform.companiesSuspend.mutationOptions(),
    onSuccess: () => {
      toast.success("Company suspended");
      qc.invalidateQueries({ queryKey: trpc.platform.companiesList.queryKey() });
    },
    onError: (e: any) => toast.error(e.message || "Failed to suspend"),
  });

  const reactivateMutation = useMutation({
    ...trpc.platform.companiesReactivate.mutationOptions(),
    onSuccess: () => {
      toast.success("Company reactivated");
      qc.invalidateQueries({ queryKey: trpc.platform.companiesList.queryKey() });
    },
    onError: (e: any) => toast.error(e.message || "Failed to reactivate"),
  });

  const impersonateMutation = useMutation({
    ...trpc.platform.impersonationCreateGrant.mutationOptions(),
    onSuccess: (grant) => {
      setImpersonateCompanyId(grant.companyId);
      queryClient.clear();
      toast.success("Impersonation grant created — loading tenant view");
      window.location.href = "/dashboard";
    },
    onError: (e: any) => toast.error(e.message || "Failed to start impersonation"),
  });

  const columns = useMemo((): DataTableColumn<CompanyRow>[] => {
    return [
      {
        id: "name",
        header: "Company",
        flex: 1.2,
        sortable: true,
        sortValue: (row) => row.name.toLowerCase(),
        cell: (row) => (
          <Link
            to="/admin/companies/$id"
            params={{ id: row.id }}
            className="font-medium hover:underline"
          >
            {row.name}
          </Link>
        ),
      },
      { id: "slug", header: "Slug", flex: 1, cell: (row) => row.slug },
      {
        id: "status",
        header: "Status",
        flex: 0.7,
        sortable: true,
        sortValue: (row) => row.status,
        cell: (row) => (
          <Badge
            tone={
              row.status === "active"
                ? "success"
                : row.status === "suspended"
                  ? "danger"
                  : "neutral"
            }
          >
            {row.status}
          </Badge>
        ),
      },
      {
        id: "members",
        header: "Members",
        flex: 0.5,
        align: "right",
        sortable: true,
        sortValue: (row) => row.memberCount,
        cell: (row) => row.memberCount,
      },
      {
        id: "created",
        header: "Created",
        flex: 0.8,
        sortable: true,
        sortValue: (row) => new Date(row.createdAt).getTime(),
        cell: (row) => format(new Date(row.createdAt), "PP"),
      },
      {
        id: "actions",
        header: "",
        flex: 1.4,
        align: "right",
        cell: (row) => (
          <div className="flex justify-end gap-2 flex-wrap">
            <Can do="platform.impersonate">
              <Button
                size="sm"
                disabled={row.status !== "active" || impersonateMutation.isPending}
                onClick={() =>
                  impersonateMutation.mutate({ companyId: row.id, ttlMinutes: 30 })
                }
              >
                Impersonate
              </Button>
            </Can>
            <Can do="platform.company.manage">
              {row.status === "active" ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={suspendMutation.isPending}
                  onClick={() => suspendMutation.mutate({ id: row.id })}
                >
                  Suspend
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reactivateMutation.isPending}
                  onClick={() => reactivateMutation.mutate({ id: row.id })}
                >
                  Reactivate
                </Button>
              )}
            </Can>
          </div>
        ),
      },
    ];
  }, [
    impersonateMutation,
    reactivateMutation,
    suspendMutation.isPending,
    reactivateMutation.isPending,
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Godseye"
        title="Companies"
        description={`Tenant directory for support and onboarding (${data?.total ?? 0} total).`}
        actions={
          <Link to="/admin" className="no-underline">
            <Button variant="outline">Back to console</Button>
          </Link>
        }
      />
      <Toolbar>
        <Input
          placeholder="Search name or slug…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <Tabs
          value={status}
          onValueChange={(v) => navigate({ search: { status: v as StatusFilter } })}
          items={(["all", ...COMPANY_STATUSES] as const).map((s) => ({
            id: s,
            label: s.charAt(0).toUpperCase() + s.slice(1),
          }))}
        />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={(data?.items as CompanyRow[]) ?? []}
        rowKey={(row) => row.id}
        renderCard={(row) => (
          <div className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  to="/admin/companies/$id"
                  params={{ id: row.id }}
                  className="truncate text-base font-semibold text-foreground hover:underline"
                >
                  {row.name}
                </Link>
                <p className="m-0 font-mono text-xs text-muted-foreground">{row.slug}</p>
              </div>
              <Badge
                tone={
                  row.status === "active"
                    ? "success"
                    : row.status === "suspended"
                      ? "danger"
                      : "neutral"
                }
              >
                {row.status}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Members</p>
                <p className="m-0 text-foreground">{row.memberCount}</p>
              </div>
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Plan</p>
                <p className="m-0 capitalize text-foreground">{row.plan ?? "—"}</p>
              </div>
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Created</p>
                <p className="m-0 text-foreground">{format(new Date(row.createdAt), "MMM d")}</p>
              </div>
            </div>
            <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-3">
              <Can do="platform.impersonate">
                <Button
                  size="sm"
                  disabled={row.status !== "active" || impersonateMutation.isPending}
                  onClick={() =>
                    impersonateMutation.mutate({ companyId: row.id, ttlMinutes: 30 })
                  }
                >
                  Impersonate
                </Button>
              </Can>
              <Can do="platform.company.manage">
                {row.status === "active" ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={suspendMutation.isPending}
                    onClick={() => suspendMutation.mutate({ id: row.id })}
                  >
                    Suspend
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reactivateMutation.isPending}
                    onClick={() => reactivateMutation.mutate({ id: row.id })}
                  >
                    Reactivate
                  </Button>
                )}
              </Can>
            </div>
          </div>
        )}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title="No companies found"
            description={
              query
                ? "Try a different search query or status filter."
                : "Approved waitlist requests appear here as new tenants."
            }
          />
        }
      />
    </div>
  );
}
