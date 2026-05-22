import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { toast } from "sonner";
import { format } from "date-fns";

import { requirePlatformAdmin } from "@/lib/route-guards";

export const Route = createFileRoute("/platform/waitlist")({
  component: PlatformWaitlistComponent,
  beforeLoad: requirePlatformAdmin,
});

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
    }
  });

  const rejectMutation = useMutation({
    ...trpc.platform.waitlistReject.mutationOptions(),
    onSuccess: () => {
      toast.success("Waitlist request rejected");
      refetch();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to reject request");
    }
  });

  if (isLoading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Waitlist Management</h1>
        <p className="text-muted-foreground">Review and approve incoming company requests.</p>
      </div>

      <div className="border rounded-md">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Requester</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Notes</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {requests?.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No pending waitlist requests.
                </td>
              </tr>
            ) : (
              requests?.map((req) => (
                <tr key={req.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3">{format(new Date(req.createdAt), "MMM d, yyyy")}</td>
                  <td className="px-4 py-3 font-medium">{req.companyName}</td>
                  <td className="px-4 py-3">{req.requesterName}</td>
                  <td className="px-4 py-3">{req.requesterEmail}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate" title={req.notes || ""}>
                    {req.notes || "-"}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => rejectMutation.mutate({ id: req.id })}
                      disabled={rejectMutation.isPending || approveMutation.isPending}
                    >
                      Reject
                    </Button>
                    <Button 
                      size="sm"
                      onClick={() => approveMutation.mutate({ id: req.id })}
                      disabled={rejectMutation.isPending || approveMutation.isPending}
                    >
                      Approve
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
