/**
 * Hero: pure GSAP. A staggered headline reveal beside a layered "live
 * operations" card cluster — bundles table with a sweeping scan line, a print
 * job toast, a stock chart, and a dispatch status chip. Cards float idly,
 * tilt with the pointer (desktop), and parallax apart on scroll. No WebGL.
 */
import { Button } from "@orrn/ui/components/button";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Factory, Package, Printer, Truck } from "lucide-react";
import { useRef } from "react";

import { EASE, MQ, gsap, useMarketingGsap } from "../use-gsap";

const HEADLINE_LINES = ["Inventory truth", "from press", "to dispatch."];

const BUNDLE_ROWS = [
  { serial: "BND-88421", status: "Available", pieces: "48 pcs", tone: "ok" },
  { serial: "BND-88420", status: "Reserved", pieces: "36 pcs", tone: "warn" },
  { serial: "BND-88419", status: "Dispatched", pieces: "60 pcs", tone: "muted" },
  { serial: "BND-88418", status: "Available", pieces: "24 pcs", tone: "ok" },
] as const;

const STOCK_BARS = [42, 68, 55, 80, 64, 92, 74] as const;

export function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useMarketingGsap(sectionRef, (mm) => {
    // ---- Entrance: badge → headline lines → copy → CTAs → card cluster ----
    const tl = gsap.timeline({ defaults: { ease: EASE.outExpo } });
    tl.from("[data-hero-badge]", { y: 16, opacity: 0, duration: 0.7 })
      .from(
        "[data-hero-line]",
        { yPercent: 110, opacity: 0, duration: 0.9, stagger: 0.12 },
        "-=0.4",
      )
      .from("[data-hero-copy]", { y: 20, opacity: 0, duration: 0.8 }, "-=0.5")
      .from("[data-hero-cta]", { y: 16, opacity: 0, duration: 0.7, stagger: 0.08 }, "-=0.5")
      .from(
        "[data-hero-card]",
        { y: 64, opacity: 0, rotateX: 8, duration: 1, stagger: 0.14 },
        "-=0.7",
      )
      .from(
        "[data-hero-bar]",
        { scaleY: 0, transformOrigin: "bottom", duration: 0.6, stagger: 0.05, ease: EASE.outQuart },
        "-=0.6",
      )
      .from("[data-hero-row]", { x: 18, opacity: 0, duration: 0.5, stagger: 0.07 }, "-=0.9");

    // ---- Idle: cards float gently at different cadences ----
    gsap.utils.toArray<HTMLElement>("[data-hero-float]").forEach((el, i) => {
      gsap.to(el, {
        y: i % 2 === 0 ? 10 : -12,
        duration: 2.6 + i * 0.5,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
      });
    });

    // ---- Scan line sweeps the bundles table forever ----
    gsap.fromTo(
      "[data-hero-scan]",
      { top: "12%" },
      { top: "94%", duration: 2.8, repeat: -1, yoyo: true, ease: "sine.inOut" },
    );

    // ---- Scroll: content drifts up; cards parallax apart by depth ----
    gsap.to("[data-hero-content]", {
      yPercent: -16,
      opacity: 0.1,
      ease: "none",
      scrollTrigger: {
        trigger: sectionRef.current,
        start: "top top",
        end: "bottom 35%",
        scrub: true,
      },
    });
    gsap.utils.toArray<HTMLElement>("[data-hero-card]").forEach((card) => {
      const depth = Number(card.dataset.depth ?? 1);
      gsap.to(card, {
        yPercent: -22 * depth,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "bottom top",
          scrub: 0.4,
        },
      });
    });

    // ---- Desktop only: pointer tilt on the cluster ----
    mm.add(MQ.desktop, () => {
      const cluster = sectionRef.current?.querySelector<HTMLElement>("[data-hero-cluster]");
      if (!cluster) return;
      gsap.set(cluster, { transformPerspective: 1200 });
      const tiltX = gsap.quickTo(cluster, "rotationX", { duration: 0.8, ease: "power3.out" });
      const tiltY = gsap.quickTo(cluster, "rotationY", { duration: 0.8, ease: "power3.out" });

      function onPointerMove(event: PointerEvent) {
        const nx = (event.clientX / window.innerWidth) * 2 - 1;
        const ny = (event.clientY / window.innerHeight) * 2 - 1;
        tiltY(nx * 7);
        tiltX(-ny * 5);
      }
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      return () => window.removeEventListener("pointermove", onPointerMove);
    });
  });

  return (
    <section
      ref={sectionRef}
      className="relative flex min-h-[100svh] items-center overflow-hidden"
    >
      {/* Backdrop: brand gradient orbs + dot grid, fading into the page. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 75% 55% at 70% 25%, color-mix(in srgb, var(--brand-500) 24%, transparent), transparent 70%), radial-gradient(ellipse 45% 40% at 15% 80%, color-mix(in srgb, var(--brand-accent) 12%, transparent), transparent 70%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "radial-gradient(color-mix(in srgb, var(--foreground) 14%, transparent) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
            maskImage: "radial-gradient(ellipse 70% 60% at 60% 40%, black, transparent 75%)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
      </div>

      <div
        data-hero-content
        className="orrn-section relative z-10 grid items-center gap-14 pb-24 pt-32 md:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] md:pt-36 lg:gap-20"
      >
        {/* ---- Copy column ---- */}
        <div>
          <div
            data-hero-badge
            className="orrn-glass mb-8 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground"
          >
            <Factory size={14} className="text-primary" aria-hidden="true" />
            Built for aluminum extrusion operations first
          </div>

          <h1 className="orrn-display-1 max-w-4xl text-foreground">
            {HEADLINE_LINES.map((line, index) => (
              <span key={line} className="block overflow-hidden">
                <span
                  data-hero-line
                  className={
                    index === HEADLINE_LINES.length - 1 ? "orrn-gradient-text block" : "block"
                  }
                >
                  {line}
                </span>
              </span>
            ))}
          </h1>

          <p
            data-hero-copy
            className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground md:text-xl"
          >
            ORRN is the multi-company ERP for dies, bundles, stock, dispatches,
            packing lists, and floor-native print workflows — tenant-isolated by
            design.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <span data-hero-cta className="inline-flex">
              <Button asChild size="lg" className="orrn-glow gap-2">
                <Link to="/waitlist" search={{ mode: "demo" }}>
                  Request Demo <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </Button>
            </span>
            <span data-hero-cta className="inline-flex">
              <Button asChild size="lg" variant="outline">
                <Link to="/waitlist" search={{ mode: "waitlist" }}>
                  Join Waitlist
                </Link>
              </Button>
            </span>
          </div>
        </div>

        {/* ---- Visual column: layered live-ops cards ---- */}
        <div data-hero-cluster className="relative mx-auto w-full max-w-md md:max-w-none">
          {/* Main bundles table */}
          <div data-hero-card data-depth="1" className="relative">
            <div data-hero-float>
              <div className="orrn-glass relative overflow-hidden rounded-2xl p-5 shadow-xl">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Package size={15} className="text-primary" aria-hidden="true" />
                    Bundles
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--brand-accent)] opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-[var(--brand-accent)]" />
                    </span>
                    Live
                  </span>
                </div>
                <div className="mt-4 space-y-2.5">
                  {BUNDLE_ROWS.map((row) => (
                    <div
                      key={row.serial}
                      data-hero-row
                      className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-4 py-3"
                    >
                      <span className="font-mono text-sm font-medium text-foreground">
                        {row.serial}
                      </span>
                      <span
                        className={
                          row.tone === "ok"
                            ? "rounded-full bg-[color-mix(in_srgb,var(--brand-accent)_18%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--brand-accent)]"
                            : row.tone === "warn"
                              ? "rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary"
                              : "rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                        }
                      >
                        {row.status}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{row.pieces}</span>
                    </div>
                  ))}
                </div>
                {/* Scan line */}
                <div
                  data-hero-scan
                  className="pointer-events-none absolute inset-x-3 top-[12%] h-px"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, var(--brand-accent), transparent)",
                    boxShadow: "0 0 14px 2px color-mix(in srgb, var(--brand-accent) 55%, transparent)",
                  }}
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>

          {/* Print job toast — floats top-right */}
          <div
            data-hero-card
            data-depth="1.8"
            className="absolute -right-4 -top-10 w-56 md:-right-8 md:-top-12"
          >
            <div data-hero-float>
              <div className="orrn-glass rounded-xl p-3.5 shadow-lg">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Printer size={15} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">Label printed</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      JOB-5512 · Zebra ZT411
                    </p>
                  </div>
                  <CheckCircle2
                    size={15}
                    className="ml-auto shrink-0 text-[var(--brand-accent)]"
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Stock chart — floats bottom-left */}
          <div
            data-hero-card
            data-depth="1.4"
            className="absolute -bottom-12 -left-4 w-52 md:-left-10"
          >
            <div data-hero-float>
              <div className="orrn-glass rounded-xl p-4 shadow-lg">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Stock on hand
                </p>
                <p className="mt-1 font-mono text-lg font-semibold text-foreground">12,408 pcs</p>
                <div className="mt-3 flex h-12 items-end gap-1.5">
                  {STOCK_BARS.map((height, i) => (
                    <div
                      key={i}
                      data-hero-bar
                      className="flex-1 rounded-sm bg-primary/70"
                      style={{ height: `${height}%`, opacity: 0.5 + (i / STOCK_BARS.length) * 0.5 }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Dispatch chip — floats mid-right */}
          <div
            data-hero-card
            data-depth="2.2"
            className="absolute -right-2 bottom-6 w-60 md:-right-12"
          >
            <div data-hero-float>
              <div className="orrn-glass rounded-xl p-3.5 shadow-lg">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--brand-accent)_16%,transparent)] text-[var(--brand-accent)]">
                    <Truck size={15} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">DSP-1204</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      12 bundles · Reserved → Dispatched
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll hint */}
      <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-xs text-muted-foreground">
        <span className="block animate-bounce">↓</span>
      </div>
    </section>
  );
}
