import { Button } from "@orrn/ui/components/button";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { toast } from "sonner";

import { Can } from "@/components/can";
import { requirePlatformAdmin } from "@/lib/route-guards";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/platform/waitlist")({
  component: PlatformWaitlistComponent,
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

function PlatformWaitlistComponent() {
  const { data: requests, isLoading, refetch } = useQuery(trpc.platform.waitlistList.queryOptions());

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
              variant="outline"
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
        title="Waitlist"
        description="Review and approve incoming company requests."
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
