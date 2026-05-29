import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { Dialog, DialogCloseButton } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Select } from "@orrn/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Can } from "@orrn/web-shared/components/can";
import { requirePlatformAdmin } from "@orrn/web-shared/lib/admin-guards";
import { useMe } from "@orrn/web-shared/lib/me";
import { trpc } from "@orrn/web-shared/utils/trpc";

export const Route = createFileRoute("/admin/staff")({
  beforeLoad: requirePlatformAdmin,
  component: StaffAdminPage,
});

type StaffRole = "super_admin" | "admin" | "support";

type StaffRow = {
  userId: string;
  name: string;
  email: string;
  role: StaffRole;
  createdAt: Date | string | number;
};

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email required"),
  password: z.string().min(12, "Password must be at least 12 characters"),
  role: z.enum(["super_admin", "admin", "support"]),
});

const ROLE_TONE: Record<StaffRole, "warning" | "info" | "neutral"> = {
  super_admin: "warning",
  admin: "info",
  support: "neutral",
};

function formatRole(role: StaffRole): string {
  return role.replace("_", " ");
}

function StaffAdminPage() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();

  const staffQuery = useQuery(trpc.platform.staffList.queryOptions());
  const rolesQuery = useQuery(trpc.platform.staffAssignableRoles.queryOptions());

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "support" as StaffRole,
  });

  const [pendingRemove, setPendingRemove] = useState<StaffRow | null>(null);

  const createMutation = useMutation({
    ...trpc.platform.staffCreate.mutationOptions(),
    onSuccess: () => {
      toast.success("Staff account created");
      setForm({ name: "", email: "", password: "", role: "support" });
      void queryClient.invalidateQueries(trpc.platform.staffList.queryFilter());
    },
    onError: (err) => toast.error(err.message),
  });

  const updateRoleMutation = useMutation({
    ...trpc.platform.staffUpdateRole.mutationOptions(),
    onSuccess: () => {
      toast.success("Role updated");
      void queryClient.invalidateQueries(trpc.platform.staffList.queryFilter());
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    ...trpc.platform.staffRemove.mutationOptions(),
    onSuccess: () => {
      toast.success("Staff access removed");
      setPendingRemove(null);
      void queryClient.invalidateQueries(trpc.platform.staffList.queryFilter());
    },
    onError: (err) => toast.error(err.message),
  });

  const assignable = (rolesQuery.data ?? []) as StaffRole[];
  const roleOptions = assignable.map((role) => ({
    value: role,
    label: formatRole(role),
  }));

  const staff = (staffQuery.data ?? []) as StaffRow[];

  const columns: DataTableColumn<StaffRow>[] = [
    {
      id: "name",
      header: "Name",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">{row.name}</p>
          <p className="text-xs text-muted-foreground truncate">{row.email}</p>
        </div>
      ),
      flex: 2,
      sortable: true,
      sortValue: (row) => row.name.toLowerCase(),
    },
    {
      id: "role",
      header: "Role",
      cell: (row) => {
        const isSelf = row.userId === me?.user.id;
        const canEdit = !isSelf && assignable.includes(row.role);
        return (
          <Can
            do="platform.staff.updateRole"
            fallback={
              <Badge tone={ROLE_TONE[row.role]}>{formatRole(row.role).toUpperCase()}</Badge>
            }
          >
            {canEdit ? (
              <Select
                value={row.role}
                onValueChange={(v) =>
                  updateRoleMutation.mutate({ userId: row.userId, role: v as StaffRole })
                }
                options={roleOptions}
                width={160}
                disabled={updateRoleMutation.isPending}
              />
            ) : (
              <Badge tone={ROLE_TONE[row.role]}>{formatRole(row.role).toUpperCase()}</Badge>
            )}
          </Can>
        );
      },
      flex: 1.2,
    },
    {
      id: "created",
      header: "Created",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {format(new Date(row.createdAt), "PP")}
        </span>
      ),
      flex: 1,
      sortable: true,
      sortValue: (row) => new Date(row.createdAt).getTime(),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (row) => {
        if (row.userId === me?.user.id) return null;
        return (
          <Can do="platform.staff.remove">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPendingRemove(row)}
              disabled={removeMutation.isPending}
            >
              Remove
            </Button>
          </Can>
        );
      },
      flex: 0.6,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform"
        title="Staff accounts"
        description="Internal orrn.app users. Accounts are created here — there is no public sign-up on orrn.app."
      />

      <Can do="platform.staff.create">
        <Card>
          <CardHeader>
            <CardTitle>Create staff account</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
              <div className="space-y-2">
                <Label htmlFor="staff-name">Name</Label>
                <Input
                  id="staff-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-email">Email</Label>
                <Input
                  id="staff-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="staff-password">Temporary password</Label>
                <Input
                  id="staff-password"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Minimum 12 characters. Share securely out of band.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm((f) => ({ ...f, role: v as StaffRole }))}
                  options={roleOptions}
                  width={240}
                />
              </div>
            </div>
            <div className="mt-4">
              <Button
                disabled={createMutation.isPending}
                onClick={() => {
                  const parsed = createSchema.safeParse(form);
                  if (!parsed.success) {
                    toast.error(parsed.error.issues[0]?.message ?? "Invalid form");
                    return;
                  }
                  createMutation.mutate(parsed.data);
                }}
              >
                {createMutation.isPending ? "Creating…" : "Create account"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </Can>

      <Card>
        <CardHeader>
          <CardTitle>Active staff ({staff.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            rows={staff}
            rowKey={(row) => row.userId}
            isLoading={staffQuery.isLoading}
            emptyState={
              <EmptyState
                title="No staff yet"
                description="Use the form above to create the first orrn.app staff account."
              />
            }
          />
        </CardContent>
      </Card>

      <Dialog
        open={!!pendingRemove}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        title="Remove staff access"
        description={
          pendingRemove
            ? `Revoke orrn.app access for ${pendingRemove.email}? They will no longer be able to sign in to the staff console.`
            : undefined
        }
        actions={
          <>
            <DialogCloseButton onPress={() => setPendingRemove(null)} />
            <Button
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={() => {
                if (!pendingRemove) return;
                removeMutation.mutate({ userId: pendingRemove.userId });
              }}
            >
              {removeMutation.isPending ? "Removing…" : "Remove access"}
            </Button>
          </>
        }
      />
    </div>
  );
}
