import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Select, type SelectOption } from "@orrn/ui/components/select";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Tabs } from "@orrn/ui/components/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import { Printer, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { requireCompanyMe } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

// ─── Route ─────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_tenant/spool/")({
  component: SpoolComponent,
  beforeLoad: requireCompanyMe,
});

// ─── Types ──────────────────────────────────────────────────────────────────

const TABS_LIST = [
  { id: "queue", label: "Print Queue" },
  { id: "printers", label: "Printers" },
  { id: "labels", label: "Labels" },
] as const;

type TabId = (typeof TABS_LIST)[number]["id"];

const TABS: { id: TabId; label: string }[] = [...TABS_LIST];

const STATUS_TONES: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  queued: "neutral",
  sent: "warning",
  success: "success",
  failed: "danger",
};

const DEPLOYMENT_TONES: Record<string, "warning" | "success" | "danger"> = {
  pending: "warning",
  active: "success",
  revoked: "danger",
};

type PrintJobRow = {
  id: string;
  templateId: string;
  profileId: string;
  status: string;
  attempt: number;
  createdAt: number | Date | string;
  spoolJobId: string | null;
};

type PrinterRow = {
  id: number;
  name: string;
  ip_address: string;
  dpi: number;
  status: string;
  total_prints: number;
};

type TemplateRow = {
  id: string;
  name: string;
  kind: string;
  spoolTemplateId: string | null;
  spoolPushedAt: number | Date | string | null;
  version: number;
};

type DeploymentRow = {
  id: string;
  status: string;
  subdomain: string;
  spoolDomain: string;
  spoolVersion: string | null;
  lastSeenAt: number | Date | string | null;
};

// ─── Component ──────────────────────────────────────────────────────────────

