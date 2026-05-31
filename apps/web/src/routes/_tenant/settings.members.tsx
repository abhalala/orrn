import { StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { requireCompanyMe } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

const companyRoles = ["owner", "admin", "manager", "operator", "viewer"] as const;
type CompanyRole = (typeof companyRoles)[number];

type MemberRow = {
  id: string;
  role: CompanyRole;
  createdAt: string | number | Date;
  user: { name: string; email: string };
};

type InviteRow = {
  id: string;
  email: string;
  role: string;
  expiresAt: string | number | Date;
};

export const Route = createFileRoute("/_tenant/settings/members")({
  component: MembersComponent,
  beforeLoad: requireCompanyMe,
});

function MembersComponent() {
  const { data: me } = useMe();
  const canManageMembers = can(me, "member.updateRole");
  const { data: members, isLoading, refetch } = useQuery(trpc.company.membersList.queryOptions());
  const { data: invites, refetch: refetchInvites } = useQuery(trpc.invite.list.queryOptions());

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CompanyRole>("viewer");

  const inviteMutation = useMutation({
    ...trpc.invite.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Invitation sent");
      setEmail("");
      refetchInvites();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to send invitation");
    },
  });

  const revokeMutation = useMutation({
    ...trpc.invite.revoke.mutationOptions(),
    onSuccess: () => {
      toast.success("Invitation revoked");
      refetchInvites();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to revoke invitation");
    },
  });

  const removeMutation = useMutation({
    ...trpc.company.membersRemove.mutationOptions(),
    onSuccess: () => {
      toast.success("Member removed");
      refetch();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to remove member");
    },
  });

  const updateRoleMutation = useMutation({
    ...trpc.company.membersUpdateRole.mutationOptions(),
    onSuccess: () => {
      toast.success("Role updated");
      refetch();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update role");
    },
  });

  const inviteColumns: DataTableColumn<InviteRow>[] = [
    { id: "email", header: "Email", cell: (r) => r.email, flex: 2 },
    {
      id: "role",
      header: "Role",
      cell: (r) => <StatusBadge kind="role" value={r.role} />,
    },
    {
      id: "expires",
      header: "Expires",
      cell: (r) => format(new Date(r.expiresAt), "MMM d, yyyy"),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <Can do="member.invite">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => revokeMutation.mutate({ inviteId: r.id })}
            disabled={revokeMutation.isPending}
          >
            Revoke
          </Button>
        </Can>
      ),
    },
  ];

  const memberColumns: DataTableColumn<MemberRow>[] = [
    {
      id: "name",
      header: "Name",
      cell: (m) => <span className="font-medium">{m.user.name}</span>,
      flex: 2,
    },
    { id: "email", header: "Email", cell: (m) => m.user.email, flex: 2 },
    {
      id: "role",
      header: "Role",
      cell: (m) =>
        canManageMembers ? (
          <select
            value={m.role}
            onChange={(e) =>
              updateRoleMutation.mutate({
                membershipId: m.id,
                role: e.target.value as CompanyRole,
              })
            }
            className="bg-transparent text-sm capitalize border border-border rounded px-2 py-1"
            disabled={updateRoleMutation.isPending}
          >
            {companyRoles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : (
          <StatusBadge kind="role" value={m.role} />
        ),
    },
    {
      id: "joined",
      header: "Joined",
      cell: (m) => format(new Date(m.createdAt), "MMM d, yyyy"),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (m) => (
        <Can do="member.remove">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeMutation.mutate({ membershipId: m.id })}
            disabled={removeMutation.isPending}
          >
            Remove
          </Button>
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Members"
        description="Manage your team members, roles, and pending invitations."
      />

      <Can do="member.invite">
        <Card>
          <CardHeader>
            <CardTitle>Invite member</CardTitle>
            <CardDescription>Send a one-time invitation link to a teammate's email.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px] space-y-1">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  placeholder="teammate@company.com"
                  type="email"
                  value={email}
                  onChangeText={setEmail}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as CompanyRole)}
                  className="flex h-9 items-center justify-between rounded-md border border-border bg-background px-3 text-sm capitalize"
                >
                  {companyRoles.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={() => inviteMutation.mutate({ email, role })}
                disabled={!email || inviteMutation.isPending}
              >
                {inviteMutation.isPending ? "Sending…" : "Send invite"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </Can>

      <Card>
        <CardHeader>
          <CardTitle>Pending invites</CardTitle>
          <CardDescription>Unused invitation links.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={(invites ?? []) as InviteRow[]}
            rowKey={(r) => r.id}
            columns={inviteColumns}
            emptyState={<EmptyState title="No pending invites" />}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active members</CardTitle>
          <CardDescription>{members?.length ?? 0} member(s) in this tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={(members ?? []) as unknown as MemberRow[]}
            rowKey={(r) => r.id}
            columns={memberColumns}
            isLoading={isLoading}
            emptyState={<EmptyState title="No members yet" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
