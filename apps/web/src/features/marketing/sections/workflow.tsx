/**
 * Workflow timeline: receipt → bundle → stock → dispatch → print. A
 * ScrollTrigger-scrubbed line draw connects the steps; each step pops in as
 * the line reaches it. Same animation model on mobile and desktop — only the
 * axis flips (horizontal on desktop, vertical on mobile).
 */
import { ClipboardList, Package, Printer, Truck, Warehouse } from "lucide-react";
import { useRef } from "react";

import { EASE, MQ, gsap, useMarketingGsap } from "../use-gsap";

const STEPS = [
  { key: "receipt", label: "Receipt", icon: ClipboardList, copy: "Press run logged with die, alloy, and lengths." },
  { key: "bundle", label: "Bundle", icon: Package, copy: "Traceable serials minted per company." },
  { key: "stock", label: "Stock", icon: Warehouse, copy: "Live availability by die and status." },
  { key: "dispatch", label: "Dispatch", icon: Truck, copy: "Reserved bundles roll into packing lists." },
  { key: "print", label: "Print", icon: Printer, copy: "Labels hit LAN printers via signed spool jobs." },
] as const;

export function WorkflowSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useMarketingGsap(sectionRef, (mm) => {
    const steps = gsap.utils.toArray<HTMLElement>("[data-workflow-step]");

    const animateSteps = () => {
      gsap.from("[data-workflow-line-fill]", {
        scaleX: 0,
        scaleY: 0,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 70%",
          end: "bottom 75%",
          scrub: 0.4,
        },
      });
      steps.forEach((step, index) => {
        gsap.from(step, {
          y: 24,
          opacity: 0,
          duration: 0.6,
          delay: index * 0.04,
          ease: EASE.outExpo,
          scrollTrigger: { trigger: step, start: "top 85%" },
        });
      });
    };

    mm.add(MQ.desktop, animateSteps);
    mm.add(MQ.mobile, animateSteps);
  });

  return (
    <section ref={sectionRef} id="workflow" className="orrn-section py-24 md:py-32">
      <div className="max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-widest text-primary">Workflow</p>
        <h2 className="orrn-display-2 mt-3 text-foreground">
          Every piece accounted for, end to end.
        </h2>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          Server-authoritative state transitions mean a bundle is never lost
          between the press and the truck. Bundles are never deleted — voids
          stay auditable.
        </p>
      </div>

      <div className="relative mt-16">
        {/* Connector line: horizontal on md+, vertical on mobile. */}
        <div className="absolute left-6 top-0 h-full w-px bg-border md:left-0 md:top-6 md:h-px md:w-full">
          <div
            data-workflow-line-fill
            className="size-full origin-top bg-gradient-to-b from-primary to-brand-accent md:origin-left md:bg-gradient-to-r"
          />
        </div>

        <ol className="relative flex flex-col gap-10 md:flex-row md:justify-between md:gap-4">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.key}
                data-workflow-step
                className="flex items-start gap-5 md:max-w-[180px] md:flex-col md:items-start md:gap-4"
              >
                <div className="orrn-glass relative z-10 flex size-12 shrink-0 items-center justify-center rounded-xl text-primary shadow-md">
                  <Icon size={20} aria-hidden="true" />
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="font-semibold text-foreground">{step.label}</h3>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{step.copy}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
