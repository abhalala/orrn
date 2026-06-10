/**
 * Tenant-first / security section: fade-up facts plus stat counters that
 * count from 0 when scrolled into view.
 */
import { CheckCircle2, Shield } from "lucide-react";
import { useRef } from "react";

import { EASE, gsap, useMarketingGsap } from "../use-gsap";

const FACTS = [
  "Tenant scope is derived from session context — never from client input.",
  "Native sync mirrors tenant-local floor workflows, offline-first.",
  "Platform staff support flows are permission-gated, time-boxed, and audited.",
  "Impersonation is web-only, bannered, and revocable at any time.",
] as const;

const STATS = [
  { value: 100, suffix: "%", label: "of queries tenant-scoped" },
  { value: 5, suffix: "", label: "company roles, one capability matrix" },
  { value: 0, suffix: "", label: "cross-tenant assumptions in product flow" },
] as const;

export function TenantFirstSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useMarketingGsap(sectionRef, () => {
    gsap.from("[data-tenant-fact]", {
      y: 24,
      opacity: 0,
      duration: 0.6,
      stagger: 0.1,
      ease: EASE.outExpo,
      scrollTrigger: { trigger: "[data-tenant-facts]", start: "top 80%" },
    });

    gsap.utils.toArray<HTMLElement>("[data-stat-value]").forEach((el) => {
      const target = Number(el.dataset.statValue ?? 0);
      const suffix = el.dataset.statSuffix ?? "";
      const counter = { value: 0 };
      gsap.to(counter, {
        value: target,
        duration: 1.4,
        ease: EASE.outQuart,
        scrollTrigger: { trigger: el, start: "top 85%" },
        onUpdate: () => {
          el.textContent = `${Math.round(counter.value)}${suffix}`;
        },
      });
    });
  });

  return (
    <section
      ref={sectionRef}
      id="tenant-first"
      className="border-y border-border bg-card/30 py-24 md:py-32"
    >
      <div className="orrn-section grid gap-14 md:grid-cols-2 md:items-start">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-primary">
            <Shield size={16} aria-hidden="true" />
            Tenant-first by design
          </div>
          <h2 className="orrn-display-2 text-foreground">
            Your data never shares a lane.
          </h2>
          <p className="text-base leading-7 text-muted-foreground">
            ORRN keeps company context server-owned, hides unavailable actions
            before users hit them, and keeps platform support strictly separate
            from normal tenant work.
          </p>

          <div className="grid grid-cols-3 gap-4 pt-4">
            {STATS.map((stat) => (
              <div key={stat.label}>
                <div
                  data-stat-value={stat.value}
                  data-stat-suffix={stat.suffix}
                  className="font-mono text-3xl font-semibold text-foreground"
                >
                  {stat.value}
                  {stat.suffix}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div data-tenant-facts className="orrn-glass space-y-1 rounded-2xl p-3 shadow-lg">
          {FACTS.map((fact) => (
            <div
              key={fact}
              data-tenant-fact
              className="flex gap-3 rounded-xl px-4 py-4 text-sm leading-6 text-foreground transition-colors hover:bg-accent"
            >
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
              <span>{fact}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
