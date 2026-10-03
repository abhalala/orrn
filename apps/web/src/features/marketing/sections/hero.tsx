/**
 * Hero (C2): an ink Bricolage headline beside a colour-block composition.
 * Status IS the colour: green available, blue reserved, black dispatched.
 * The composition is clearly labelled demo data. GSAP plays one entrance
 * (rise stagger, then a `pop` on the printed label); nothing loops, and
 * reduced motion shows everything static.
 */
import { Button } from "@orrn/ui/components/button";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Check, Factory, Printer, Truck } from "lucide-react";
import { useRef } from "react";

import { EASE, gsap, useMarketingGsap } from "../use-gsap";

const HEADLINE_LINES = ["Inventory truth", "from press", "to dispatch."];

const BUNDLE_BLOCKS = [
  { serial: "BND-88421", status: "Available", pieces: 48, tone: "green" },
  { serial: "BND-88420", status: "Reserved", pieces: 36, tone: "blue" },
  { serial: "BND-88419", status: "Dispatched", pieces: 60, tone: "neutral" },
] as const;

export function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useMarketingGsap(sectionRef, () => {
    const tl = gsap.timeline({ defaults: { ease: EASE.outExpo } });
    tl.from("[data-hero-badge]", { y: 14, opacity: 0, duration: 0.6 })
      .from("[data-hero-line]", { yPercent: 110, duration: 0.9, stagger: 0.1 }, "-=0.35")
      .from("[data-hero-copy]", { y: 14, opacity: 0, duration: 0.7 }, "-=0.55")
      .from("[data-hero-cta]", { y: 14, opacity: 0, duration: 0.6, stagger: 0.07 }, "-=0.5")
      .from(
        "[data-hero-block]",
        { y: 14, opacity: 0, duration: 0.55, stagger: 0.07, ease: EASE.rise },
        "-=0.6",
      )
      .from(
        "[data-hero-pop]",
        { scale: 0.6, opacity: 0, duration: 0.6, ease: EASE.pop },
        "-=0.15",
      );
  });

  return (
    <section ref={sectionRef} className="relative overflow-hidden">
      <div className="orrn-section grid items-center gap-12 pb-20 pt-28 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:gap-10 md:pb-28 md:pt-36 lg:gap-16">
        {/* ---- Copy column ---- */}
        <div>
          <p
            data-hero-badge
            className="m-0 mb-7 inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-card px-3.5 text-[13px] font-medium text-foreground shadow-sm"
          >
            <Factory size={15} className="text-tone-green-ink" aria-hidden="true" />
            Built for aluminum extrusion operations first
          </p>

          <h1 className="orrn-display-1 m-0 max-w-[12ch] text-foreground">
            {HEADLINE_LINES.map((line) => (
              <span key={line} className="block overflow-hidden pb-[0.06em]">
                <span data-hero-line className="block">
                  {line}
                </span>
              </span>
            ))}
          </h1>

          <p
            data-hero-copy
            className="m-0 mt-6 max-w-xl text-lg leading-8 text-muted-foreground"
          >
            ORRN is the multi-company ERP for dies, bundles, stock, dispatches,
            packing lists, and floor-native print workflows, tenant-isolated by
            design.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <span data-hero-cta className="inline-flex">
              <Button asChild size="lg">
                <Link to="/waitlist" search={{ mode: "demo" }}>
                  Request demo
                </Link>
              </Button>
            </span>
            <span data-hero-cta className="inline-flex">
              <Button asChild size="lg" variant="outline">
                <Link to="/waitlist" search={{ mode: "waitlist" }}>
                  Join waitlist
                </Link>
              </Button>
            </span>
          </div>
        </div>

        {/* ---- Colour-block composition (demo data) ---- */}
        <figure className="m-0" aria-label="Example bundles in orrn, demo data">
          <figcaption className="mb-3 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-control" />
            Demo data
          </figcaption>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.2fr_1fr]">
            {BUNDLE_BLOCKS.map((block, index) => (
              <div
                key={block.serial}
                data-hero-block
                className={cn(
                  "orrn-block flex flex-col justify-between p-4 sm:p-5",
                  `orrn-block-${block.tone}`,
                  index === 0 ? "col-span-2 min-h-[200px] sm:col-span-1 sm:row-span-2 sm:min-h-[296px]" : "min-h-[142px]",
                )}
              >
                <div>
                  <p className="m-0 font-display text-lg font-bold tracking-[-0.02em]">{block.status}</p>
                  <p className="m-0 font-mono text-[13px]">{block.serial}</p>
                </div>
                <p className="m-0 mt-4 flex items-baseline gap-2">
                  <span
                    className={cn(
                      "font-display font-extrabold leading-[0.9] tracking-[-0.045em]",
                      index === 0 ? "text-[72px] sm:text-[88px]" : "text-[44px] sm:text-[52px]",
                    )}
                  >
                    {block.pieces}
                  </span>
                  <span className="text-[13px] font-medium">pieces</span>
                </p>
              </div>
            ))}

            <div
              data-hero-block
              className="col-span-2 grid gap-3 rounded-card border border-border bg-card p-3 shadow-sm sm:grid-cols-2"
            >
              <div className="flex items-center gap-3 rounded-md bg-background p-3">
                <span
                  data-hero-pop
                  aria-hidden="true"
                  className="orrn-block-green flex size-10 shrink-0 items-center justify-center rounded-full"
                >
                  <Check size={20} strokeWidth={3} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">Label printed</span>
                  <span className="flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
                    <Printer size={12} aria-hidden="true" />
                    JOB-5512 · Zebra ZT411
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-3 rounded-md bg-background p-3">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tone-blue-tint text-tone-blue-ink"
                >
                  <Truck size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block font-mono text-sm font-semibold text-foreground">DSP-1204</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    12 bundles, reserved to dispatched
                  </span>
                </span>
              </div>
            </div>
          </div>
        </figure>
      </div>
    </section>
  );
}
