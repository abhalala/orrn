import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { toast } from "sonner";
import { useState } from "react";
import { format } from "date-fns";

import { Can } from "@/components/can";
import { useMe } from "@/lib/me";
import { can } from "@/lib/me";
import { requireCompanyMe } from "@/lib/route-guards";

const companyRoles = ["owner", "admin", "manager", "operator", "viewer"] as const;

export const Route = createFileRoute("/settings/members")({
  component: MembersComponent,
  beforeLoad: requireCompanyMe,
});

function MembersComponent() {
  const { data: me } = useMe();
  const canManageMembers = can(me, "member.updateRole");
  const { data: members, isLoading, refetch } = useQuery(trpc.company.membersList.queryOptions());
  const { data: invites, refetch: refetchInvites } = useQuery(trpc.invite.list.queryOptions());
  
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<typeof companyRoles[number]>("viewer");

  const inviteMutation = useMutation({
    ...trpc.invite.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Invitation sent");
      setEmail("");
      refetchInvites();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to send invitation");
    }
  });

  const revokeMutation = useMutation({
    ...trpc.invite.revoke.mutationOptions(),
    onSuccess: () => {
      toast.success("Invitation revoked");
      refetchInvites();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to revoke invitation");
    }
  });

  const removeMutation = useMutation({
    ...trpc.company.membersRemove.mutationOptions(),
    onSuccess: () => {
      toast.success("Member removed");
      refetch();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to remove member");
    }
  });

  const updateRoleMutation = useMutation({
    ...trpc.company.membersUpdateRole.mutationOptions(),
    onSuccess: () => {
      toast.success("Role updated");
      refetch();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update role");
    }
  });

  if (isLoading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Members</h1>
        <p className="text-muted-foreground">Manage your team members and roles.</p>
      </div>

      <Can do="member.invite">
        <div className="p-6 border rounded-md bg-card space-y-4">
          <h2 className="text-xl font-semibold">Invite Member</h2>
          <div className="flex items-center gap-4">
            <Input
              placeholder="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="max-w-sm"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
              className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 max-w-[150px]"
            >
              {companyRoles.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <Button
              onClick={() => inviteMutation.mutate({ email, role })}
              disabled={!email || inviteMutation.isPending}
            >
              Send Invite
            </Button>
          </div>
        </div>
      </Can>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Pending Invites</h2>
        <div className="border rounded-md">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invites?.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No pending invitations.
                  </td>
                </tr>
              ) : (
                invites?.map((invite) => (
                  <tr key={invite.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">{invite.email}</td>
                    <td className="px-4 py-3 capitalize">{invite.role}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {format(new Date(invite.expiresAt), "MMM d, yyyy")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Can do="member.invite">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => revokeMutation.mutate({ inviteId: invite.id })}
                          disabled={revokeMutation.isPending}
                        >
                          Revoke
                        </Button>
                      </Can>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Active Members</h2>
        <div className="border rounded-md">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {members?.map((member) => (
                <tr key={member.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium">{member.user.name}</td>
                  <td className="px-4 py-3">{member.user.email}</td>
                  <td className="px-4 py-3">
                    {canManageMembers ? (
                      <select
                        value={member.role}
                        onChange={(e) => updateRoleMutation.mutate({ membershipId: member.id, role: e.target.value as any })}
                        className="bg-transparent border-none p-0 focus:ring-0 cursor-pointer capitalize"
                        disabled={updateRoleMutation.isPending}
                      >
                        {companyRoles.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="capitalize">{member.role}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {format(new Date(member.createdAt), "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Can do="member.remove">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => removeMutation.mutate({ membershipId: member.id })}
                        disabled={removeMutation.isPending}
                      >
                        Remove
                      </Button>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
