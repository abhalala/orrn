import { Badge, StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Can } from "@orrn/web-shared/components/can";
import { clearImpersonateCompanyId, setImpersonateCompanyId } from "@orrn/web-shared/lib/impersonation";
import { appUrls } from "@orrn/web-shared/lib/urls";
import { requirePlatformAdmin } from "@orrn/web-shared/lib/admin-guards";
import { queryClient, trpc } from "@orrn/web-shared/utils/trpc";

export const Route = createFileRoute("/admin/companies/$id")({
  component: AdminCompanyDetailComponent,
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

function AdminCompanyDetailComponent() {
  const { id } = Route.useParams();
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
      window.location.href = `${appUrls.erp}/dashboard`;
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
            <Button variant="outline" asChild>
              <Link to="/admin/companies">Back to list</Link>
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
            <p className="capitalize">{c.plan ?? "—"}</p>
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

      <PlanAndModulesForm
        companyId={c.id}
        initialPlan={c.plan}
        initialModules={(c as any).modules || []}
      />

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

function PlanAndModulesForm({
  companyId,
  initialPlan,
  initialModules,
}: {
  companyId: string;
  initialPlan: string | null;
  initialModules: string[];
}) {
  const qc = useQueryClient();
  const [plan, setPlan] = useState(initialPlan || "starter");
  const [activeModules, setActiveModules] = useState<string[]>(initialModules || []);
  const [isUpdating, setIsUpdating] = useState(false);

  const updateMutation = useMutation({
    ...trpc.platform.updatePlanAndModules.mutationOptions(),
    onSuccess: () => {
      toast.success("Company plan and modules updated");
      qc.invalidateQueries({ queryKey: trpc.platform.companiesGet.queryKey({ id: companyId }) });
    },
    onError: (e: any) => toast.error(e.message || "Failed to update"),
  });

  const modulesList = [
    { id: "customers", label: "Customer Management" },
    { id: "dies", label: "Die Management" },
    { id: "bundles", label: "Bundle & Production Tracking" },
    { id: "dispatches", label: "Dispatch & Logistics" },
  ];

  const handleModuleToggle = (modId: string) => {
    if (activeModules.includes(modId)) {
      setActiveModules(activeModules.filter((m) => m !== modId));
    } else {
      setActiveModules([...activeModules, modId]);
    }
  };

  const handleSave = async () => {
    setIsUpdating(true);
    try {
      await updateMutation.mutateAsync({
        companyId,
        plan,
        modules: activeModules,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan & Active Modules</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground block" htmlFor="companyPlan">
            Billing Plan
          </label>
          <select
            id="companyPlan"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="flex h-10 w-full max-w-xs rounded-md border border-input border-border/40 bg-[#0b0f1a]/50 px-3 py-2 text-sm text-[#f5f7ff] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5B6CFF] focus-visible:border-[#5B6CFF]"
          >
            <option value="starter">Starter</option>
            <option value="growth">Growth</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground block">
            Active Modules
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {modulesList.map((m) => {
              const isChecked = activeModules.includes(m.id);
              return (
                <label
                  key={m.id}
                  className={`flex items-center space-x-3 rounded-lg border p-3 cursor-pointer transition ${
                    isChecked
                      ? "border-[#5B6CFF] bg-[#5B6CFF]/10 text-[#f5f7ff]"
                      : "border-border/40 bg-card/40 hover:bg-card/70 text-muted-foreground"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleModuleToggle(m.id)}
                    className="h-4 w-4 rounded border-gray-300 text-[#5B6CFF] focus:ring-[#5B6CFF]"
                  />
                  <span className="text-sm font-medium">{m.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        <Button
          onClick={handleSave}
          disabled={isUpdating}
          className="bg-[#5B6CFF] hover:bg-[#3b4edd] text-white"
        >
          {isUpdating ? "Saving..." : "Save Changes"}
        </Button>
      </CardContent>
    </Card>
  );
}
