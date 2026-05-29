import { Link } from "@tanstack/react-router";
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

import { appUrls } from "@orrn/web-shared/lib/urls";
import { trpc } from "@orrn/web-shared/utils/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Button } from "@orrn/ui/components/button";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const healthCheck = useQuery(trpc.healthCheck.queryOptions());
  const meQuery = useQuery({
    ...trpc.auth.me.queryOptions(),
    retry: false,
  });
  const [activeTab, setActiveTab] = useState<"dies" | "bundles" | "dispatches" | "printing">("dies");

  useEffect(() => {
    if (meQuery.data?.user) {
      window.location.href = `${appUrls.erp}/dashboard`;
    }
  }, [meQuery.data]);

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
          <div className="flex items-center justify-between border-b pb-2.5 border-border/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest font-mono">
            <span>Die Reference</span>
            <span>Profile Spec</span>
            <span>Alloy / Temp</span>
            <span className="text-right">Weight (kg/m)</span>
          </div>
          <div className="divide-y divide-border/10">
            <div className="flex justify-between py-3 text-xs items-center hover:bg-muted/10 px-2 rounded-md transition-colors">
              <span className="font-mono font-bold text-[#5B6CFF]">D-9812-H</span>
              <span className="text-foreground font-medium">H-Channel Extrusion</span>
              <span className="text-muted-foreground">6063-T6 Aluminum</span>
              <span className="font-mono text-foreground font-semibold">1.842</span>
            </div>
            <div className="flex justify-between py-3 text-xs items-center hover:bg-muted/10 px-2 rounded-md transition-colors">
              <span className="font-mono font-bold text-[#5B6CFF]">D-0441-A</span>
              <span className="text-foreground font-medium">Angle Profile 40x40</span>
              <span className="text-muted-foreground">6082-T6 Aluminum</span>
              <span className="font-mono text-foreground font-semibold">0.825</span>
            </div>
            <div className="flex justify-between py-3 text-xs items-center hover:bg-muted/10 px-2 rounded-md transition-colors">
              <span className="font-mono font-bold text-[#5B6CFF]">D-1192-T</span>
              <span className="text-foreground font-medium">T-Slot Industrial Rail</span>
              <span className="text-muted-foreground">6005A-T61 Aluminum</span>
              <span className="font-mono text-foreground font-semibold">2.410</span>
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
        <div className="space-y-4 font-sans">
          <div className="relative overflow-hidden rounded-xl border border-border/40 bg-[#121826]/80 p-4 shadow-lg">
            {/* Hologram Scanner Laser Line Effect */}
            <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-[#22D3EE] shadow-[0_0_10px_#22D3EE] animate-[bounce_3s_infinite]" />
            
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Production Batch</span>
                <h4 className="text-sm font-bold text-[#f5f7ff] font-mono">BG-002149</h4>
              </div>
              <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400 font-mono">
                IN STOCK
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-xs border-t border-border/10 pt-3">
              <div>
                <span className="text-muted-foreground block text-[10px]">Die Profile</span>
                <span className="font-bold text-[#f5f7ff] font-mono">D-9812-H</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Total Bundles</span>
                <span className="font-bold text-[#f5f7ff]">8 Bundles</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px]">Tonnage</span>
                <span className="font-bold text-[#22D3EE] font-mono">3.41 Tons</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between px-3 py-2 bg-muted/20 rounded-lg text-xs text-muted-foreground font-mono">
            <span>BG-002149-B001</span>
            <span>12 Pcs @ 6.0m</span>
            <span className="text-[#5B6CFF] font-bold">132.6 kg</span>
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
        <div className="space-y-4 font-sans">
          <div className="flex items-center justify-between border border-border/40 bg-[#121826]/80 p-4 rounded-xl shadow-lg">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">Dispatch Code</span>
                <span className="font-mono text-xs font-bold text-[#f5f7ff]">DSP-000492</span>
              </div>
              <h5 className="text-sm font-bold text-foreground">Alu-Tech Fabrication Ltd</h5>
            </div>
            <div className="text-right">
              <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[10px] font-bold text-amber-400 font-mono">
                RESERVED
              </span>
              <span className="block text-[10px] text-muted-foreground mt-1.5 font-mono">Ship Date: May 28</span>
            </div>
          </div>
          <div className="text-xs bg-muted/10 border border-border/20 p-3 rounded-lg space-y-2">
            <div className="flex justify-between border-b border-border/10 pb-1.5">
              <span className="text-muted-foreground">Staged Tooling:</span>
              <span className="text-foreground font-semibold font-mono">D-9812-H (4 Bundles)</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Total Staged Weight:</span>
              <span className="text-[#5B6CFF] font-bold font-mono">1,120.4 kg</span>
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
          <div className="rounded-xl border border-border/40 bg-[#05070c] p-4 text-[11px] font-mono shadow-inner relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-[#22D3EE]/10 text-[#22D3EE] text-[9px] font-bold font-mono px-2 py-0.5 rounded-bl border-l border-b border-border/30">
              LAN SPOOLER
            </div>
            <div className="flex items-center justify-between text-muted-foreground border-b border-border/10 pb-2">
              <span>Spool Queue Log</span>
              <span className="text-emerald-400 animate-pulse flex items-center gap-1.5 font-bold">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                ACTIVE
              </span>
            </div>
            <div className="space-y-2 pt-2.5">
              <div className="flex justify-between text-[#8f9dff]">
                <span>[10:41:02] Pushed Spool Print Job</span>
                <span className="font-bold">JOB #841</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>└─ Printer: Press-01-Zebra</span>
                <span className="text-emerald-400 font-semibold">OK</span>
              </div>
              <div className="flex justify-between text-[#8f9dff]">
                <span>[10:41:05] Webhook Verified</span>
                <span className="text-emerald-400 font-semibold">SIGN_OK</span>
              </div>
            </div>
          </div>
        </div>
      )
    }
  };

  return (
    <div className="relative min-h-screen px-4 py-8 md:px-8 bg-[#0b0f1a]">
      {/* Mesh gradients for modern look */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-[0.18] pointer-events-none -z-10" />
      <div className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] bg-gradient-to-r from-[#5B6CFF]/15 to-[#22D3EE]/5 rounded-full blur-[100px] pointer-events-none -z-10 animate-pulse duration-[8000ms]" />
      
      <div className="mx-auto max-w-6xl space-y-16">
        {/* Navigation Header */}
        <header className="flex items-center justify-between border-b pb-6 border-border/10">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B6CFF] to-[#22D3EE] shadow-md shadow-[#5B6CFF]/20 border border-white/5">
              <span className="text-2xl font-black text-white font-mono">O</span>
            </div>
            <div>
              <span className="text-2xl font-black tracking-widest text-[#f5f7ff] font-mono">
                ORRN
              </span>
              <span className="block text-[8px] font-mono tracking-[0.3em] text-[#22D3EE] uppercase font-bold">
                Enterprise SaaS
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login">
              <Button variant="ghost" className="hover:bg-muted/40 text-sm font-semibold font-mono text-muted-foreground hover:text-[#f5f7ff]">
                Sign In
              </Button>
            </Link>
            <Link to="/waitlist" search={{ mode: "demo" }}>
              <Button className="bg-[#5B6CFF] hover:bg-[#3b4edd] text-white shadow-lg shadow-[#5B6CFF]/20 text-sm font-bold border border-white/10 hover:scale-105 transition-transform duration-300">
                Request Demo
              </Button>
            </Link>
          </div>
        </header>

        {/* Hero Section */}
        <section className="relative flex flex-col items-center text-center space-y-6 pt-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#5B6CFF]/20 bg-[#5B6CFF]/5 px-4.5 py-1.5 text-xs font-semibold text-[#5b6cff] backdrop-blur-md font-mono tracking-wide">
            <Factory className="h-3.5 w-3.5 text-[#22D3EE] animate-pulse" />
            <span>Industrial Manufacturing Cloud Suite</span>
          </div>
          
          <h1 className="max-w-4xl text-4xl font-extrabold tracking-tight text-[#f5f7ff] sm:text-5xl md:text-6xl leading-[1.08] font-mono">
            Operating Systems for{" "}
            <span className="bg-gradient-to-r from-[#5B6CFF] via-indigo-400 to-[#22D3EE] bg-clip-text text-transparent">
              Modern Manufacturing.
            </span>
          </h1>
          
          <p className="mx-auto max-w-2xl text-base text-muted-foreground md:text-lg leading-relaxed">
            ORRN delivers purpose-built SaaS ERPs to specialized manufacturing facilities, combining 
            multi-tenant isolation, real-time inventory control, and floor-level connectivity.
          </p>

          <div className="flex flex-wrap justify-center gap-4 pt-6">
            <Link to="/waitlist" search={{ mode: "demo" }}>
              <Button size="lg" className="h-12 px-8 bg-[#5B6CFF] hover:bg-[#3b4edd] text-white font-bold shadow-xl shadow-[#5B6CFF]/20 hover:scale-[1.03] transition-all duration-300 border border-white/10">
                Request Enterprise Demo
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link to="/waitlist" search={{ mode: "waitlist" }}>
              <Button size="lg" variant="outline" className="h-12 px-8 border-border/60 hover:bg-muted/30 hover:scale-[1.03] transition-all duration-300 font-semibold text-[#f5f7ff]">
                Join Waitlist
              </Button>
            </Link>
          </div>
        </section>

        {/* Dynamic Showcase of ORRN-AL */}
        <section className="space-y-8 rounded-2xl border border-border/10 bg-[#121826]/40 p-6 backdrop-blur-xl md:p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-1/4 w-[300px] h-[300px] bg-[#22D3EE]/5 rounded-full blur-[80px] pointer-events-none -z-10" />
          
          <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-border/10 pb-6 gap-4">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[#22D3EE] uppercase tracking-[0.2em] font-mono">Now Available</span>
              <h2 className="text-3xl font-extrabold tracking-tight text-[#f5f7ff] font-mono">ORRN-AL — Aluminum Extrusion</h2>
              <p className="text-sm text-muted-foreground">The modular ERP tailored specifically for extrusion plants and anodizing facilities.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-[#5B6CFF]/10 border border-[#5B6CFF]/25 text-[#bdc2ff] px-3.5 py-1 text-xs font-bold font-mono">Tooling Master</span>
              <span className="rounded-full bg-[#5B6CFF]/10 border border-[#5B6CFF]/25 text-[#bdc2ff] px-3.5 py-1 text-xs font-bold font-mono">Floor Receipts</span>
              <span className="rounded-full bg-[#5B6CFF]/10 border border-[#5B6CFF]/25 text-[#bdc2ff] px-3.5 py-1 text-xs font-bold font-mono">Tonnage Tracking</span>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-12 pt-4">
            {/* Left Column: Module Switchers */}
            <div className="flex flex-row overflow-x-auto gap-2.5 pb-2 lg:flex-col lg:col-span-5 lg:pb-0">
              {(Object.keys(tabsConfig) as Array<keyof typeof tabsConfig>).map((key) => {
                const config = tabsConfig[key];
                const Icon = config.icon;
                const isSelected = activeTab === key;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`flex items-center gap-4 rounded-xl p-4 text-left border transition-all duration-300 shrink-0 lg:shrink ${
                      isSelected
                        ? "bg-[#121826]/90 border-[#5B6CFF]/40 shadow-lg shadow-[#5B6CFF]/5 ring-1 ring-[#5B6CFF]/20"
                        : "bg-transparent border-transparent hover:bg-[#121826]/30 hover:border-border/10"
                    }`}
                  >
                    <div className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors duration-300 ${
                      isSelected ? "bg-[#5B6CFF]/10 text-[#5B6CFF]" : "bg-muted/40 text-muted-foreground"
                    }`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#f5f7ff] text-sm font-mono">{config.title}</span>
                        <span className="rounded-full bg-[#22D3EE]/15 text-[#22D3EE] px-2 py-0.5 text-[9px] font-bold font-mono">
                          {config.badge}
                        </span>
                      </div>
                      <p className="line-clamp-1 text-xs text-muted-foreground mt-1">
                        {config.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Right Column: Interactive Mockup Panel */}
            <div className="lg:col-span-7">
              <Card className="h-full border-border/10 bg-[#090e1a]/85 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col min-h-[340px] rounded-2xl relative">
                {/* Thin top gradient light reflection */}
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#5B6CFF]/30 to-transparent" />
                <CardHeader className="border-b border-border/10 pb-4 bg-muted/10 px-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Monitor className="h-4 w-4 text-[#5B6CFF] animate-pulse" />
                      <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest font-bold">ORRN-AL Console // Live Preview</span>
                    </div>
                    <div className="flex gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
                      <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" />
                      <div className="h-2.5 w-2.5 rounded-full bg-green-500/80" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-6 flex-1 flex flex-col justify-between">
                  <div className="space-y-4">
                    <h3 className="text-xl font-bold text-[#f5f7ff] flex items-center gap-2 font-mono">
                      {tabsConfig[activeTab].title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {tabsConfig[activeTab].description}
                    </p>
                    <ul className="space-y-2.5 text-xs text-[#f5f7ff]">
                      {tabsConfig[activeTab].bullets.map((bullet, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#5B6CFF] mt-0.5" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-6 rounded-xl bg-[#121826]/50 border border-border/10 p-4 shadow-inner">
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
            <span className="text-[10px] font-bold text-[#5B6CFF] uppercase tracking-[0.20em] font-mono">Product Roadmap</span>
            <h3 className="text-2xl font-extrabold tracking-tight text-[#f5f7ff] font-mono">ERPs for the Whole Manufacturing Landscape</h3>
            <p className="text-sm text-muted-foreground max-w-xl mx-auto">
              Our cloud foundation scales horizontally across manufacturing verticals, launching target-specific modules.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="bg-[#121826]/40 border-[#5B6CFF]/20 hover:scale-[1.02] transition-transform duration-300 relative overflow-hidden rounded-2xl shadow-xl">
              <div className="absolute top-0 right-0 bg-[#5B6CFF] px-3.5 py-1 rounded-bl-xl text-[9px] font-black text-white tracking-widest uppercase font-mono border-l border-b border-white/10">
                ACTIVE
              </div>
              <CardHeader className="pb-2 px-5 pt-5">
                <Factory className="h-7 w-7 text-[#5B6CFF] mb-2" />
                <CardTitle className="text-lg text-[#f5f7ff] font-mono font-bold">ORRN-AL</CardTitle>
                <CardDescription className="text-[#22D3EE] font-mono text-[10px] font-semibold tracking-wider">Aluminum Extrusion Suite</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground leading-relaxed px-5 pb-5">
                Extrusion die specifications, plant floor bundle allocations, theoretical weight cost matrices, and thermal LAN spooling.
              </CardContent>
            </Card>

            <Card className="bg-[#121826]/10 border-border/15 opacity-70 hover:opacity-100 hover:scale-[1.02] transition-all duration-300 rounded-2xl shadow-lg">
              <CardHeader className="pb-2 px-5 pt-5">
                <Cpu className="h-7 w-7 text-muted-foreground mb-2" />
                <CardTitle className="text-lg text-muted-foreground font-mono font-bold">ORRN-STEEL</CardTitle>
                <CardDescription className="text-muted-foreground font-mono text-[10px] font-semibold tracking-wider">Steel Rolling & Fabrication</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground leading-relaxed px-5 pb-5">
                Heat-number traceability, structural yield analytics, fabrication batch allocations, and rolling mill thickness calibrations.
              </CardContent>
            </Card>

            <Card className="bg-[#121826]/10 border-border/15 opacity-70 hover:opacity-100 hover:scale-[1.02] transition-all duration-300 rounded-2xl shadow-lg">
              <CardHeader className="pb-2 px-5 pt-5">
                <Database className="h-7 w-7 text-muted-foreground mb-2" />
                <CardTitle className="text-lg text-muted-foreground font-mono font-bold">ORRN-PLAST</CardTitle>
                <CardDescription className="text-muted-foreground font-mono text-[10px] font-semibold tracking-wider">Injection Molding & Extrusion</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground leading-relaxed px-5 pb-5">
                Cavity yield logs, compound material batch blending controls, mold cycle counters, and automated packing carton labels.
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Enterprise Security Core */}
        <section className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 border-t border-border/10 pt-12">
          <div className="flex gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#5B6CFF]/10 text-[#5B6CFF] border border-[#5B6CFF]/15">
              <Shield className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h4 className="font-bold text-sm text-[#f5f7ff] font-mono">ISO-Grade Isolation</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Strict context security verifies tenant permissions on every database call. Synthetic identifiers are rejected automatically.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#5B6CFF]/10 text-[#5B6CFF] border border-[#5B6CFF]/15">
              <Database className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h4 className="font-bold text-sm text-[#f5f7ff] font-mono">Offline-First Floor Sync</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Floor workers sync press output and logistics receipts offline. State transitions sync automatically upon reconnection.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#5B6CFF]/10 text-[#5B6CFF] border border-[#5B6CFF]/15">
              <Zap className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h4 className="font-bold text-sm text-[#f5f7ff] font-mono">Microsecond Hono API</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Built on Cloudflare Workers edge nodes. Minimal CPU run time guarantees responsive floor interactions even on low-spec devices.
              </p>
            </div>
          </div>
        </section>

        {/* System Monitor & Footer Status */}
        <footer className="flex flex-col items-center justify-between border-t border-border/10 pt-8 pb-12 gap-4 sm:flex-row text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${healthCheck.data ? "bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" : "bg-red-500"}`} />
            <span className="font-mono text-[10px]">Operational Console Service: {healthCheck.isLoading ? "Acquiring telemetry..." : healthCheck.data ? "Connected" : "Disruptions"}</span>
          </div>
          <div className="flex items-center gap-6 font-mono text-[10px]">
            <span>&copy; {new Date().getFullYear()} ORRN Suite Inc. All rights reserved.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}