function SpoolComponent() {
  const qc = useQueryClient();

  // ── Tab state ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>("queue");

  // ── New Job dialog state ──────────────────────────────────────────────
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [jobPrinterId, setJobPrinterId] = useState("");
  const [jobTemplateId, setJobTemplateId] = useState("");
  const [jobVariables, setJobVariables] = useState("{}");
  const [jobCopies, setJobCopies] = useState("1");

  // ── Queries ───────────────────────────────────────────────────────────
  const {
    data: deployment,
    isLoading: deploymentLoading,
  } = useQuery(trpc.spool.deploymentStatus.queryOptions());

  const {
    data: jobs,
    isLoading: jobsLoading,
    refetch: refetchJobs,
  } = useQuery(trpc.spool.listJobs.queryOptions({ limit: 50, offset: 0 }));

  const {
    data: printers,
    isLoading: printersLoading,
  } = useQuery(trpc.spool.listPrinters.queryOptions());

  const {
    data: templates,
    isLoading: templatesLoading,
  } = useQuery(trpc.spool.listTemplates.queryOptions());

  // ── Mutations ─────────────────────────────────────────────────────────
  const cancelJobMutation = useMutation({
    ...trpc.spool.cancelJob.mutationOptions(),
    onSuccess: () => {
      toast.success("Print job cancelled");
      refetchJobs();
    },
    onError: (e: any) => toast.error(e.message || "Failed to cancel job"),
  });

  const retryJobMutation = useMutation({
    ...trpc.spool.retryJob.mutationOptions(),
    onSuccess: () => {
      toast.success("Print job queued for retry");
      refetchJobs();
    },
    onError: (e: any) => toast.error(e.message || "Failed to retry job"),
  });

  const pushTemplateMutation = useMutation({
    ...trpc.spool.pushTemplate.mutationOptions(),
    onSuccess: () => {
      toast.success("Template pushed to spool");
      qc.invalidateQueries({ queryKey: trpc.spool.listTemplates.queryKey() });
    },
    onError: (e: any) => toast.error(e.message || "Failed to push template"),
  });

  const createJobMutation = useMutation({
    ...trpc.spool.createJob.mutationOptions(),
    onSuccess: () => {
      toast.success("Print job submitted");
      setNewJobOpen(false);
      resetJobForm();
      refetchJobs();
    },
    onError: (e: any) => toast.error(e.message || "Failed to create print job"),
  });

  // ── Form helpers ──────────────────────────────────────────────────────
  function resetJobForm() {
    setJobPrinterId("");
    setJobTemplateId("");
    setJobVariables("{}");
    setJobCopies("1");
  }

  function handleCreateJob() {
    let parsedVariables: Record<string, string>;
    try {
      parsedVariables = JSON.parse(jobVariables);
      if (typeof parsedVariables !== "object" || parsedVariables === null) {
        toast.error("Variables must be a JSON object");
        return;
      }
    } catch {
      toast.error("Invalid JSON in variables field");
      return;
    }

    const copiesNum = parseInt(jobCopies, 10);
    if (isNaN(copiesNum) || copiesNum < 1) {
      toast.error("Copies must be a positive number");
      return;
    }

    // The mutation requires a profileId. We use the selected template ID
    // here as a stand-in; this will be resolved to a proper printer profile
    // on the server once the printer profiles endpoint becomes available.
    createJobMutation.mutate({
      profileId: jobTemplateId,
      variables: parsedVariables,
      copies: copiesNum,
    });
  }

  // ── Dropdown options ──────────────────────────────────────────────────
  const printerOptions: SelectOption[] = useMemo(
    () =>
      (printers ?? []).map((p) => ({
        label: `${p.name} (${p.ip_address})`,
        value: String(p.id),
      })),
    [printers],
  );

  const templateOptions: SelectOption[] = useMemo(
    () =>
      (templates ?? []).map((t) => ({
        label: t.name,
        value: t.id,
      })),
    [templates],
  );

  // ── Columns: Print Queue ──────────────────────────────────────────────
  const jobColumns: DataTableColumn<PrintJobRow>[] = useMemo(
    () => [
      {
        id: "template",
        header: "Template",
        sortable: true,
        sortValue: (r) => r.templateId,
        cell: (r) => (
          <span className="truncate font-medium">
            {r.templateId ? r.templateId.slice(0, 8) : "—"}
          </span>
        ),
      },
      {
        id: "printer",
        header: "Printer",
        cell: (r) => (
          <span className="truncate font-mono text-xs">
            {r.profileId ? r.profileId.slice(0, 8) : "—"}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        sortable: true,
        sortValue: (r) => r.status,
        cell: (r) => (
          <Badge tone={STATUS_TONES[r.status] ?? "neutral"}>
            {r.status.toUpperCase()}
          </Badge>
        ),
      },
      {
        id: "attempt",
        header: "Attempt",
        align: "right",
        cell: (r) => r.attempt,
      },
      {
        id: "created",
        header: "Created",
        sortable: true,
        sortValue: (r) => new Date(r.createdAt).getTime(),
        cell: (r) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {format(new Date(r.createdAt), "MMM d, HH:mm")}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        align: "right",
        cell: (r) => (
          <Can do="spool.manage_jobs">
            <div className="flex justify-end gap-1">
              {r.status === "failed" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retryJobMutation.isPending}
                  onClick={() => retryJobMutation.mutate({ id: r.id })}
                >
                  Retry
                </Button>
              ) : null}
              {r.status === "queued" || r.status === "sent" ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={cancelJobMutation.isPending}
                  onClick={() => cancelJobMutation.mutate({ id: r.id })}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </Can>
        ),
      },
    ],
    [cancelJobMutation.isPending, retryJobMutation.isPending],
  );

  // ── Columns: Printers ─────────────────────────────────────────────────
  const printerColumns: DataTableColumn<PrinterRow>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Name",
        sortable: true,
        sortValue: (r) => r.name.toLowerCase(),
        cell: (r) => (
          <span className="font-medium">{r.name}</span>
        ),
        flex: 1.5,
      },
      {
        id: "ip",
        header: "IP",
        cell: (r) => (
          <span className="font-mono text-xs">{r.ip_address}</span>
        ),
      },
      {
        id: "dpi",
        header: "DPI",
        align: "right",
        cell: (r) => `${r.dpi}`,
      },
      {
        id: "status",
        header: "Status",
        sortable: true,
        sortValue: (r) => r.status,
        cell: (r) => (
          <Badge tone={r.status === "online" ? "success" : "neutral"}>
            {r.status}
          </Badge>
        ),
      },
      {
        id: "totalPrints",
        header: "Total Prints",
        align: "right",
        sortable: true,
        sortValue: (r) => r.total_prints,
        cell: (r) => r.total_prints.toLocaleString(),
      },
    ],
    [],
  );

  // ── Columns: Labels ───────────────────────────────────────────────────
  const labelColumns: DataTableColumn<TemplateRow>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Name",
        sortable: true,
        sortValue: (r) => r.name.toLowerCase(),
        cell: (r) => (
          <span className="font-medium">{r.name}</span>
        ),
        flex: 1.5,
      },
      { id: "kind", header: "Kind", cell: (r) => r.kind },
      {
        id: "spoolTemplateId",
        header: "Spool Template ID",
        cell: (r) => (
          <span className="font-mono text-xs text-muted-foreground">
            {r.spoolTemplateId || "—"}
          </span>
        ),
      },
      {
        id: "pushedAt",
        header: "Pushed At",
        sortable: true,
        sortValue: (r) => (r.spoolPushedAt ? new Date(r.spoolPushedAt).getTime() : 0),
        cell: (r) => (
          <span className="text-xs text-muted-foreground">
            {r.spoolPushedAt
              ? formatDistanceToNow(new Date(r.spoolPushedAt), { addSuffix: true })
              : "—"}
          </span>
        ),
      },
      {
        id: "version",
        header: "Version",
        align: "right",
        cell: (r) => (
          <span className="font-mono text-xs">{r.version}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        align: "right",
        cell: (r) => (
          <Can do="spool.push_templates">
            <Button
              size="sm"
              variant="outline"
              disabled={pushTemplateMutation.isPending}
              onClick={() => pushTemplateMutation.mutate({ templateId: r.id })}
            >
              Push to Spool
            </Button>
          </Can>
        ),
      },
    ],
    [pushTemplateMutation.isPending],
  );

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Spool"
        description="Print queue, printers, and label templates for LAN label printing."
        actions={
          <Can do="spool.create_jobs">
            <Button onPress={() => setNewJobOpen(true)}>
              <Plus className="size-4" />
              New Print Job
            </Button>
          </Can>
        }
      />

      {/* ── Deployment Status Card ────────────────────────────────────── */}
      <DeploymentStatusSection
        deployment={deployment as DeploymentRow | null | undefined}
        isLoading={deploymentLoading}
      />

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabId)}
        items={TABS}
      >
        {activeTab === "queue" && (
          <DataTable
            columns={jobColumns}
            rows={(jobs as PrintJobRow[] | undefined) ?? []}
            rowKey={(r) => r.id}
            isLoading={jobsLoading}
            emptyState={
              <EmptyState
                title="No print jobs"
                description="Print jobs submitted from this tenant will appear here."
                icon={<Printer className="size-8" />}
              />
            }
          />
        )}

        {activeTab === "printers" && (
          <Can
            do="spool.list_printers"
            fallback={
              <EmptyState
                title="Access restricted"
                description="You do not have permission to view printer information."
              />
            }
          >
            <DataTable
              columns={printerColumns}
              rows={(printers as PrinterRow[] | undefined) ?? []}
              rowKey={(r) => String(r.id)}
              isLoading={printersLoading}
              emptyState={
                <EmptyState
                  title="No printers"
                  description="No printers have been configured on the spool device."
                />
              }
            />
          </Can>
        )}

        {activeTab === "labels" && (
          <DataTable
            columns={labelColumns}
            rows={(templates as TemplateRow[] | undefined) ?? []}
            rowKey={(r) => r.id}
            isLoading={templatesLoading}
            emptyState={
              <EmptyState
                title="No label templates"
                description="Create label templates to push them to the spool for printing."
              />
            }
          />
        )}
      </Tabs>

      {/* ── New Print Job Dialog ──────────────────────────────────────── */}
      <Dialog
        open={newJobOpen}
        onOpenChange={(open) => {
          if (!open && !createJobMutation.isPending) {
            setNewJobOpen(false);
            resetJobForm();
          }
        }}
        title="New Print Job"
        description="Select a printer profile and template to create a new print job."
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={createJobMutation.isPending}
              onPress={() => {
                setNewJobOpen(false);
                resetJobForm();
              }}
            >
              Cancel
            </Button>
            <Button
              loading={createJobMutation.isPending}
              onPress={handleCreateJob}
            >
              Submit
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="job-printer">Printer</Label>
            <Select
              value={jobPrinterId}
              onValueChange={setJobPrinterId}
              options={printerOptions}
              placeholder="Select a printer…"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="job-template">Template</Label>
            <Select
              value={jobTemplateId}
              onValueChange={setJobTemplateId}
              options={templateOptions}
              placeholder="Select a template…"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="job-variables">Variables (JSON)</Label>
            <Input
              id="job-variables"
              placeholder='{"key": "value"}'
              value={jobVariables}
              onChangeText={setJobVariables}
              disabled={createJobMutation.isPending}
              className="font-mono text-xs"
            />
            <p className="m-0 text-[11px] text-muted-foreground">
              Enter template variables as a JSON object.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="job-copies">Copies</Label>
            <Input
              id="job-copies"
              type="number"
              min="1"
              value={jobCopies}
              onChangeText={setJobCopies}
              disabled={createJobMutation.isPending}
              className="max-w-[120px]"
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// ─── Deployment Status Section ──────────────────────────────────────────────

function DeploymentStatusSection({
  deployment,
  isLoading,
}: {
  deployment: DeploymentRow | null | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-64 mt-1" />
        </CardHeader>
        <CardContent>
          <div className="flex gap-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-20" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!deployment) {
    return (
      <EmptyState
        title="No spool deployment"
        description="No spool deployment configured. Contact your admin."
        icon={<Printer className="size-8" />}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>Spool Deployment</CardTitle>
          <Badge tone={DEPLOYMENT_TONES[deployment.status] ?? "neutral"}>
            {deployment.status.toUpperCase()}
          </Badge>
        </div>
        <CardDescription>
          {deployment.spoolDomain}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <span className="text-xs font-medium text-muted-foreground">Domain</span>
            <p className="m-0 font-mono text-xs text-foreground mt-0.5">
              {deployment.spoolDomain}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium text-muted-foreground">Version</span>
            <p className="m-0 text-xs text-foreground mt-0.5">
              {deployment.spoolVersion || "—"}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium text-muted-foreground">Last Seen</span>
            <p className="m-0 text-xs text-foreground mt-0.5">
              {deployment.lastSeenAt
                ? formatDistanceToNow(new Date(deployment.lastSeenAt), { addSuffix: true })
                : "Never"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
