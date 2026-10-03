import { StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { NativeSelect } from "@orrn/ui/components/native-select";
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
          <NativeSelect
            aria-label={`Role for ${m.user.name}`}
            value={m.role}
            onChange={(e) =>
              updateRoleMutation.mutate({
                membershipId: m.id,
                role: e.target.value as CompanyRole,
              })
            }
            density="compact" className="w-36 capitalize"
            disabled={updateRoleMutation.isPending}
          >
            {companyRoles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </NativeSelect>
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
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  placeholder="teammate@company.com"
                  type="email"
                  value={email}
                  onChangeText={setEmail}
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <NativeSelect
                  id="invite-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as CompanyRole)}
                  className="capitalize"
                >
                  {companyRoles.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button
                className="w-full sm:w-auto"
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
            renderCard={(r) => (
              <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-sm font-semibold text-foreground" title={r.email}>{r.email}</p>
                    <p className="m-0 text-xs text-muted-foreground">
                      Expires {format(new Date(r.expiresAt), "MMM d, yyyy")}
                    </p>
                  </div>
                  <StatusBadge kind="role" value={r.role} />
                </div>
                <Can do="member.invite">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revokeMutation.mutate({ inviteId: r.id })}
                    disabled={revokeMutation.isPending}
                  >
                    Revoke invite
                  </Button>
                </Can>
              </div>
            )}
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
            renderCard={(m) => (
              <div className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-background p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-sm font-semibold text-foreground" title={m.user.name}>{m.user.name}</p>
                    <p className="m-0 truncate text-xs text-muted-foreground" title={m.user.email}>{m.user.email}</p>
                  </div>
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
                </div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="m-0 text-xs font-medium text-muted-foreground">Joined</p>
                    <p className="m-0 text-sm text-foreground">{format(new Date(m.createdAt), "MMM d, yyyy")}</p>
                  </div>
                  <div className="min-w-[160px]">
                    <p className="m-0 mb-1 text-xs font-medium text-muted-foreground">Role</p>
                    {canManageMembers ? (
                      <NativeSelect
                        aria-label={`Role for ${m.user.name}`}
                        value={m.role}
                        onChange={(e) =>
                          updateRoleMutation.mutate({
                            membershipId: m.id,
                            role: e.target.value as CompanyRole,
                          })
                        }
                        density="compact" className="capitalize"
                        disabled={updateRoleMutation.isPending}
                      >
                        {companyRoles.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <StatusBadge kind="role" value={m.role} />
                    )}
                  </div>
                </div>
              </div>
            )}
            isLoading={isLoading}
            emptyState={<EmptyState title="No members yet" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
