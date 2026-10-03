/**
 * The flow: Pack, Stock, Dispatch as three colour blocks, each with a small
 * demo of what that step looks like. It is a real sequence, so it is an
 * ordered list, stepped down left to right on wide screens.
 *
 * Scroll-linked: when the list reaches the lower part of the viewport the
 * demos play in order (wide: one sequence across the row; phone: each block
 * as it arrives). `data-played` on the section records it. Reduced motion
 * shows every demo in its final state.
 */
import { useT, type MessageKey } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { Check, Package, Printer, Truck, Warehouse, type LucideIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { DEMO_BUNDLE, DEMO_PACKING_LIST, DEMO_STOCK, demoKg } from "./demo-data";
import { DemoLabel } from "./demo-label";
import { EASE, MQ, gsap, onceInView, useMarketingGsap } from "./use-gsap";

type Step = {
  key: "pack" | "stock" | "dispatch";
  tone: "blue" | "green" | "red";
  icon: LucideIcon;
  title: MessageKey;
  body: MessageKey;
  offset: string;
};

// Pack is work in progress (blue), stock is the in-stock green, dispatch the
// red dispatch accent: the bundle's colours as it moves through the plant.
const STEPS: Step[] = [
  { key: "pack", tone: "blue", icon: Package, title: "nav.pack", body: "marketing.flow.pack", offset: "" },
  { key: "stock", tone: "green", icon: Warehouse, title: "nav.stock", body: "marketing.flow.stock", offset: "md:mt-10" },
  { key: "dispatch", tone: "red", icon: Truck, title: "nav.dispatch", body: "marketing.flow.dispatch", offset: "md:mt-20" },
];

/**
 * Writes the count into React's own text node (never replace it with
 * `textContent`, React still holds that node).
 */
function setCount(el: HTMLElement, n: number) {
  if (el.firstChild) el.firstChild.nodeValue = String(n);
}

/** One step's demo as a paused timeline, built from `from` tweens (final state = markup). */
function stepTimeline(block: Element): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true, defaults: { ease: EASE.out } });
  const rows = block.querySelectorAll("[data-demo-row]");
  const pop = block.querySelectorAll("[data-demo-pop]");
  const count = block.querySelector<HTMLElement>("[data-demo-count]");
  if (rows.length) tl.from(rows, { x: -16, opacity: 0, duration: 0.45, stagger: 0.09 });
  if (count) {
    const target = Number(count.dataset.demoCount);
    const state = { n: 0 };
    tl.from(count, { opacity: 0, duration: 0.2 }, 0).to(
      state,
      { n: target, duration: 0.8, ease: "power2.out", onUpdate: () => setCount(count, Math.round(state.n)) },
      0,
    );
  }
  if (pop.length) tl.from(pop, { scale: 0.6, opacity: 0, duration: 0.55, ease: EASE.pop }, "-=0.15");
  return tl;
}

