import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { PageHeader } from "@orrn/ui/components/page-header";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, ClipboardList, Users } from "lucide-react";
import { Can } from "@orrn/web-shared/components/can";

import { requirePlatformAdmin } from "@orrn/web-shared/lib/admin-guards";

export const Route = createFileRoute("/admin/")({
  component: AdminIndexComponent,
  beforeLoad: requirePlatformAdmin,
});

function AdminIndexComponent() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform"
        title="Admin console"
        description="Manage tenants, review waitlist requests, and start time-boxed impersonation sessions."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 size={18} /> Companies
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Browse tenants, suspend access, and impersonate with audited grants.
            </p>
            <Link to="/admin/companies">
              <Button>Open companies</Button>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList size={18} /> Waitlist
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Approve or reject inbound SaaS waitlist requests.
            </p>
            <Link to="/admin/waitlist">
              <Button variant="outline">Review waitlist</Button>
            </Link>
          </CardContent>
        </Card>
        <Can do="platform.staff.list">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users size={18} /> Staff
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Create orrn.app staff logins (email + password) with role-based permissions.
              </p>
              <Link to="/admin/staff">
                <Button variant="outline">Manage staff</Button>
              </Link>
            </CardContent>
          </Card>
        </Can>
      </div>
    </div>
  );
}
