/**
 * Closing CTA band + footer. Keeps the live API health indicator from the
 * previous landing page.
 */
import { Button } from "@orrn/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Building2, Warehouse } from "lucide-react";
import { useRef } from "react";

import { trpc } from "@/shared/utils/trpc";

import { EASE, gsap, useMarketingGsap } from "../use-gsap";

export function CtaSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const healthCheck = useQuery(trpc.healthCheck.queryOptions());

  useMarketingGsap(sectionRef, () => {
    gsap.from("[data-cta-inner]", {
      y: 40,
      opacity: 0,
      scale: 0.98,
      duration: 0.8,
      ease: EASE.outExpo,
      scrollTrigger: { trigger: sectionRef.current, start: "top 80%" },
    });
  });

  return (
    <section ref={sectionRef} className="orrn-section py-24 md:py-32">
      <div
        data-cta-inner
        className="relative overflow-hidden rounded-3xl border border-border px-6 py-16 text-center md:px-12 md:py-24"
        style={{
          background:
            "radial-gradient(ellipse 90% 120% at 50% 120%, color-mix(in srgb, var(--brand-500) 28%, transparent), var(--card) 70%)",
        }}
      >
        <h2 className="orrn-display-2 mx-auto max-w-2xl text-foreground">
          Put your floor on <span className="orrn-gradient-text">ORRN</span>.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
          From die catalog to dispatch dock — one tenant-isolated system your
          operators will actually use.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="orrn-glow gap-2">
            <Link to="/waitlist" search={{ mode: "demo" }}>
              Request Demo <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/login">Sign In</Link>
          </Button>
        </div>
      </div>

      <footer className="mt-16 flex flex-col gap-4 border-t border-border pt-8 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-6 items-center justify-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
            O
          </div>
          <span>ORRN — Manufactured Inventory ERP</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`size-2 rounded-full ${healthCheck.data ? "bg-emerald-500" : "bg-destructive"}`}
            />
            {healthCheck.isLoading
              ? "Checking API…"
              : healthCheck.data
                ? "API connected"
                : "API unavailable"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Building2 size={13} aria-hidden="true" /> Multi-company
          </span>
          <span className="inline-flex items-center gap-1">
            <Warehouse size={13} aria-hidden="true" /> Inventory ops
          </span>
          <Link to="/login" className="text-muted-foreground no-underline hover:text-foreground">
            Sign in
          </Link>
          <Link
            to="/waitlist"
            search={{ mode: "waitlist" }}
            className="text-muted-foreground no-underline hover:text-foreground"
          >
            Waitlist
          </Link>
        </div>
      </footer>
    </section>
  );
}
