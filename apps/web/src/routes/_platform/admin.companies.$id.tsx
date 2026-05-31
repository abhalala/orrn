import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Select } from "@orrn/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { setImpersonateCompanyId } from "@/shared/lib/impersonation";
import { requirePlatformAdmin } from "@/shared/lib/guards";
import { queryClient, trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_platform/admin/companies/$id")({
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
      window.location.href = "/dashboard";
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
        cell: (row) =>
          row.revokedAt ? (
            <Badge tone="danger">Revoked</Badge>
          ) : new Date(row.expiresAt).getTime() < Date.now() ? (
            <Badge tone="neutral">Expired</Badge>
          ) : (
            <Badge tone="success">Active</Badge>
          ),
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
            <Link to="/admin/companies" search={{ status: "all" }} className="no-underline">
              <Button variant="outline">Back to list</Button>
            </Link>
            <Can do="platform.impersonate">
              <Button
                disabled={c.status !== "active" || impersonateMutation.isPending}
                onClick={() =>
                  impersonateMutation.mutate({ companyId: c.id, ttlMinutes: 30 })
                }
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
            <Badge
              tone={
                c.status === "active"
                  ? "success"
                  : c.status === "suspended"
                    ? "danger"
                    : "neutral"
              }
            >
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

const PLAN_OPTIONS = [
  { value: "starter", label: "Starter" },
  { value: "growth", label: "Growth" },
  { value: "enterprise", label: "Enterprise" },
];

const MODULES = [
  { id: "customers", label: "Customer Management" },
  { id: "dies", label: "Die Management" },
  { id: "bundles", label: "Bundle & Production Tracking" },
  { id: "dispatches", label: "Dispatch & Logistics" },
];

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

  const updateMutation = useMutation({
    ...trpc.platform.updatePlanAndModules.mutationOptions(),
    onSuccess: () => {
      toast.success("Company plan and modules updated");
      qc.invalidateQueries({ queryKey: trpc.platform.companiesGet.queryKey({ id: companyId }) });
    },
    onError: (e: any) => toast.error(e.message || "Failed to update"),
  });

  const toggleModule = (modId: string) => {
    setActiveModules((curr) =>
      curr.includes(modId) ? curr.filter((m) => m !== modId) : [...curr, modId],
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan and active modules</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="companyPlan">Billing plan</Label>
          <Select value={plan} onValueChange={setPlan} options={PLAN_OPTIONS} width={240} />
        </div>

        <div className="space-y-2">
          <Label>Active modules</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {MODULES.map((m) => {
              const isChecked = activeModules.includes(m.id);
              return (
                <label
                  key={m.id}
                  className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    isChecked
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border bg-background hover:bg-muted/40 text-muted-foreground"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleModule(m.id)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-sm font-medium">{m.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        <Button
          onClick={() => updateMutation.mutate({ companyId, plan, modules: activeModules })}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </CardContent>
    </Card>
  );
}
