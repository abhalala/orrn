/**
 * Module showcase. Desktop: pinned section; scrolling steps through the four
 * modules, swapping the demo card while the list highlights. Mobile: simple
 * stacked cards with a rise on enter (no pinning, no scroll hijack).
 * Each module owns one C2 tone; the demo card's header is that colour block.
 */
import { cn } from "@orrn/ui/lib/utils";
import { Boxes, Package, Printer, Truck } from "lucide-react";
import { useRef, useState } from "react";

import { EASE, MQ, gsap, useMarketingGsap } from "../use-gsap";

type Tone = "green" | "blue" | "amber" | "red" | "neutral";

/** Chip tone for each demo status word. */
const STATUS_TONE: Record<string, Tone> = {
  Available: "green",
  Reserved: "blue",
  Dispatched: "neutral",
  Completed: "green",
  Printed: "green",
  Queued: "amber",
};

const CHIP_CLASSES: Record<Tone, string> = {
  green: "bg-tone-green-tint text-tone-green-ink",
  blue: "bg-tone-blue-tint text-tone-blue-ink",
  amber: "bg-tone-amber-tint text-tone-amber-ink",
  red: "bg-tone-red-tint text-tone-red-ink",
  neutral: "bg-tone-neutral-tint text-tone-neutral-ink",
};

const MODULES = [
  {
    key: "dies",
    title: "Die catalog",
    icon: Boxes,
    tone: "neutral" as Tone,
    description:
      "Profile specs, theoretical weight, alloy metadata, and tooling status, searchable from the floor.",
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
    title: "Packing and bundles",
    icon: Package,
    tone: "blue" as Tone,
    description:
      "Press receipts create traceable bundles with piece count, length, and status. Serials are unique per company.",
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
    title: "Stock and dispatch",
    icon: Truck,
    tone: "red" as Tone,
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
    title: "LAN printing",
    icon: Printer,
    tone: "amber" as Tone,
    description:
      "Signed spool jobs reach tenant-local thermal printers: no printer I/O in the cloud, every attempt logged.",
    mock: {
      header: "Printing",
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

  const reduced = useMarketingGsap(sectionRef, (mm) => {
    mm.add(MQ.desktop, () => {
      const cards = gsap.utils.toArray<HTMLElement>("[data-module-card]");
      const count = cards.length;

      gsap.set(cards, { opacity: 0, y: 28, scale: 0.98 });
      gsap.set(cards[0], { opacity: 1, y: 0, scale: 1 });

      gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: `+=${count * 80}%`,
          pin: true,
          scrub: 0.5,
          onUpdate: (self) => {
            const index = Math.min(count - 1, Math.floor(self.progress * count));
            setActiveIndex(index);
            cards.forEach((card, i) => {
              gsap.to(card, {
                opacity: i === index ? 1 : 0,
                y: i === index ? 0 : i < index ? -28 : 28,
                scale: i === index ? 1 : 0.98,
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
          y: 14,
          opacity: 0,
          duration: 0.55,
          ease: EASE.outExpo,
          scrollTrigger: { trigger: card, start: "top 85%" },
        });
      });
    });
  });

  return (
    <section ref={sectionRef} id="modules" className="relative border-y border-border bg-card">
      {/* Desktop pinned layout */}
      <div
        className={cn(
          "orrn-section hidden min-h-[100dvh] grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-center gap-16 py-24",
          !reduced && "md:grid",
        )}
      >
        <div>
          <p className="m-0 text-sm font-semibold text-muted-foreground">Modules</p>
          <h2 className="orrn-display-2 m-0 mt-3 text-foreground">One system for the whole floor.</h2>
          <ul className="m-0 mt-10 list-none space-y-1.5 p-0">
            {MODULES.map((module, index) => {
              const Icon = module.icon;
              const active = index === activeIndex;
              return (
                <li key={module.key}>
                  <div
                    className={cn(
                      "flex items-start gap-4 rounded-card px-4 py-4 transition-colors duration-[var(--dur-base)]",
                      active ? "bg-background" : "",
                    )}
                  >
                    <div
                      aria-hidden="true"
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-md transition-colors duration-[var(--dur-base)]",
                        active ? `orrn-block-${module.tone} shadow-sm` : "bg-surface-sunken text-muted-foreground",
                      )}
                    >
                      <Icon size={20} />
                    </div>
                    <div>
                      <h3
                        className={cn(
                          "m-0 text-base font-semibold transition-colors",
                          active ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {module.title}
                      </h3>
                      <p className="m-0 mt-1 text-sm leading-6 text-muted-foreground">{module.description}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="relative h-[400px]">
          {MODULES.map((module, index) => (
            <div
              key={module.key}
              data-module-card
              className="absolute inset-0 flex flex-col justify-center"
              aria-hidden={index === activeIndex ? undefined : true}
            >
              <ModuleMockCard module={module} />
            </div>
          ))}
        </div>
      </div>

      {/* Stacked layout: phones, and every width under reduced motion. */}
      <div
        className={cn(
          "orrn-section grid gap-12 py-16",
          reduced ? "md:grid-cols-2 md:gap-x-10 md:gap-y-16 md:py-24" : "md:hidden",
        )}
      >
        <div className={cn(reduced && "md:col-span-2")}>
          <p className="m-0 text-sm font-semibold text-muted-foreground">Modules</p>
          <h2 className="orrn-display-2 m-0 mt-3 text-foreground">One system for the whole floor.</h2>
        </div>
        {MODULES.map((module) => {
          const Icon = module.icon;
          return (
            <div key={module.key} data-module-mobile className="space-y-4">
              <div className="flex items-center gap-3">
                <div
                  aria-hidden="true"
                  className="flex size-11 items-center justify-center rounded-md bg-surface-sunken text-foreground"
                >
                  <Icon size={20} />
                </div>
                <h3 className="m-0 text-lg font-semibold text-foreground">{module.title}</h3>
              </div>
              <p className="m-0 text-[15px] leading-6 text-muted-foreground">{module.description}</p>
              <ModuleMockCard module={module} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ModuleMockCard({ module }: { module: (typeof MODULES)[number] }) {
  const Icon = module.icon;
  return (
    <div className="flex flex-col gap-2.5 rounded-hero border border-border bg-background p-2.5 shadow-md">
      <div className={cn("orrn-block flex items-center justify-between gap-3 p-5", `orrn-block-${module.tone}`)}>
        <div className="flex items-center gap-3">
          <Icon size={22} aria-hidden="true" />
          <p className="m-0 font-display text-[26px] font-extrabold leading-none tracking-[-0.03em]">
            {module.mock.header}
          </p>
        </div>
        <span className="rounded-full bg-black/15 px-2.5 py-1 text-xs font-semibold">Demo data</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {module.mock.rows.map((row) => {
          const tone = STATUS_TONE[row[1]];
          return (
            <li
              key={row[0]}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-card bg-card px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
            >
              <span className="font-mono text-sm font-semibold text-foreground">{row[0]}</span>
              {tone ? (
                <span
                  className={cn(
                    "inline-flex min-h-[22px] items-center justify-self-end rounded-full px-2.5 text-[11px] font-semibold sm:justify-self-auto",
                    CHIP_CLASSES[tone],
                  )}
                >
                  {row[1]}
                </span>
              ) : (
                <span className="justify-self-end font-mono text-sm text-muted-foreground sm:justify-self-auto">
                  {row[1]}
                </span>
              )}
              <span className="col-span-2 font-mono text-xs text-muted-foreground sm:col-span-1 sm:text-right">
                {row[2]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
