import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Boxes,
  Building2,
  CheckCircle2,
  Factory,
  Package,
  Printer,
  Shield,
  Truck,
  Warehouse,
} from "lucide-react";
import { useEffect } from "react";

import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_public/")({
  component: HomeComponent,
});

const modules = [
  {
    title: "Die Catalog",
    icon: Boxes,
    description: "Profile specs, theoretical weight, alloy metadata, and tooling status.",
  },
  {
    title: "Receipts & Bundles",
    icon: Package,
    description: "Press receipts create traceable bundles with piece count, length, and status.",
  },
  {
    title: "Stock & Dispatch",
    icon: Truck,
    description: "Live stock by die, reservation controls, dispatch packing lists, and exports.",
  },
  {
    title: "LAN Printing",
    icon: Printer,
    description: "Signed spool jobs reach tenant-local thermal printers without Worker printer I/O.",
  },
];

const platformFacts = [
  "Tenant scope is derived from session context.",
  "Native sync mirrors tenant-local floor workflows.",
  "Platform staff support flows are permission-gated and audited.",
];

function HomeComponent() {
  const healthCheck = useQuery(trpc.healthCheck.queryOptions());
  const meQuery = useQuery({ ...trpc.auth.me.queryOptions(), retry: false });

  useEffect(() => {
    if (meQuery.data?.user) {
      window.location.href = meQuery.data.isPlatformAdmin ? "/admin" : "/dashboard";
    }
  }, [meQuery.data]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 md:px-6">
        <Link to="/" className="flex items-center gap-3 no-underline">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            O
          </div>
          <div className="leading-tight">
            <span className="block text-base font-semibold text-foreground">ORRN</span>
            <span className="block text-xs text-muted-foreground">Manufactured Inventory ERP</span>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/login">
            <Button variant="ghost">Sign In</Button>
          </Link>
          <Link to="/waitlist" search={{ mode: "demo" }}>
            <Button>Request Demo</Button>
          </Link>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-14 pt-8 md:grid-cols-[1fr_420px] md:px-6 md:pt-16">
        <div className="space-y-7">
          <div className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <Factory size={14} aria-hidden="true" />
            Built for aluminum extrusion operations first
          </div>
          <div className="space-y-4">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-foreground md:text-5xl">
              ORRN
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Multi-company ERP for dies, bundles, stock, dispatches, packing lists, print queues, and floor-native workflows.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/waitlist" search={{ mode: "demo" }}>
              <Button size="lg">Request Demo</Button>
            </Link>
            <Link to="/waitlist" search={{ mode: "waitlist" }}>
              <Button size="lg" variant="outline">Join Waitlist</Button>
            </Link>
          </div>
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Operations Snapshot</CardTitle>
            <CardDescription>Quiet, scan-first surfaces for repeated ERP work.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              ["Available bundles", "1,248"],
              ["Reserved dispatches", "18"],
              ["Open print jobs", "6"],
              ["Stock review alerts", "3"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="font-mono text-sm font-semibold text-foreground">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="border-y border-border bg-card/40">
        <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-10 md:grid-cols-4 md:px-6">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <Card key={module.title}>
                <CardHeader>
                  <Icon size={20} className="text-primary" aria-hidden="true" />
                  <CardTitle>{module.title}</CardTitle>
                  <CardDescription>{module.description}</CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 md:grid-cols-2 md:px-6">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Shield size={16} aria-hidden="true" />
            Tenant-first by design
          </div>
          <h2 className="text-2xl font-semibold text-foreground">No cross-tenant assumptions in product flow.</h2>
          <p className="text-sm leading-7 text-muted-foreground">
            ORRN keeps company context server-owned, hides unavailable actions before users hit them, and keeps platform support separate from normal tenant work.
          </p>
        </div>
        <Card>
          <CardContent className="space-y-3">
            {platformFacts.map((fact) => (
              <div key={fact} className="flex gap-3 text-sm text-foreground">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <span>{fact}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <footer className="mx-auto flex w-full max-w-6xl flex-col gap-3 border-t border-border px-4 py-6 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${healthCheck.data ? "bg-emerald-500" : "bg-destructive"}`} />
          <span>{healthCheck.isLoading ? "Checking API…" : healthCheck.data ? "API connected" : "API unavailable"}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1"><Building2 size={13} aria-hidden="true" /> Multi-company</span>
          <span className="inline-flex items-center gap-1"><Warehouse size={13} aria-hidden="true" /> Inventory ops</span>
        </div>
      </footer>
    </main>
  );
}
