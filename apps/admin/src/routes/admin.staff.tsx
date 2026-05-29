import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Can } from "@orrn/web-shared/components/can";
import { requirePlatformAdmin } from "@orrn/web-shared/lib/admin-guards";
import { trpc } from "@orrn/web-shared/utils/trpc";

export const Route = createFileRoute("/admin/staff")({
  beforeLoad: requirePlatformAdmin,
  component: StaffAdminPage,
});

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(12),
  role: z.enum(["super_admin", "admin", "support"]),
});

function StaffAdminPage() {
  const queryClient = useQueryClient();
  const staffQuery = useQuery(trpc.platform.staffList.queryOptions());
  const rolesQuery = useQuery(trpc.platform.staffAssignableRoles.queryOptions());

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "support" as "super_admin" | "admin" | "support",
  });

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
      void queryClient.invalidateQueries(trpc.platform.staffList.queryFilter());
    },
    onError: (err) => toast.error(err.message),
  });

  const assignable = rolesQuery.data ?? [];

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
          <CardContent className="space-y-4 max-w-lg">
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
            <div className="space-y-2">
              <Label htmlFor="staff-password">Temporary password</Label>
              <Input
                id="staff-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Minimum 12 characters. Share securely out of band.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-role">Role</Label>
              <select
                id="staff-role"
                className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm"
                value={form.role}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    role: e.target.value as typeof form.role,
                  }))
                }
              >
                {assignable.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
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
              Create account
            </Button>
          </CardContent>
        </Card>
      </Can>

      <Card>
        <CardHeader>
          <CardTitle>Active staff</CardTitle>
        </CardHeader>
        <CardContent>
          {staffQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ul className="divide-y divide-border">
              {(staffQuery.data ?? []).map((row) => (
                <li key={row.userId} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{row.name}</p>
                    <p className="text-sm text-muted-foreground">{row.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Can do="platform.staff.updateRole">
                      <select
                        className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                        value={row.role}
                        onChange={(e) =>
                          updateRoleMutation.mutate({
                            userId: row.userId,
                            role: e.target.value as typeof form.role,
                          })
                        }
                      >
                        {assignable.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </Can>
                    <Can do="platform.staff.remove">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Remove staff access for ${row.email}?`)) {
                            removeMutation.mutate({ userId: row.userId });
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </Can>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
