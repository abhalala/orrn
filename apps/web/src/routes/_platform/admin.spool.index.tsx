import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import { Copy, Download, Plus, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { requirePlatformAdmin } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

const DEPLOYMENT_STATUSES = ["pending", "active", "revoked"] as const;
type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];
type StatusFilter = DeploymentStatus | "all";

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export const Route = createFileRoute("/_platform/admin/spool/")({
  component: AdminSpoolComponent,
  beforeLoad: requirePlatformAdmin,
  validateSearch: (search: Record<string, unknown>) => ({
    status: (search.status as StatusFilter | undefined) ?? "all",
  }),
});

type DeploymentRow = {
  id: string;
  companyId: string;
  instanceId: string;
  status: string;
  subdomain: string;
  spoolDomain: string;
  spoolVersion: string | null;
  lastSeenAt: Date | string | number | null;
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
  companyName: string;
};

type CreateResult = {
  id: string;
  instanceId: string;
  subdomain: string;
  spoolDomain: string;
  sharedSecret: string;
  cfTunnelToken: string;
};

function AdminSpoolComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const status = search.status ?? "all";
  const qc = useQueryClient();

  // ── Create dialog state ──────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createCompanyId, setCreateCompanyId] = useState("");
  const [createSubdomain, setCreateSubdomain] = useState("");
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [createError, setCreateError] = useState("");

  // ── Revoke dialog state ──────────────────────────────────────────────
  const [revokeTarget, setRevokeTarget] = useState<DeploymentRow | null>(null);

  // ── Regenerate secret dialog state ───────────────────────────────────
  const [secretTarget, setSecretTarget] = useState<DeploymentRow | null>(null);
  const [newSecretValue, setNewSecretValue] = useState<string | null>(null);

  // ── Download dialog state ────────────────────────────────────────────
  const [downloadTarget, setDownloadTarget] = useState<DeploymentRow | null>(null);
  const [downloadPlatform, setDownloadPlatform] = useState<"linux-amd64" | "darwin-amd64" | "darwin-arm64" | "windows-amd64">("darwin-arm64");

  // ── Query ────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    ...trpc.platform.spoolDeploymentsList.queryOptions({
      limit: 100,
      offset: 0,
      status: status === "all" ? undefined : (status as DeploymentStatus),
    }),
  });

  // ── Mutations ────────────────────────────────────────────────────────
  const createMutation = useMutation({
    ...trpc.platform.spoolDeploymentCreate.mutationOptions(),
    onSuccess: (result) => {
      setCreateResult(result as unknown as CreateResult);
      setCreateCompanyId("");
      setCreateSubdomain("");
      setCreateError("");
      qc.invalidateQueries({ queryKey: trpc.platform.spoolDeploymentsList.queryKey() });
      toast.success("Spool deployment created");
    },
    onError: (e: any) => {
      setCreateError(e.message);
      toast.error(e.message || "Failed to create deployment");
    },
  });

  const revokeMutation = useMutation({
    ...trpc.platform.spoolDeploymentRevoke.mutationOptions(),
    onSuccess: () => {
      toast.success("Deployment revoked");
      setRevokeTarget(null);
      qc.invalidateQueries({ queryKey: trpc.platform.spoolDeploymentsList.queryKey() });
    },
    onError: (e: any) => toast.error(e.message || "Failed to revoke"),
  });

  const regenerateMutation = useMutation({
    ...trpc.platform.spoolDeploymentRegenerateSecret.mutationOptions(),
    onSuccess: (result) => {
      setNewSecretValue((result as { sharedSecret: string }).sharedSecret);
      toast.success("Secret regenerated");
      qc.invalidateQueries({ queryKey: trpc.platform.spoolDeploymentsList.queryKey() });
    },
    onError: (e: any) => toast.error(e.message || "Failed to regenerate secret"),
  });

  const downloadMutation = useMutation({
    ...trpc.platform.spoolDeploymentDownloadUrl.mutationOptions(),
    onSuccess: (result) => {
      // Open the download URL in a new tab
      window.open((result as { downloadUrl: string }).downloadUrl, "_blank");
      toast.success("Download started");
    },
    onError: (e: any) => toast.error(e.message || "Failed to generate download URL"),
  });

  // ── Helpers ──────────────────────────────────────────────────────────
  const handleCreate = () => {
    const trimmedId = createCompanyId.trim();
    const trimmedSub = createSubdomain.trim().toLowerCase();

    if (!trimmedId) {
      setCreateError("Company ID is required");
      return;
    }
    if (!trimmedSub) {
      setCreateError("Subdomain is required");
      return;
    }
    if (trimmedSub.length < 3 || trimmedSub.length > 63) {
      setCreateError("Subdomain must be between 3 and 63 characters");
      return;
    }
    if (!SUBDOMAIN_REGEX.test(trimmedSub)) {
      setCreateError("Subdomain must be lowercase alphanumeric with hyphens, and cannot start or end with a hyphen");
      return;
    }

    setCreateError("");
    createMutation.mutate({ companyId: trimmedId, subdomain: trimmedSub });
  };

  const handleRevoke = () => {
    if (!revokeTarget) return;
    revokeMutation.mutate({ id: revokeTarget.id });
  };

  const handleRegenerate = () => {
    if (!secretTarget) return;
    setNewSecretValue(null);
    regenerateMutation.mutate({ id: secretTarget.id });
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  const statusTone = (s: string) => {
    switch (s) {
      case "active":
        return "success" as const;
      case "pending":
        return "warning" as const;
      case "revoked":
        return "danger" as const;
      default:
        return "neutral" as const;
    }
  };

  // ── Columns ──────────────────────────────────────────────────────────
  const columns = useMemo((): DataTableColumn<DeploymentRow>[] => {
    return [
      {
        id: "company",
        header: "Company",
        flex: 1.2,
        sortable: true,
        sortValue: (row) => row.companyName.toLowerCase(),
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{row.companyName}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{row.subdomain}</p>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        flex: 0.6,
        sortable: true,
        sortValue: (row) => row.status,
        cell: (row) => (
          <Badge tone={statusTone(row.status)}>
            {row.status}
          </Badge>
        ),
      },
      {
        id: "domain",
        header: "Domain",
        flex: 0.9,
        cell: (row) => (
          <span className="truncate font-mono text-xs text-foreground">{row.spoolDomain}</span>
        ),
      },
      {
        id: "version",
        header: "Version",
        flex: 0.5,
        sortable: true,
        sortValue: (row) => row.spoolVersion ?? "",
        cell: (row) => (
          <span className="text-xs text-muted-foreground">
            {row.spoolVersion || "—"}
          </span>
        ),
      },
      {
        id: "lastSeen",
        header: "Last Seen",
        flex: 0.7,
        sortable: true,
        sortValue: (row) => (row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0),
        cell: (row) => (
          <span className="text-xs text-muted-foreground">
            {row.lastSeenAt
              ? formatDistanceToNow(new Date(row.lastSeenAt), { addSuffix: true })
              : "Never"}
          </span>
        ),
      },
      {
        id: "created",
        header: "Created",
        flex: 0.7,
        sortable: true,
        sortValue: (row) => new Date(row.createdAt).getTime(),
        cell: (row) => (
          <span className="text-xs text-muted-foreground">
            {format(new Date(row.createdAt), "PP")}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        flex: 1.2,
        align: "right",
        cell: (row) => (
          <div className="flex justify-end gap-2 flex-wrap">
            <Can do="platform.spool.manage">
              {row.status !== "revoked" ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                      disabled={regenerateMutation.isPending}
                      onClick={() => {
                        setSecretTarget(row);
                        setNewSecretValue(null);
                      }}
                    >
                      <RefreshCw className="size-3" />
                      Secret
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onPress={() => {
                        setDownloadTarget(row);
                        setDownloadPlatform("darwin-arm64");
                      }}
                    >
                      <Download className="size-3" />
                      Download
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={revokeMutation.isPending}
                      onClick={() => setRevokeTarget(row)}
                    >
                      <Trash2 className="size-3" />
                      Revoke
                    </Button>
                </>
              ) : null}
            </Can>
          </div>
        ),
      },
    ];
  }, [regenerateMutation.isPending, revokeMutation.isPending, downloadMutation.isPending]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform"
        title="Spool Deployments"
        description={`Manage per-tenant spool deployments for LAN printing (${data?.total ?? 0} total).`}
        actions={
          <div className="flex gap-2">
            <Link to="/admin" className="no-underline">
              <Button variant="outline">Back to console</Button>
            </Link>
            <Can do="platform.spool.manage">
              <Button onPress={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                Create Deployment
              </Button>
            </Can>
          </div>
        }
      />

      <Toolbar>
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">Filter:</span>
          {(["all", ...DEPLOYMENT_STATUSES] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "secondary" : "ghost"}
              onPress={() => navigate({ search: { status: s as StatusFilter } })}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>
      </Toolbar>

      <DataTable
        columns={columns}
        rows={(data?.items as DeploymentRow[]) ?? []}
        rowKey={(row) => row.id}
        renderCard={(row) => (
          <div className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-foreground">{row.companyName}</p>
                <p className="m-0 font-mono text-xs text-muted-foreground">{row.subdomain}</p>
              </div>
              <Badge tone={statusTone(row.status)}>{row.status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Domain</p>
                <p className="m-0 truncate font-mono text-xs text-foreground">{row.spoolDomain}</p>
              </div>
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Version</p>
                <p className="m-0 text-xs text-foreground">{row.spoolVersion || "—"}</p>
              </div>
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Last Seen</p>
                <p className="m-0 text-xs text-foreground">
                  {row.lastSeenAt
                    ? formatDistanceToNow(new Date(row.lastSeenAt), { addSuffix: true })
                    : "Never"}
                </p>
              </div>
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Created</p>
                <p className="m-0 text-xs text-foreground">{format(new Date(row.createdAt), "MMM d")}</p>
              </div>
            </div>
            <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-3">
              <Can do="platform.spool.manage">
                {row.status !== "revoked" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={regenerateMutation.isPending}
                      onClick={() => {
                        setSecretTarget(row);
                        setNewSecretValue(null);
                      }}
                    >
                      <RefreshCw className="size-3" />
                      Secret
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onPress={() => {
                        setDownloadTarget(row);
                        setDownloadPlatform("darwin-arm64");
                      }}
                    >
                      <Download className="size-3" />
                      Download
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={revokeMutation.isPending}
                      onClick={() => setRevokeTarget(row)}
                    >
                      <Trash2 className="size-3" />
                      Revoke
                    </Button>
                  </>
                ) : null}
              </Can>
            </div>
          </div>
        )}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title="No spool deployments"
            description={
              status !== "all"
                ? `No deployments with status "${status}". Try a different filter.`
                : "Create a deployment to get started with LAN printing for a tenant."
            }
          />
        }
      />

      {/* ── Create Deployment Dialog ──────────────────────────────────── */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open && !createMutation.isPending) {
            setCreateOpen(false);
            setCreateError("");
          }
        }}
        title="Create Spool Deployment"
        description="Provision a new spool deployment for a tenant company."
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={createMutation.isPending}
              onPress={() => {
                setCreateOpen(false);
                setCreateError("");
              }}
            >
              Cancel
            </Button>
            <Button
              loading={createMutation.isPending}
              onPress={handleCreate}
            >
              Create
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="company-id">Company ID</Label>
            <Input
              id="company-id"
              placeholder="Enter the company UUID"
              value={createCompanyId}
              onChangeText={setCreateCompanyId}
              disabled={createMutation.isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="subdomain">Subdomain</Label>
            <Input
              id="subdomain"
              placeholder="e.g. acme-corp-warehouse"
              value={createSubdomain}
              onChangeText={(v) => setCreateSubdomain(v.toLowerCase())}
              disabled={createMutation.isPending}
            />
            <p className="m-0 text-[11px] text-muted-foreground">
              3–63 lowercase alphanumeric characters and hyphens. Must start and end with a letter or digit.
            </p>
          </div>
          {createError ? (
            <p className="m-0 text-sm text-destructive">{createError}</p>
          ) : null}
        </div>
      </Dialog>

      {/* ── Created Secrets Dialog ────────────────────────────────────── */}
      <Dialog
        open={createResult !== null}
        onOpenChange={(open) => {
          if (!open) setCreateResult(null);
        }}
        title="Deployment Created"
        description="Copy these credentials now — they will not be shown again."
        actions={
          <Button onPress={() => setCreateResult(null)}>
            Done
          </Button>
        }
      >
        {createResult ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label>Instance ID</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs">
                  {createResult.instanceId}
                </code>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Spool Domain</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs">
                  {createResult.spoolDomain}
                </code>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="flex items-center gap-1.5">
                <ShieldAlert className="size-3.5 text-amber-500" />
                Shared Secret
              </Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs">
                  {createResult.sharedSecret}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => copyToClipboard(createResult.sharedSecret, "Shared secret")}
                >
                  <Copy className="size-3" />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="flex items-center gap-1.5">
                <ShieldAlert className="size-3.5 text-amber-500" />
                Cloudflare Tunnel Token
              </Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs">
                  {createResult.cfTunnelToken}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => copyToClipboard(createResult.cfTunnelToken, "Tunnel token")}
                >
                  <Copy className="size-3" />
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* ── Revoke Confirmation Dialog ────────────────────────────────── */}
      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !revokeMutation.isPending) setRevokeTarget(null);
        }}
        title="Revoke Deployment"
        description={`This will permanently revoke the spool deployment for "${revokeTarget?.companyName ?? "—"}" (${revokeTarget?.subdomain ?? "—"}). The Cloudflare tunnel and DNS record will be deleted, and the spool will stop functioning.`}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={revokeMutation.isPending}
              onPress={() => setRevokeTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={revokeMutation.isPending}
              onPress={handleRevoke}
            >
              Revoke
            </Button>
          </div>
        }
      />

      {/* ── Regenerate Secret Dialog ──────────────────────────────────── */}
      <Dialog
        open={secretTarget !== null}
        onOpenChange={(open) => {
          if (!open && !regenerateMutation.isPending) {
            setSecretTarget(null);
            setNewSecretValue(null);
          }
        }}
        title="Regenerate Shared Secret"
        description={
          newSecretValue
            ? "The new shared secret is shown below. Update your spool configuration with this value."
            : `Generate a new shared secret for "${secretTarget?.companyName ?? "—"}" (${secretTarget?.subdomain ?? "—"}). The old secret will stop working immediately.`
        }
        actions={
          newSecretValue ? (
            <Button onPress={() => {
              setSecretTarget(null);
              setNewSecretValue(null);
            }}>
              Done
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={regenerateMutation.isPending}
                onPress={() => {
                  setSecretTarget(null);
                  setNewSecretValue(null);
                }}
              >
                Cancel
              </Button>
              <Button
                loading={regenerateMutation.isPending}
                onPress={handleRegenerate}
              >
                Regenerate
              </Button>
            </div>
          )
        }
      >
        {newSecretValue ? (
          <div className="flex flex-col gap-2">
            <Label className="flex items-center gap-1.5">
              <ShieldAlert className="size-3.5 text-amber-500" />
              New Shared Secret
            </Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs">
                {newSecretValue}
              </code>
              <Button
                size="sm"
                variant="outline"
                onPress={() => copyToClipboard(newSecretValue, "Shared secret")}
              >
                <Copy className="size-3" />
              </Button>
            </div>
            <p className="m-0 text-[11px] text-muted-foreground">
              This secret is shown only once. Copy it now before closing this dialog.
            </p>
          </div>
        ) : null}
      </Dialog>

      {/* ── Download Binary Dialog ──────────────────────────────────────── */}
      <Dialog
        open={downloadTarget !== null}
        onOpenChange={(open) => {
          if (!open && !downloadMutation.isPending) setDownloadTarget(null);
        }}
        title="Download Spool Binary"
        description={`Download a pre-configured binary for "${downloadTarget?.companyName ?? "—"}" (${downloadTarget?.subdomain ?? "—"}). The binary has deployment secrets baked in — no config editing needed.`}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={downloadMutation.isPending}
              onPress={() => setDownloadTarget(null)}
            >
              Cancel
            </Button>
            <Button
              loading={downloadMutation.isPending}
              onPress={() => {
                if (downloadTarget) {
                  downloadMutation.mutate({ id: downloadTarget.id, platform: downloadPlatform });
                }
              }}
            >
              <Download className="size-4" />
              Download Binary
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="download-platform">Platform</Label>
            <select
              id="download-platform"
              value={downloadPlatform}
              onChange={(e) => setDownloadPlatform(e.target.value as typeof downloadPlatform)}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
            >
              <option value="darwin-arm64">macOS (Apple Silicon / arm64)</option>
              <option value="darwin-amd64">macOS (Intel / amd64)</option>
              <option value="linux-amd64">Linux (amd64)</option>
              <option value="windows-amd64">Windows (amd64)</option>
            </select>
            <p className="m-0 text-[11px] text-muted-foreground">
              The binary includes your deployment config — just run it. No config.yaml needed.
            </p>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
