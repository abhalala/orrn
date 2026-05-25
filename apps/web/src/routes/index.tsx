import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Layers,
  Box,
  Truck,
  Printer,
  Factory,
  CheckCircle2,
  Activity,
  Globe,
  Database,
  Shield,
  Zap,
  ArrowRight,
  ChevronRight,
  Monitor,
  Cpu
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
      title: "Extrusion Die Tooling Catalog",
      badge: "ORRN-AL Module",
      icon: Layers,
      description: "Establish a single source of truth for your extrusion die library. Record alloy criteria, theoretical weights, and perimeter profiles to avoid tooling mismatches.",
      bullets: [
        "Track shape codes, aperture configurations, and tooling tolerances.",
        "Store metallurgy specifications (alloy types, heat treatment, temper).",
        "Automated billing/cost computations based on theoretical weights per meter."
      ],
      preview: (
        <div className="space-y-4 font-sans">
          <div className="flex items-center justify-between border-b pb-2 border-border/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <span>Die Reference</span>
            <span>Profile Spec</span>
            <span>Alloy / Temp</span>
            <span>Weight (kg/m)</span>
          </div>
          <div className="divide-y divide-border/20">
            <div className="flex justify-between py-2.5 text-sm">
              <span className="font-mono font-medium text-primary">D-9812-H</span>
              <span className="text-foreground">H-Channel Extrusion</span>
              <span className="text-muted-foreground">6063-T6 Aluminum</span>
              <span className="font-mono text-foreground">1.842</span>
            </div>
            <div className="flex justify-between py-2.5 text-sm">
              <span className="font-mono font-medium text-primary">D-0441-A</span>
              <span className="text-foreground">Angle Profile 40x40</span>
              <span className="text-muted-foreground">6082-T6 Aluminum</span>
              <span className="font-mono text-foreground">0.825</span>
            </div>
            <div className="flex justify-between py-2.5 text-sm">
              <span className="font-mono font-medium text-primary">D-1192-T</span>
              <span className="text-foreground">T-Slot Industrial Rail</span>
              <span className="text-muted-foreground">6005A-T61 Aluminum</span>
              <span className="font-mono text-foreground">2.410</span>
            </div>
          </div>
        </div>
      )
    },
    bundles: {
      title: "Production Receipts & Inventory",
      badge: "ORRN-AL Module",
      icon: Box,
      description: "Generate tracking receipts directly at the extrusion press. Log structural output and auto-generate barcoded bundles for stockyard allocation.",
      bullets: [
        "Construct unique, trackable bundle groups containing exact piece counts and lengths.",
        "Enforce strict available ➔ reserved status flows for clear inventory visibility.",
        "Aggregated stock metrics: instantly monitor available tonnage by die code."
      ],
      preview: (
        <div className="space-y-3 font-sans">
          <div className="rounded-lg border border-border/40 bg-muted/20 p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-mono text-muted-foreground uppercase">Production Batch</span>
                <h4 className="text-base font-bold text-foreground font-mono">BG-002149</h4>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-500">
                In Stock
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs border-t border-border/20 pt-3">
              <div>
                <span className="text-muted-foreground block">Die Profile</span>
                <span className="font-semibold text-foreground font-mono">D-9812-H</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Total Bundles</span>
                <span className="font-semibold text-foreground">8 Bundles</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Tonnage</span>
                <span className="font-semibold text-foreground font-mono">3.41 Tons</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between px-3 text-xs text-muted-foreground font-mono">
            <span>BG-002149-B001</span>
            <span>12 Pcs @ 6.0m</span>
            <span className="text-primary font-bold">132.6 kg</span>
          </div>
        </div>
      )
    },
    dispatches: {
      title: "Outbound Logistics & Dispatches",
      badge: "ORRN-AL Module",
      icon: Truck,
      description: "Stage customer shipments with confidence. Automate packing lists and enforce transactional safeguards to prevent logistics errors.",
      bullets: [
        "Prevent shipment overlaps: double booking is dynamically locked out.",
        "Client-side exports: generate A4-ready PDF and Excel packing lists directly from snapshots.",
        "Activity audit timeline: see exactly who approved, reserved, or cancelled dispatches."
      ],
      preview: (
        <div className="space-y-3 font-sans">
          <div className="flex items-center justify-between border border-border/40 bg-muted/10 p-3 rounded-lg">
            <div>
              <span className="text-xs text-muted-foreground font-mono">DSP-000492</span>
              <h5 className="text-sm font-bold text-foreground">Alu-Tech Fabrication Ltd</h5>
            </div>
            <div className="text-right">
              <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-500">
                Reserved
              </span>
              <span className="block text-[10px] text-muted-foreground mt-1">Ship Date: May 28</span>
            </div>
          </div>
          <div className="text-xs border-t border-border/20 pt-2 space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Staged Tooling:</span>
              <span className="text-foreground">D-9812-H (4 Bundles)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Staged Weight:</span>
              <span className="text-foreground font-mono">1,120.4 kg</span>
            </div>
          </div>
        </div>
      )
    },
    printing: {
      title: "orrn-spool LAN Printing",
      badge: "Suite Feature",
      icon: Printer,
      description: "Send instant barcode label requests from your Cloud Workers directly to thermal zebra printers on your plant floor without VPN setups.",
      bullets: [
        "Cryptographically signed payload handshakes secure printer endpoints.",
        "Asynchronous printer spooling prevents latency delays for floor operators.",
        "Historical logs: view telemetry status and print attempt metrics."
      ],
      preview: (
        <div className="space-y-3 font-sans">
          <div className="rounded-lg border border-border/40 bg-[#05070c] p-4 text-xs font-mono">
            <div className="flex items-center justify-between text-muted-foreground border-b border-border/20 pb-2">
              <span>Spool Queue Log</span>
              <span className="text-emerald-500 animate-pulse flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Spool Active
              </span>
            </div>
            <div className="space-y-1.5 pt-2">
              <div className="flex justify-between text-indigo-300">
                <span>[10:41:02] Pushed Spool Print Job</span>
                <span>JOB #841</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>└─ Printer: Press-01-Zebra</span>
                <span>OK</span>
              </div>
              <div className="flex justify-between text-indigo-300">
                <span>[10:41:05] Webhook Verified</span>
                <span>SIGN_OK</span>
              </div>
            </div>
          </div>
        </div>
      )
    }
  };

  return (
    <div className="relative min-h-screen px-4 py-8 md:px-8">

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
              <Button variant="ghost" className="hover:bg-muted/80 text-sm font-medium">Sign In</Button>
            </Link>
            <Link to="/waitlist" search={{ mode: "demo" }}>
              <Button className="bg-gradient-to-r from-primary to-primaryStrong text-primary-foreground shadow-lg hover:shadow-primary/20 text-sm">
                Request Demo
              </Button>
            </Link>
          </div>
        </header>

        {/* Hero Section */}
        <section className="relative flex flex-col items-center text-center space-y-6 pt-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary backdrop-blur-md">
            <Factory className="h-3.5 w-3.5 text-accent animate-pulse" />
            <span>Industrial Manufacturing Cloud Suite</span>
          </div>
          
          <h1 className="max-w-4xl text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl md:text-6xl leading-[1.1]">
            Operating Systems for{" "}
            <span className="bg-gradient-to-r from-primary via-indigo-400 to-accent bg-clip-text text-transparent">
              Modern Manufacturing.
            </span>
          </h1>
          
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground md:text-xl">
            ORRN delivers purpose-built SaaS ERPs to specialized manufacturing facilities, combining 
            multi-tenant isolation, real-time inventory control, and floor-level connectivity.
          </p>

          <div className="flex flex-wrap justify-center gap-4 pt-4">
            <Link to="/waitlist" search={{ mode: "demo" }}>
              <Button size="lg" className="h-12 px-8 bg-gradient-to-r from-primary to-primaryStrong font-medium shadow-xl hover:shadow-primary/30 hover:scale-[1.02] transition-all">
                Request Enterprise Demo
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link to="/waitlist" search={{ mode: "waitlist" }}>
              <Button size="lg" variant="outline" className="h-12 px-8 border-border hover:bg-muted/50 hover:scale-[1.02] transition-all">
                Join Waitlist
              </Button>
            </Link>
          </div>
        </section>

        {/* Dynamic Showcase of ORRN-AL */}
        <section className="space-y-8 rounded-2xl border border-border/40 bg-card/40 p-6 backdrop-blur-md md:p-10 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-border/30 pb-6 gap-4">
            <div className="space-y-1">
              <span className="text-xs font-bold text-accent uppercase tracking-wider">Now Available</span>
              <h2 className="text-3xl font-extrabold tracking-tight">ORRN-AL — Aluminum Extrusion</h2>
              <p className="text-sm text-muted-foreground">The modular ERP tailored specifically for extrusion plants and anodizing facilities.</p>
            </div>
            <div className="flex gap-2">
              <span className="rounded-full bg-primary/10 border border-primary/20 text-primary px-3 py-1 text-xs font-semibold">Tooling Master</span>
              <span className="rounded-full bg-primary/10 border border-primary/20 text-primary px-3 py-1 text-xs font-semibold">Floor Receipts</span>
              <span className="rounded-full bg-primary/10 border border-primary/20 text-primary px-3 py-1 text-xs font-semibold">Tonnage Tracking</span>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-12 pt-4">
            {/* Left Column: Module Switchers */}
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
                        <span className="rounded-full bg-accent/15 text-accent-foreground dark:text-accent px-2 py-0.5 text-[10px] font-medium">
                          {config.badge}
                        </span>
                      </div>
                      <p className="line-clamp-1 text-xs text-muted-foreground mt-0.5">
                        {config.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Right Column: Interactive Mockup Panel */}
            <div className="lg:col-span-7">
              <Card className="h-full border-border/60 bg-[#090e1a]/80 backdrop-blur-md shadow-2xl overflow-hidden flex flex-col min-h-[320px]">
                <CardHeader className="border-b border-border/40 pb-4 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Monitor className="h-4 w-4 text-primary animate-pulse" />
                      <span className="font-mono text-xs text-muted-foreground">ORRN-AL Console // Live Preview</span>
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

                  <div className="mt-6 rounded-lg bg-card border border-border/40 p-4 shadow-inner">
                    {tabsConfig[activeTab].preview}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Future Product Expansion Map */}
        <section className="space-y-6">
          <div className="text-center space-y-2">
            <span className="text-xs font-bold text-primary uppercase tracking-wider">Product Roadmap</span>
            <h3 className="text-2xl font-extrabold tracking-tight">ERPs for the Whole Manufacturing Landscape</h3>
            <p className="text-sm text-muted-foreground max-w-xl mx-auto">
              Our cloud foundation scales horizontally across manufacturing verticals, launching target-specific modules.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="bg-card/40 border-primary/20 hover:scale-[1.01] transition-all relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-primary px-3 py-1 rounded-bl-lg text-[10px] font-bold text-primary-foreground tracking-wider uppercase">
                Active
              </div>
              <CardHeader className="pb-2">
                <Factory className="h-6 w-6 text-primary mb-2" />
                <CardTitle className="text-lg">ORRN-AL</CardTitle>
                <CardDescription>Aluminum Extrusion Suite</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground leading-relaxed">
                Extrusion die specifications, plant floor bundle allocations, theoretical weight cost matrices, and thermal LAN spooling.
              </CardContent>
            </Card>

            <Card className="bg-card/10 border-border/20 opacity-70 hover:opacity-100 transition-opacity">
              <CardHeader className="pb-2">
                <Cpu className="h-6 w-6 text-muted-foreground mb-2" />
                <CardTitle className="text-lg">ORRN-STEEL</CardTitle>
                <CardDescription>Steel Rolling & Fabrication</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground leading-relaxed">
                Heat-number traceability, structural yield analytics, fabrication batch allocations, and rolling mill thickness calibrations.
              </CardContent>
            </Card>

            <Card className="bg-card/10 border-border/20 opacity-70 hover:opacity-100 transition-opacity">
              <CardHeader className="pb-2">
                <Database className="h-6 w-6 text-muted-foreground mb-2" />
                <CardTitle className="text-lg">ORRN-PLAST</CardTitle>
                <CardDescription>Injection Molding & Extrusion</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground leading-relaxed">
                Cavity yield logs, compound material batch blending controls, mold cycle counters, and automated packing carton labels.
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Enterprise Security Core */}
        <section className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 border-t border-border/30 pt-12">
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Shield className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h4 className="font-semibold text-sm">ISO-Grade Isolation</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Strict context security verifies tenant permissions on every database call. Synthetic identifiers are rejected automatically.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Database className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h4 className="font-semibold text-sm">Offline-First Floor Sync</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Floor workers sync press output and logistics receipts offline. State transitions sync automatically upon reconnection.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Zap className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h4 className="font-semibold text-sm">Microsecond Hono API</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Built on Cloudflare Workers edge nodes. Minimal CPU run time guarantees responsive floor interactions even on low-spec devices.
              </p>
            </div>
          </div>
        </section>

        {/* System Monitor & Footer Status */}
        <footer className="flex flex-col items-center justify-between border-t border-border/20 pt-8 pb-12 gap-4 sm:flex-row text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${healthCheck.data ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
            <span>Operational Console Service: {healthCheck.isLoading ? "Acquiring telemetry..." : healthCheck.data ? "Connected" : "Disruptions"}</span>
          </div>
          <div className="flex items-center gap-6">
            <span>&copy; {new Date().getFullYear()} ORRN Suite Inc. All rights reserved.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}