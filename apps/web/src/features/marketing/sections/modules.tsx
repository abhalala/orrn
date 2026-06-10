/**
 * Module showcase. Desktop: pinned section — scrolling scrubs through the 4
 * modules, crossfading mock-UI cards while the nav list highlights. Mobile:
 * simple stacked cards with fade-up on enter (no pinning, no scroll hijack).
 */
import { cn } from "@orrn/ui/lib/utils";
import { Boxes, Package, Printer, Truck } from "lucide-react";
import { useRef, useState } from "react";

import { EASE, MQ, gsap, useMarketingGsap } from "../use-gsap";

const MODULES = [
  {
    key: "dies",
    title: "Die Catalog",
    icon: Boxes,
    description:
      "Profile specs, theoretical weight, alloy metadata, and tooling status — searchable from the floor.",
    mock: {
      header: "Dies",
      rows: [
        ["DIE-2041", "6063-T5", "1.82 kg/m"],
        ["DIE-1187", "6061-T6", "2.31 kg/m"],
        ["DIE-0926", "6063-T5", "0.94 kg/m"],
      ],
    },
  },
  {
    key: "bundles",
    title: "Receipts & Bundles",
    icon: Package,
    description:
      "Press receipts create traceable bundles with piece count, length, and status — serials unique per company.",
    mock: {
      header: "Bundles",
      rows: [
        ["BND-88421", "Available", "48 pcs"],
        ["BND-88420", "Reserved", "36 pcs"],
        ["BND-88419", "Dispatched", "60 pcs"],
      ],
    },
  },
  {
    key: "dispatch",
    title: "Stock & Dispatch",
    icon: Truck,
    description:
      "Live stock by die, reservation controls, dispatch packing lists, and client-side exports from snapshots.",
    mock: {
      header: "Dispatches",
      rows: [
        ["DSP-1204", "Reserved", "12 bundles"],
        ["DSP-1203", "Completed", "8 bundles"],
        ["DSP-1202", "Completed", "21 bundles"],
      ],
    },
  },
  {
    key: "print",
    title: "LAN Printing",
    icon: Printer,
    description:
      "Signed spool jobs reach tenant-local thermal printers — no printer I/O in the cloud, every attempt logged.",
    mock: {
      header: "Print Queue",
      rows: [
        ["JOB-5512", "Printed", "Zebra ZT411"],
        ["JOB-5511", "Queued", "Zebra ZT411"],
        ["JOB-5510", "Printed", "TSC TE310"],
      ],
    },
  },
] as const;

export function ModulesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useMarketingGsap(sectionRef, (mm) => {
    mm.add(MQ.desktop, () => {
      const cards = gsap.utils.toArray<HTMLElement>("[data-module-card]");
      const count = cards.length;

      gsap.set(cards, { opacity: 0, y: 48, scale: 0.96 });
      gsap.set(cards[0], { opacity: 1, y: 0, scale: 1 });

      gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: `+=${count * 90}%`,
          pin: true,
          scrub: 0.5,
          onUpdate: (self) => {
            const index = Math.min(count - 1, Math.floor(self.progress * count));
            setActiveIndex(index);
            cards.forEach((card, i) => {
              gsap.to(card, {
                opacity: i === index ? 1 : 0,
                y: i === index ? 0 : i < index ? -48 : 48,
                scale: i === index ? 1 : 0.96,
                duration: 0.35,
                ease: EASE.outQuart,
                overwrite: "auto",
              });
            });
          },
        },
      });
    });

    mm.add(MQ.mobile, () => {
      gsap.utils.toArray<HTMLElement>("[data-module-mobile]").forEach((card) => {
        gsap.from(card, {
          y: 32,
          opacity: 0,
          duration: 0.7,
          ease: EASE.outExpo,
          scrollTrigger: { trigger: card, start: "top 85%" },
        });
      });
    });
  });

  return (
    <section ref={sectionRef} id="modules" className="relative border-y border-border bg-card/30">
      {/* Desktop pinned layout */}
      <div className="orrn-section hidden min-h-screen grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-16 py-24 md:grid">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-primary">Modules</p>
          <h2 className="orrn-display-2 mt-3 text-foreground">
            One system for the whole floor.
          </h2>
          <ul className="mt-10 space-y-1">
            {MODULES.map((module, index) => {
              const Icon = module.icon;
              const active = index === activeIndex;
              return (
                <li key={module.key}>
                  <div
                    className={cn(
                      "flex items-start gap-4 rounded-xl px-4 py-4 transition-all duration-[var(--dur-base)]",
                      active ? "bg-accent" : "opacity-50",
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors duration-[var(--dur-base)]",
                        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon size={18} aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{module.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {module.description}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="relative h-[420px]">
          {MODULES.map((module) => (
            <div key={module.key} data-module-card className="absolute inset-0">
              <ModuleMockCard module={module} />
            </div>
          ))}
        </div>
      </div>

      {/* Mobile stacked layout */}
      <div className="orrn-section space-y-10 py-16 md:hidden">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-primary">Modules</p>
          <h2 className="orrn-display-2 mt-3 text-foreground">One system for the whole floor.</h2>
        </div>
        {MODULES.map((module) => {
          const Icon = module.icon;
          return (
            <div key={module.key} data-module-mobile className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Icon size={18} aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{module.title}</h3>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">{module.description}</p>
              <ModuleMockCard module={module} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ModuleMockCard({ module }: { module: (typeof MODULES)[number] }) {
  return (
    <div className="orrn-glass h-full rounded-2xl p-5 shadow-lg">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <span className="text-sm font-semibold text-foreground">{module.mock.header}</span>
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-muted-foreground/30" />
          <span className="size-2.5 rounded-full bg-muted-foreground/30" />
          <span className="size-2.5 rounded-full bg-primary" />
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        {module.mock.rows.map((row) => (
          <div
            key={row[0]}
            className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-4 py-3"
          >
            <span className="font-mono text-sm font-medium text-foreground">{row[0]}</span>
            <span className="text-sm text-muted-foreground">{row[1]}</span>
            <span className="font-mono text-xs text-muted-foreground">{row[2]}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-1 pt-2">
          <div className="h-2 w-24 rounded-full bg-muted" />
          <div className="h-7 w-20 rounded-md bg-primary/80" />
        </div>
      </div>
    </div>
  );
}