export function Flow() {
  const { t } = useT();
  const sectionRef = useRef<HTMLElement>(null);

  const reduced = useMarketingGsap(sectionRef, ({ scope, mm }) => {
    const markPlayed = () => {
      scope.dataset.played = "true";
    };
    const list = scope.querySelector("[data-flow-list]");
    const blocks = Array.from(scope.querySelectorAll("[data-flow-step]"));
    if (!list) return;
    // A revert mid count-up must not leave a half-counted number behind.
    const resetCounts = () =>
      scope.querySelectorAll<HTMLElement>("[data-demo-count]").forEach((el) => setCount(el, Number(el.dataset.demoCount)));

    mm.add(MQ.wide, () => {
      const sequence = gsap.timeline({ paused: true });
      blocks.forEach((block, i) => sequence.add(stepTimeline(block).play(), i === 0 ? 0 : "-=0.2"));
      const stop = onceInView(list, () => {
        markPlayed();
        sequence.play();
      });
      return () => {
        stop();
        resetCounts();
      };
    });

    mm.add(MQ.narrow, () => {
      const stops = blocks.map((block) => {
        const tl = stepTimeline(block);
        return onceInView(block, () => {
          markPlayed();
          tl.play();
        });
      });
      return () => {
        stops.forEach((stop) => stop());
        resetCounts();
      };
    });
  });

  return (
    <section
      ref={sectionRef}
      id="flow"
      aria-labelledby="flow-title"
      data-played={reduced ? "true" : undefined}
      className="orrn-section py-20 md:py-28"
    >
      <h2 id="flow-title" className="orrn-display-2 m-0 max-w-[16ch] text-balance text-foreground">
        {t("marketing.flow.title")}
      </h2>
      <ol data-flow-list className="m-0 mt-10 grid list-none gap-4 p-0 md:mt-14 md:grid-cols-3 md:gap-5">
        {STEPS.map((step) => (
          <li key={step.key} className={cn("min-w-0", step.offset)}>
            <FlowBlock step={step}>
              {step.key === "pack" ? <PackDemo /> : step.key === "stock" ? <StockDemo /> : <DispatchDemo />}
            </FlowBlock>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FlowBlock({ step, children }: { step: Step; children: ReactNode }) {
  const { t } = useT();
  const Icon = step.icon;
  return (
    <article data-flow-step className={cn("orrn-block flex h-full flex-col gap-4 p-5 md:p-6", `orrn-block-${step.tone}`)}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tone-neutral-to/20">
          <Icon className="size-[22px]" strokeWidth={2} />
        </span>
        <h3 className="m-0 font-display text-[26px] font-bold leading-tight tracking-[-0.03em]">{t(step.title)}</h3>
      </div>
      <p className="m-0 text-[16px] leading-7">{t(step.body)}</p>
      <div data-demo-visual aria-hidden="true" className="mt-auto flex flex-col gap-2 rounded-card bg-tone-neutral-to/20 p-3">
        <DemoLabel onColor className="self-start" />
        {children}
      </div>
    </article>
  );
}

function DemoRow({ label, value }: { label: string; value: string }) {
  return (
    <div data-demo-row className="flex min-h-11 items-center justify-between gap-3 rounded-input bg-tone-neutral-to/25 px-3">
      <span className="text-[14px] font-semibold">{label}</span>
      <span className="font-mono text-[18px] font-semibold">{value}</span>
    </div>
  );
}

function DemoPill({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span
      data-demo-pop
      className="inline-flex h-9 items-center gap-2 self-start rounded-full bg-tone-neutral-on px-3.5 text-[14px] font-semibold text-tone-neutral-to"
    >
      <Icon className="size-4" strokeWidth={2} />
      {children}
    </span>
  );
}

function PackDemo() {
  const { t } = useT();
  return (
    <>
      <DemoRow label={t("pack.new.weight")} value={demoKg(DEMO_BUNDLE)} />
      <DemoRow label={t("pack.new.pieces")} value={String(DEMO_BUNDLE.pieces)} />
      <DemoPill icon={Printer}>{t("status.printJob.success")}</DemoPill>
    </>
  );
}

/** Bars of different lengths: extrusion bundles stacked in the bay. */
const BAR_WIDTHS = ["w-full", "w-11/12", "w-full", "w-10/12"];

function StockDemo() {
  const { t } = useT();
  return (
    <>
      <p className="m-0 flex items-baseline gap-2">
        <span
          data-demo-count={DEMO_STOCK.inStock}
          className="font-display text-[44px] font-extrabold leading-none tracking-[-0.045em]"
        >
          {DEMO_STOCK.inStock}
        </span>
        <span className="text-[14px] font-semibold">{t("marketing.visual.bundles", { count: DEMO_STOCK.inStock })}</span>
      </p>
      <div className="flex flex-col gap-1.5 py-1">
        {BAR_WIDTHS.map((w, i) => (
          <span key={i} data-demo-row className={cn("h-2.5 rounded-full bg-tone-neutral-on/85", w)} />
        ))}
      </div>
      <DemoPill icon={Check}>{t("status.bundle.available")}</DemoPill>
    </>
  );
}

function DispatchDemo() {
  const { t } = useT();
  return (
    <>
      {DEMO_PACKING_LIST.slice(0, 3).map((b) => (
        <div
          key={b.serial}
          data-demo-row
          className="flex min-h-10 items-center justify-between gap-3 rounded-input bg-tone-neutral-to/25 px-3"
        >
          <span className="flex items-center gap-2 font-mono text-[14px] font-semibold">
            <Check className="size-4" strokeWidth={2.5} />
            {b.serial}
          </span>
          <span className="font-mono text-[14px]">{demoKg(b)}</span>
        </div>
      ))}
      <DemoPill icon={Check}>{t("marketing.visual.packingListReady")}</DemoPill>
    </>
  );
}
