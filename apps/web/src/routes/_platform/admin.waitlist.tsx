import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { requirePlatformAdmin } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_platform/admin/waitlist")({
  component: AdminWaitlistComponent,
  beforeLoad: requirePlatformAdmin,
});

type WaitlistRow = {
  id: string;
  companyName: string;
  requesterName: string;
  requesterEmail: string;
  notes: string | null;
  createdAt: string | number | Date;
};

function AdminWaitlistComponent() {
  const { data: requests, isLoading, refetch } = useQuery(trpc.platform.waitlistList.queryOptions());
  const pendingCount = requests?.length ?? 0;

  const approveMutation = useMutation({
    ...trpc.platform.waitlistApprove.mutationOptions(),
    onSuccess: () => {
      toast.success("Waitlist request approved");
      refetch();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to approve request");
    },
  });

  const rejectMutation = useMutation({
    ...trpc.platform.waitlistReject.mutationOptions(),
    onSuccess: () => {
      toast.success("Waitlist request rejected");
      refetch();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to reject request");
    },
  });

  const columns: DataTableColumn<WaitlistRow>[] = [
    {
      id: "date",
      header: "Date",
      cell: (r) => format(new Date(r.createdAt), "MMM d, yyyy"),
    },
    {
      id: "company",
      header: "Company",
      cell: (r) => <span className="font-medium">{r.companyName}</span>,
      flex: 2,
    },
    { id: "requester", header: "Requester", cell: (r) => r.requesterName },
    { id: "email", header: "Email", cell: (r) => r.requesterEmail, flex: 2 },
    {
      id: "notes",
      header: "Notes",
      cell: (r) => (
        <span className="text-xs text-muted-foreground line-clamp-1 max-w-[280px]">
          {r.notes || "—"}
        </span>
      ),
      flex: 2,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex gap-2">
          <Can do="platform.waitlist.review">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => rejectMutation.mutate({ id: r.id })}
              disabled={rejectMutation.isPending || approveMutation.isPending}
            >
              Reject
            </Button>
            <Button
              size="sm"
              onClick={() => approveMutation.mutate({ id: r.id })}
              disabled={rejectMutation.isPending || approveMutation.isPending}
            >
              Approve
            </Button>
          </Can>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform"
        title={
          <span className="flex items-center gap-3">
            Waitlist
            {pendingCount > 0 ? <Badge tone="warning">{pendingCount} pending</Badge> : null}
          </span>
        }
        description="Review and approve incoming company requests."
        actions={
          <Link to="/admin" className="no-underline">
            <Button variant="outline">Back to console</Button>
          </Link>
        }
      />

      <DataTable
        rows={(requests ?? []) as WaitlistRow[]}
        rowKey={(r) => r.id}
        columns={columns}
        isLoading={isLoading}
        emptyState={<EmptyState title="No pending requests" description="The waitlist is empty right now." />}
      />
    </div>
  );
}
