/**
 * Closing CTA (an ink hero block) + footer. Keeps the live API health
 * indicator from the previous landing page.
 */
import { Button } from "@orrn/ui/components/button";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, Warehouse } from "lucide-react";
import { useRef } from "react";

import { trpc } from "@/shared/utils/trpc";

import { EASE, gsap, useMarketingGsap } from "../use-gsap";

const TONE_TILES = ["green", "blue", "amber", "red"] as const;

export function CtaSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const healthCheck = useQuery(trpc.healthCheck.queryOptions());

  useMarketingGsap(sectionRef, () => {
    gsap.from("[data-cta-inner]", {
      y: 14,
      opacity: 0,
      duration: 0.6,
      ease: EASE.outExpo,
      scrollTrigger: { trigger: sectionRef.current, start: "top 80%" },
    });
    gsap.from("[data-cta-tile]", {
      scale: 0.6,
      opacity: 0,
      duration: 0.55,
      stagger: 0.07,
      ease: EASE.pop,
      scrollTrigger: { trigger: sectionRef.current, start: "top 75%" },
    });
  });

  return (
    <section ref={sectionRef} className="orrn-section py-24 md:py-32">
      <div
        data-cta-inner
        className="orrn-block orrn-block-neutral orrn-block-hero orrn-ink-panel relative px-6 py-14 text-center md:px-12 md:py-20"
      >
        <div aria-hidden="true" className="mb-8 flex justify-center gap-2">
          {TONE_TILES.map((tone) => (
            <span key={tone} data-cta-tile className={cn("size-6 rounded-md", `orrn-block-${tone}`)} />
          ))}
        </div>
        <h2 className="orrn-display-2 mx-auto m-0 max-w-2xl text-tone-neutral-on">Put your floor on ORRN.</h2>
        <p className="mx-auto m-0 mt-5 max-w-xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
          From die catalog to dispatch dock: one tenant-isolated system your
          operators will actually use.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/waitlist" search={{ mode: "demo" }}>
              Request demo
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </div>

      <footer className="mt-16 flex flex-col gap-5 border-t border-border pt-8 text-[13px] text-muted-foreground md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="orrn-mark size-6" />
          <span>
            <span className="font-display text-base font-extrabold tracking-[-0.03em] text-foreground">orrn</span>
            <span className="ml-2">Manufactured inventory ERP</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <span className="inline-flex items-center gap-1.5" aria-live="polite">
            <span
              aria-hidden="true"
              className={cn("size-2 rounded-full", healthCheck.data ? "bg-tone-green" : "bg-tone-red")}
            />
            {healthCheck.isLoading
              ? "Checking API…"
              : healthCheck.data
                ? "API connected"
                : "API unavailable"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Building2 size={14} aria-hidden="true" /> Multi-company
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Warehouse size={14} aria-hidden="true" /> Inventory ops
          </span>
          <Link
            to="/login"
            className="font-medium text-foreground underline decoration-control underline-offset-4 hover:decoration-foreground"
          >
            Sign in
          </Link>
          <Link
            to="/waitlist"
            search={{ mode: "waitlist" }}
            className="font-medium text-foreground underline decoration-control underline-offset-4 hover:decoration-foreground"
          >
            Waitlist
          </Link>
        </div>
      </footer>
    </section>
  );
}
