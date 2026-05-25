import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { getDomainConfig } from "@/lib/domain";
import { trpc } from "@/utils/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Button } from "@orrn/ui/components/button";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const navigate = useNavigate();
  const { isErpDomain, erpUrl, marketingUrl } = getDomainConfig();
  const healthCheck = useQuery(trpc.healthCheck.queryOptions());
  const meQuery = useQuery(trpc.auth.me.queryOptions());

  useEffect(() => {
    if (meQuery.data?.user) {
      if (!isErpDomain) {
        window.location.href = `${erpUrl}/dashboard`;
      } else {
        navigate({ to: "/dashboard" as any });
      }
    } else if (isErpDomain && !meQuery.isLoading) {
      window.location.href = `${marketingUrl}/login`;
    }
  }, [meQuery.data, meQuery.isLoading, isErpDomain, erpUrl, marketingUrl, navigate]);

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground">
          ORRN: Manufacturing Operations Simplified
        </h1>
        <p className="mt-4 text-xl text-muted-foreground max-w-2xl mx-auto">
          The all-in-one ERP for dies, bundles, stock, label printing, dispatches,
          packing lists, customers, and permissions — built for manufactured inventory operations.
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <Link to="/waitlist">
            <Button variant="default">Join Waitlist</Button>
          </Link>
          <Link to="/login">
            <Button variant="outline">Sign In</Button>
          </Link>
        </div>
      </div>

      {/* Features Section */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Die Management</CardTitle>
            <CardDescription>
              Full CRUD capabilities and bulk import for dies across Web and Native platforms.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>• Structured dimensions schema</div>
              <div>• Duplicate validation on creation</div>
              <div>• CSV/JSON Bulk Import & Resolution UI</div>
              <div>• Cross-platform Web/Native parity</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bundle & Stock Control</CardTitle>
            <CardDescription>
              Production-receipt-based bundle creation with auto-generated codes/serials.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>• Auto-generated bundle groups (BG-######)</div>
              <div>• Individual bundle serials (e.g., BG-000001-B001)</div>
              <div>• Available ↔ Void status transitions</div>
              <div>• Aggregated Stock view by die</div>
              <div>• CSV/JSON bulk import via receipt form</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dispatch Management</CardTitle>
            <CardDescription>
              Atomic dispatch lifecycle with synchronized bundle status transitions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>• Draft → Reserved → Completed/Cancelled workflow</div>
              <div>• Bundle reservations tied to dispatches</div>
              <div>• Auto-generated dispatch codes (DSP-######)</div>
              <div>• Serial scan/paste workflow for bundle additions</div>
              <div>• Activity timeline from audit logs</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer Relations</CardTitle>
            <CardDescription>
              Full CRUD capabilities and bulk import for customers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>• CSV Bulk Import with validation</div>
              <div>• Role-based access control</div>
              <div>• Audit trail for all changes</div>
              <div>• Member management under Settings</div>
              <div>• Web/Native feature parity</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Printing & Labeling</CardTitle>
            <CardDescription>
              Per-tenant LAN printing with orrn-spool integration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>• Label printing via HTTP API</div>
              <div>• Signed webhook confirmations</div>
              <div>• Client-side label template editing</div>
              <div>• Print queue management</div>
              <div>• Historical print audit logs</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform Administration</CardTitle>
            <CardDescription>
              Tenant management, impersonation controls, and system oversight.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>• Self-serve company onboarding flow</div>
              <div>• Platform-admin approval workflow</div>
              <div>• Time-boxed impersonation grants</div>
              <div>• Comprehensive audit log viewer</div>
              <div>• Role-based access control matrix</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* System Status */}
      <div className="border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-foreground">System Status</h2>
          <div className="flex items-center gap-2">
            <div
              className={`h-3 w-3 rounded-full ${
                healthCheck.data ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-sm font-medium text-foreground">
              {healthCheck.isLoading
                ? "Checking connection..."
                : healthCheck.data
                ? "All systems operational"
                : "System unavailable"}
            </span>
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          ORRN is currently in active development. Features are being rolled out
          progressively through our managed release process.
        </div>
      </div>
    </div>
  );
}