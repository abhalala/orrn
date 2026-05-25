import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Layers,
  Box,
  Truck,
  Printer,
  Users,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  Activity,
  Globe,
  Database,
  Terminal,
  Code
} from "lucide-react";

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
  const [activeTab, setActiveTab] = useState<"dies" | "bundles" | "dispatches" | "printing">("dies");

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

  const tabsConfig = {
    dies: {
      title: "Extrusion Die Inventory",
      badge: "M3 Complete",
      icon: Layers,
      description: "Establish structural specifications for your extruded die sections. Define master dimension profiles with automatic yield calculations.",
      bullets: [
        "Structured multi-field dimension schemas (wall thickness, alloy, weight/meter).",
        "Strict duplicate validation checks based on section shape profiles.",
        "High-fidelity drag-and-drop CSV/JSON bulk import UI with conflict resolution."
      ],
      preview: `// Drizzle Schema validation
export const dies = sqliteTable("die", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  code: text("code").notNull(),
  weightPerMeter: real("weight_per_meter"),
  perimeter: real("perimeter"),
  status: text("status", { enum: ["active", "archived"] })
});`
    },
    bundles: {
      title: "Production Receipts & Serials",
      badge: "M4 Complete",
      icon: Box,
      description: "Generate tracking bundles directly from plant production receipts. Serials are constructed automatically to match exact shift outputs.",
      bullets: [
        "Monotonic prefix auto-codes: BG-{serverSeq} paired with barcode-friendly serials.",
        "State machine lockouts: bundles strictly follow available ↔ void transitions.",
        "Live stock aggregations: instant counts and total weights segmented by die profile."
      ],
      preview: `// Atomic Serial Generator
const groupCode = \`BG-\${nextSeq.padStart(6, "0")}\`;
const serials = Array.from({ length: quantity }).map((_, idx) => {
  return \`\${groupCode}-B\${String(idx + 1).padStart(3, "0")}\`;
});`
    },
    dispatches: {
      title: "Atomic Dispatch Lifecycles",
      badge: "M5 Complete",
      icon: Truck,
      description: "Orchestrate outbound customer dispatches with verified lifecycle guarantees. Avoid double reservations and void leaks dynamically.",
      bullets: [
        "Valid state transitions: Draft ➔ Reserved ➔ Completed or Cancelled.",
        "Atomic transaction locks: reserving a dispatch locks all internal bundles.",
        "Audit-logged timelines: every state transition appends an immutable trail."
      ],
      preview: `// Dispatch Reservation Lock
await tx.update(bundles)
  .set({ status: "reserved", currentDispatchId: dispatchId })
  .where(and(
    eq(bundles.companyId, ctx.companyId),
    eq(bundles.status, "available"),
    inArray(bundles.id, bundleIds)
  ));`
    },
    printing: {
      title: "LAN orrn-spool Integration",
      badge: "M10 Scheduled",
      icon: Printer,
      description: "Delegate label printing requests from Cloudflare Workers to on-premise local networks using cryptographic webhooks.",
      bullets: [
        "Cryptographically signed webhooks to authenticate local printer endpoints.",
        "Decoupled queues: Hono server creates queue rows without waiting for printer IO.",
        "Print telemetry logs: track and audit queue success/fail metrics instantly."
      ],
      preview: `// Webhook Signature Verification
const signature = c.req.header("x-orrn-spool-signature");
const isValid = await verifySpoolWebhook(
  JSON.stringify(payload),
  signature,
  ctx.company.secretKey
);`
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 py-8 md:px-8">
      {/* Background Gradient Mesh */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[15%] top-[-10%] h-[600px] w-[600px] rounded-full bg-gradient-to-tr from-[#5b6cff]/10 to-[#22d3ee]/5 blur-[120px]" />
        <div className="absolute right-[5%] top-[20%] h-[500px] w-[500px] rounded-full bg-gradient-to-br from-[#22d3ee]/8 to-[#3b4edd]/10 blur-[100px]" />
      </div>

      <div className="mx-auto max-w-6xl space-y-16">
        {/* Navigation Header */}
        <header className="flex items-center justify-between border-b pb-6 border-border/40">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent shadow-md">
              <span className="text-xl font-bold text-white">O</span>
            </div>
            <span className="text-2xl font-black tracking-tight bg-gradient-to-r from-foreground via-foreground to-muted-foreground bg-clip-text text-transparent">
              ORRN
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login">
              <Button variant="ghost" className="hover:bg-muted/80">Sign In</Button>
            </Link>
            <Link to="/waitlist">
              <Button className="bg-gradient-to-r from-primary to-primaryStrong text-primary-foreground shadow-lg hover:shadow-primary/20">
                Join Waitlist
              </Button>
            </Link>
          </div>
        </header>

        {/* Hero Section */}
        <section className="relative flex flex-col items-center text-center space-y-6 pt-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary backdrop-blur-md">
            <ShieldCheck className="h-3.5 w-3.5 text-accent" />
            <span>Multi-Company ERP SaaS Foundation</span>
          </div>
          
          <h1 className="max-w-4xl text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl md:text-6xl">
            Manufacturing Operations,{" "}
            <span className="bg-gradient-to-r from-primary via-indigo-400 to-accent bg-clip-text text-transparent">
              Simplified.
            </span>
          </h1>
          
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground md:text-xl">
            The high-performance, multi-tenant inventory console built to orchestrate extruded dies,
            bundles, barcodes, dispatches, and local spool printers.
          </p>

          <div className="flex flex-wrap justify-center gap-4 pt-4">
            <Link to="/waitlist">
              <Button size="lg" className="h-12 px-8 bg-gradient-to-r from-primary to-primaryStrong font-medium shadow-xl hover:shadow-primary/30 hover:scale-[1.02] transition-all">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link to="/login">
              <Button size="lg" variant="outline" className="h-12 px-8 border-border hover:bg-muted/50 hover:scale-[1.02] transition-all">
                Tenant Portal
              </Button>
            </Link>
          </div>
        </section>

        {/* Interactive Feature & Code Showcase */}
        <section className="space-y-6">
          <div className="flex flex-col items-center text-center space-y-2">
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Engineered for Technical Control</h2>
            <p className="text-muted-foreground">Select a module below to inspect the design specification and API capabilities.</p>
          </div>

          <div className="grid gap-8 lg:grid-cols-12">
            {/* Left Column: Tab Selectors */}
            <div className="flex flex-row overflow-x-auto gap-2 pb-2 lg:flex-col lg:col-span-5 lg:pb-0">
              {(Object.keys(tabsConfig) as Array<keyof typeof tabsConfig>).map((key) => {
                const config = tabsConfig[key];
                const Icon = config.icon;
                const isSelected = activeTab === key;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`flex items-center gap-4 rounded-xl p-4 text-left border transition-all duration-200 shrink-0 lg:shrink ${
                      isSelected
                        ? "bg-card border-primary/40 shadow-md ring-1 ring-primary/20"
                        : "bg-transparent border-transparent hover:bg-muted/40 hover:border-border/30"
                    }`}
                  >
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground text-sm">{config.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          isSelected ? "bg-accent/15 text-accent-foreground dark:text-accent" : "bg-muted/80 text-muted-foreground"
                        }`}>{config.badge}</span>
                      </div>
                      <p className="line-clamp-1 text-xs text-muted-foreground mt-0.5">
                        {config.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Right Column: Dynamic Preview Container */}
            <div className="lg:col-span-7">
              <Card className="h-full border-border/60 bg-card/60 backdrop-blur-md shadow-2xl overflow-hidden flex flex-col">
                <CardHeader className="border-b border-border/40 pb-4 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-4 w-4 text-primary" />
                      <span className="font-mono text-xs text-muted-foreground">system_specification.ts</span>
                    </div>
                    <div className="flex gap-1.5">
                      <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
                      <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" />
                      <div className="h-2.5 w-2.5 rounded-full bg-green-500/80" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-6 flex-1 flex flex-col justify-between">
                  <div className="space-y-4">
                    <h3 className="text-xl font-bold text-foreground flex items-center gap-2">
                      {tabsConfig[activeTab].title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {tabsConfig[activeTab].description}
                    </p>
                    <ul className="space-y-2.5 text-xs text-foreground">
                      {tabsConfig[activeTab].bullets.map((bullet, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-6 rounded-lg bg-[#05070c] border border-border/20 p-4 overflow-x-auto font-mono text-xs text-indigo-300">
                    <pre><code>{tabsConfig[activeTab].preview}</code></pre>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Global Security / Multi-Tenant Isolation Info */}
        <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="bg-card/50 border-border/40 hover:border-primary/20 transition-colors">
            <CardHeader className="pb-2">
              <Globe className="h-6 w-6 text-primary mb-2" />
              <CardTitle className="text-base">Tenant Isolation</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground leading-relaxed">
              Every data node is strictly isolated. Identifiers are resolved exclusively on the Cloudflare server context, never accepted directly from API inputs.
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border/40 hover:border-primary/20 transition-colors">
            <CardHeader className="pb-2">
              <Database className="h-6 w-6 text-accent mb-2" />
              <CardTitle className="text-base">Offline Sync Engine</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground leading-relaxed">
              Mobile operations support local SQLite databases for continuous work in poor connectivity. Mutations are queue-batched and synced dynamically.
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border/40 hover:border-primary/20 transition-colors">
            <CardHeader className="pb-2">
              <Code className="h-6 w-6 text-primary mb-2" />
              <CardTitle className="text-base">Type-Safe Bridges</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground leading-relaxed">
              Vite, Expo Router, and Cloudflare Worker communicate via tRPC. Any schema modification yields instant compiler warnings across platforms.
            </CardContent>
          </Card>
        </section>

        {/* System Monitor Status */}
        <footer className="flex flex-col items-center justify-between border-t border-border/30 pt-8 pb-12 gap-4 sm:flex-row text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${healthCheck.data ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
            <span>API Worker Server: {healthCheck.isLoading ? "Monitoring connection..." : healthCheck.data ? "Operational" : "Unavailable"}</span>
          </div>
          <div className="flex items-center gap-6">
            <span>&copy; {new Date().getFullYear()} ORRN Operations. All rights reserved.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}