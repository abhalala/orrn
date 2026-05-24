import { Badge, StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { useMemo } from "react";
import { toast } from "sonner";

import { Can } from "@/components/can";
import { clearImpersonateCompanyId, setImpersonateCompanyId } from "@/lib/impersonation";
import { requirePlatformAdmin } from "@/lib/route-guards";
import { queryClient, trpc } from "@/utils/trpc";

export const Route = createFileRoute("/platform/companies/$id")({
  component: PlatformCompanyDetailComponent,
  beforeLoad: requirePlatformAdmin,
});

type GrantRow = {
  id: string;
  platformAdminId: string;
  expiresAt: Date | string | number;
  revokedAt: Date | string | number | null;
  reason: string | null;
  createdAt: Date | string | number;
};

function PlatformCompanyDetailComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    ...trpc.platform.companiesGet.queryOptions({ id }),
  });

  const suspendMutation = useMutation({
    ...trpc.platform.companiesSuspend.mutationOptions(),
    onSuccess: () => {
      toast.success("Company suspended");
      qc.invalidateQueries({ queryKey: trpc.platform.companiesGet.queryKey({ id }) });
    },
    onError: (e: any) => toast.error(e.message || "Failed to suspend"),
  });

  const reactivateMutation = useMutation({
    ...trpc.platform.companiesReactivate.mutationOptions(),
    onSuccess: () => {
      toast.success("Company reactivated");
      qc.invalidateQueries({ queryKey: trpc.platform.companiesGet.queryKey({ id }) });
    },
    onError: (e: any) => toast.error(e.message || "Failed to reactivate"),
  });

  const impersonateMutation = useMutation({
    ...trpc.platform.impersonationCreateGrant.mutationOptions(),
    onSuccess: (grant) => {
      setImpersonateCompanyId(grant.companyId);
      queryClient.clear();
      toast.success("Impersonation grant created");
      navigate({ to: "/dashboard" });
    },
    onError: (e: any) => toast.error(e.message || "Failed to impersonate"),
  });

  const grantColumns = useMemo((): DataTableColumn<GrantRow>[] => {
    return [
      { id: "id", header: "Grant", flex: 1, cell: (row) => row.id.slice(0, 8) + "…" },
      {
        id: "created",
        header: "Created",
        flex: 0.8,
        cell: (row) => format(new Date(row.createdAt), "PP p"),
      },
      {
        id: "expires",
        header: "Expires",
        flex: 0.8,
        cell: (row) => format(new Date(row.expiresAt), "PP p"),
      },
      {
        id: "status",
        header: "Status",
        flex: 0.6,
        cell: (row) => (row.revokedAt ? "Revoked" : "Active/expired"),
      },
      { id: "reason", header: "Reason", flex: 1, cell: (row) => row.reason ?? "—" },
    ];
  }, []);

  if (isLoading) {
    return <EmptyState title="Loading company…" />;
  }
  if (!data) {
    return <EmptyState title="Company not found" />;
  }

  const c = data.company;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform · Companies"
        title={c.name}
        description={c.slug}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => navigate({ to: "/platform/companies" })}>
              Back to list
            </Button>
            <Can do="platform.impersonate">
              <Button
                disabled={c.status !== "active" || impersonateMutation.isPending}
                onClick={() => impersonateMutation.mutate({ companyId: c.id, ttlMinutes: 30 })}
              >
                Impersonate (30m)
              </Button>
            </Can>
            <Can do="platform.company.manage">
              {c.status === "active" ? (
                <Button
                  variant="destructive"
                  disabled={suspendMutation.isPending}
                  onClick={() => suspendMutation.mutate({ id: c.id })}
                >
                  Suspend
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={reactivateMutation.isPending}
                  onClick={() => reactivateMutation.mutate({ id: c.id })}
                >
                  Reactivate
                </Button>
              )}
            </Can>
          </div>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Status</p>
            <Badge tone={c.status === "active" ? "success" : c.status === "suspended" ? "danger" : "neutral"}>
              {c.status}
            </Badge>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Plan</p>
            <p>{c.plan ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Members</p>
            <p>{c.memberCount}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Created</p>
            <p>{format(new Date(c.createdAt), "PP")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent impersonation grants</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={grantColumns}
            rows={data.recentGrants as GrantRow[]}
            rowKey={(row) => row.id}
            emptyState={<EmptyState title="No grants yet" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
