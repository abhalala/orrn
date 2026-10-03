/**
 * Tenant-first / security section: plain facts in a quiet card. The three
 * product facts are listed in normal type (they describe how the system is
 * built, they are not headline metrics).
 */
import { Check, Shield } from "lucide-react";
import { useRef } from "react";

import { EASE, gsap, useMarketingGsap } from "../use-gsap";

const FACTS = [
  "Tenant scope is derived from session context, never from client input.",
  "Native sync mirrors tenant-local floor workflows, offline-first.",
  "Platform staff support flows are permission-gated, time-boxed, and audited.",
  "Impersonation is web-only, bannered, and revocable at any time.",
] as const;

const STATS = [
  { value: "100%", label: "of queries tenant-scoped" },
  { value: "5", label: "company roles, one capability matrix" },
  { value: "0", label: "cross-tenant assumptions in product flow" },
] as const;

export function TenantFirstSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useMarketingGsap(sectionRef, () => {
    gsap.from("[data-tenant-fact]", {
      y: 14,
      opacity: 0,
      duration: 0.55,
      stagger: 0.07,
      ease: EASE.outExpo,
      scrollTrigger: { trigger: "[data-tenant-facts]", start: "top 80%" },
    });
  });

  return (
    <section ref={sectionRef} id="tenant-first" className="border-y border-border bg-card py-24 md:py-32">
      <div className="orrn-section grid gap-14 md:grid-cols-2 md:items-start">
        <div className="space-y-5">
          <p className="m-0 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Shield size={16} className="text-tone-green-ink" aria-hidden="true" />
            Tenant-first by design
          </p>
          <h2 className="orrn-display-2 m-0 text-foreground">Your data never shares a lane.</h2>
          <p className="m-0 pt-1 text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
            ORRN keeps company context server-owned, hides unavailable actions
            before users hit them, and keeps platform support strictly separate
            from normal tenant work.
          </p>

          <ul className="m-0 list-none space-y-2 p-0 pt-3">
            {STATS.map((stat) => (
              <li key={stat.label} className="flex items-baseline gap-2 text-[15px] text-muted-foreground">
                <span className="min-w-[5ch] font-mono text-sm font-semibold text-foreground">{stat.value}</span>
                {stat.label}
              </li>
            ))}
          </ul>
        </div>

        <ul
          data-tenant-facts
          className="m-0 list-none space-y-2 rounded-hero border border-border bg-background p-2.5 shadow-sm"
        >
          {FACTS.map((fact) => (
            <li
              key={fact}
              data-tenant-fact
              className="flex gap-3.5 rounded-card bg-card px-4 py-4 text-[15px] leading-6 text-foreground"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-tone-green-tint text-tone-green-ink"
              >
                <Check size={14} strokeWidth={3} />
              </span>
              <span>{fact}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
