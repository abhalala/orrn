import { Badge, StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/components/can";
import { clearImpersonateCompanyId, setImpersonateCompanyId } from "@/lib/impersonation";
import { requirePlatformAdmin } from "@/lib/route-guards";
import { queryClient, trpc } from "@/utils/trpc";

export const Route = createFileRoute("/platform/companies/")({
  component: PlatformCompaniesComponent,
  beforeLoad: requirePlatformAdmin,
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

function PlatformCompaniesComponent() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    ...trpc.platform.companiesList.queryOptions({ limit: 100, offset: 0, search: search || undefined }),
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
      navigate({ to: "/dashboard" });
    },
    onError: (e: any) => toast.error(e.message || "Failed to start impersonation"),
  });

  const columns = useMemo((): DataTableColumn<CompanyRow>[] => {
    return [
      {
        id: "name",
        header: "Company",
        flex: 1.2,
        cell: (row) => (
          <Link to="/platform/companies/$id" params={{ id: row.id }} className="font-medium hover:underline">
            {row.name}
          </Link>
        ),
      },
      { id: "slug", header: "Slug", flex: 1, cell: (row) => row.slug },
      {
        id: "status",
        header: "Status",
        flex: 0.7,
        cell: (row) => (
          <Badge tone={row.status === "active" ? "success" : row.status === "suspended" ? "danger" : "neutral"}>
            {row.status}
          </Badge>
        ),
      },
      { id: "members", header: "Members", flex: 0.5, align: "right", cell: (row) => row.memberCount },
      {
        id: "created",
        header: "Created",
        flex: 0.8,
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
                  variant="outline"
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
  }, [impersonateMutation, reactivateMutation, suspendMutation.isPending, reactivateMutation.isPending]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform"
        title="Companies"
        description="Tenant directory for support and onboarding."
        actions={
          <Button variant="outline" onClick={() => navigate({ to: "/platform" })}>
            Back to console
          </Button>
        }
      />
      <Toolbar>
        <Input
          placeholder="Search name or slug…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={(data?.items as CompanyRow[]) ?? []}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        emptyState={<EmptyState title="No companies found" />}
      />
    </div>
  );
}
