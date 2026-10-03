/**
 * Workflow timeline: receipt, bundle, stock, dispatch, print. Each step is a
 * small C2 colour tile; an ink line draws between them as the section
 * scrolls in (ScrollTrigger scrub). Horizontal on desktop, vertical on
 * mobile. Static under reduced motion.
 */
import { cn } from "@orrn/ui/lib/utils";
import { ClipboardList, Package, Printer, Truck, Warehouse } from "lucide-react";
import { useRef } from "react";

import { EASE, MQ, gsap, useMarketingGsap } from "../use-gsap";

const STEPS = [
  { key: "receipt", label: "Receipt", icon: ClipboardList, tone: "blue", copy: "Press run logged with die, alloy, and lengths." },
  { key: "bundle", label: "Bundle", icon: Package, tone: "green", copy: "Traceable serials minted per company." },
  { key: "stock", label: "Stock", icon: Warehouse, tone: "amber", copy: "Live availability by die and status." },
  { key: "dispatch", label: "Dispatch", icon: Truck, tone: "red", copy: "Reserved bundles roll into packing lists." },
  { key: "print", label: "Print", icon: Printer, tone: "neutral", copy: "Labels hit LAN printers via signed spool jobs." },
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
          y: 14,
          opacity: 0,
          duration: 0.55,
          delay: index * 0.07,
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
        <p className="m-0 text-sm font-semibold text-muted-foreground">Workflow</p>
        <h2 className="orrn-display-2 m-0 mt-3 text-foreground">
          Every piece accounted for, end to end.
        </h2>
        <p className="m-0 mt-5 text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
          Server-authoritative state transitions mean a bundle is never lost
          between the press and the truck. Bundles are never deleted. Voids
          stay auditable.
        </p>
      </div>

      <div className="relative mt-16">
        {/* Connector line: horizontal on md+, vertical on mobile. */}
        <div
          aria-hidden="true"
          className="absolute left-6 top-0 h-full w-0.5 rounded-full bg-border md:left-0 md:top-6 md:h-0.5 md:w-full"
        >
          <div
            data-workflow-line-fill
            className="size-full origin-top rounded-full bg-foreground md:origin-left"
          />
        </div>

        <ol className="relative m-0 flex list-none flex-col gap-10 p-0 md:flex-row md:justify-between md:gap-4">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.key}
                data-workflow-step
                className="flex items-start gap-5 md:max-w-[190px] md:flex-col md:items-start md:gap-4"
              >
                <div
                  aria-hidden="true"
                  className={cn(
                    "relative z-10 flex size-12 shrink-0 items-center justify-center rounded-card shadow-md",
                    `orrn-block-${step.tone}`,
                  )}
                >
                  <Icon size={22} />
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="m-0 text-base font-semibold text-foreground">{step.label}</h3>
                  </div>
                  <p className="m-0 mt-1.5 text-sm leading-6 text-muted-foreground">{step.copy}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
