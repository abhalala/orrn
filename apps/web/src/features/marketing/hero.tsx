/**
 * Hero: the headline, one plain sentence, the two front-door actions, and
 * the page's one loud element: a phone scanning a bundle label next to the
 * stock colour blocks it updates. The picture is demo data, hidden from
 * screen readers, and labelled "Demo data" on screen.
 *
 * Motion (one orchestrated moment on load): the phone and the blocks float
 * in, the scan line sweeps the label once, the result pops. The text never
 * animates, so it paints first. Reduced motion shows the final state.
 */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { CircleCheck, Printer, QrCode } from "lucide-react";
import { useRef } from "react";

import { DEMO_BUNDLE, DEMO_STOCK, demoKg, formatKgTotal } from "./demo-data";
import { DemoLabel } from "./demo-label";
import { EASE, gsap, onceInView, useMarketingGsap } from "./use-gsap";

export function Hero() {
  const { t, locale } = useT();
  const visualRef = useRef<HTMLDivElement>(null);

  useMarketingGsap(visualRef, ({ scope }) => {
    const viewfinder = scope.querySelector<HTMLElement>("[data-viewfinder]");
    const tl = gsap.timeline({ paused: true, delay: 0.15, defaults: { ease: EASE.out } });
    tl.from('[data-anim="hero-phone"]', { y: 32, opacity: 0, duration: 0.7 })
      .from(
        '[data-anim^="hero-tile"]',
        { y: 24, scale: 0.94, opacity: 0, duration: 0.6, stagger: 0.1, ease: EASE.rise },
        "-=0.45",
      )
      .fromTo(
        "[data-scanline]",
        { y: 0, opacity: 1 },
        { y: () => (viewfinder?.clientHeight ?? 120) - 4, duration: 0.75, ease: "power1.inOut" },
        "-=0.2",
      )
      .to("[data-scanline]", { opacity: 0, duration: 0.15 })
      .from('[data-anim="hero-pop"]', { scale: 0.6, opacity: 0, duration: 0.6, ease: EASE.pop }, "-=0.1")
      .from('[data-anim="hero-printed"]', { scale: 0.6, opacity: 0, duration: 0.5, ease: EASE.pop }, "-=0.3");
    // In view on load when side by side; stacked under the text on phones and
    // tablets it plays when it scrolls in.
    return onceInView(scope, () => tl.play());
  });

  return (
    <section data-marketing-hero aria-labelledby="hero-title" className="relative">
      <div className="orrn-section grid gap-12 pb-16 pt-24 md:pb-24 md:pt-32 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:gap-10 lg:pb-28 lg:pt-32">
        <div className="min-w-0">
          <h1
            id="hero-title"
            className={cn(
              "m-0 max-w-[14ch] text-balance font-display text-[clamp(2.75rem,1.3rem+4.4vw,4.75rem)] font-extrabold text-foreground",
              // Devanagari needs room for its marks and no negative tracking.
              locale === "hi" ? "leading-[1.2] tracking-normal" : "leading-[0.98] tracking-[-0.045em]",
            )}
          >
            {t("marketing.headline")}
          </h1>
          <p className="m-0 mt-6 max-w-[34rem] text-pretty text-lg leading-8 text-muted-foreground md:text-xl md:leading-9">
            {t("marketing.sub")}
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/request-access">{t("marketing.requestAccess")}</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link to="/login">{t("marketing.signIn")}</Link>
            </Button>
          </div>
        </div>

        <div ref={visualRef} data-demo-visual aria-hidden="true" className="min-w-0">
          <HeroPicture />
        </div>
      </div>
    </section>
  );
}

function HeroPicture() {
  const { t } = useT();
  return (
    // Tablets stack it under the text: set right, so text and picture read as a diagonal.
    <div className="relative mx-auto w-full max-w-[30rem] md:mr-0 lg:mx-auto">
      <DemoLabel className="mb-4" />
      <div className="relative h-[25.5rem] sm:h-[27rem]">
        {/* The phone: the Scan screen right after a label was read. */}
        <div className="absolute left-0 top-0 w-[13.5rem] sm:w-[15rem]">
          <div
            data-anim="hero-phone"
            className="rounded-hero bg-tone-neutral-to p-2 shadow-block ring-1 ring-hairline dark:bg-surface-sunken"
          >
            <div className="flex flex-col gap-3 rounded-block bg-background p-3 text-foreground">
              <p className="m-0 font-display text-[20px] font-bold leading-tight tracking-[-0.03em]">
                {t("scan.title")}
              </p>
              <div
                data-viewfinder
                className="relative flex h-[7.5rem] items-center justify-center overflow-hidden rounded-card bg-tone-neutral-from sm:h-[8.5rem]"
              >
                <ScanCorners />
                <div className="flex items-center gap-2 rounded-input bg-tone-neutral-on px-3 py-2 text-tone-neutral-to">
                  <QrCode className="size-9" strokeWidth={2} />
                  <span className="font-mono text-[12px] font-semibold leading-tight">
                    {DEMO_BUNDLE.serial}
                    <br />
                    {demoKg(DEMO_BUNDLE)} kg
                  </span>
                </div>
                <span
                  data-scanline
                  className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-tone-green opacity-0"
                />
              </div>
              <div data-anim="hero-pop" className="orrn-block orrn-block-green p-3">
                <p className="m-0 flex items-center gap-1.5 text-[13px] font-semibold">
                  <CircleCheck className="size-4" strokeWidth={2} />
                  {t("status.bundle.available")}
                </p>
                <p className="m-0 mt-1 font-mono text-[15px] font-semibold">{DEMO_BUNDLE.serial}</p>
                <p className="m-0 mt-2 flex items-baseline gap-2">
                  <span className="font-display text-[28px] font-extrabold leading-none tracking-[-0.04em]">
                    {demoKg(DEMO_BUNDLE)}
                  </span>
                  <span className="text-[13px] font-semibold">kg</span>
                  <span className="text-[13px]">{t("marketing.visual.pieces", { count: DEMO_BUNDLE.pieces })}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Stock colour blocks the scan feeds. */}
        <div className="absolute right-0 top-8 w-[9.5rem] sm:top-10 sm:w-[11.5rem]">
          <StockTile
            anim="hero-tile-stock"
            tone="green"
            status={t("status.bundle.available")}
            count={DEMO_STOCK.inStock}
            kg={formatKgTotal(DEMO_STOCK.inStockKg)}
          />
        </div>
        <div className="absolute right-3 top-[14.5rem] w-[9.5rem] sm:right-6 sm:top-[15.5rem] sm:w-[11.5rem]">
          <StockTile
            anim="hero-tile-held"
            tone="blue"
            status={t("status.bundle.reserved")}
            count={DEMO_STOCK.held}
            kg={formatKgTotal(DEMO_STOCK.heldKg)}
          />
        </div>
        <div className="absolute bottom-0 right-0">
          <span
            data-anim="hero-printed"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-[14px] font-semibold text-foreground shadow-sm"
          >
            <Printer className="size-4" strokeWidth={2} />
            {t("status.printJob.success")}
          </span>
        </div>
      </div>
    </div>
  );
}

function StockTile({
  anim,
  tone,
  status,
  count,
  kg,
}: {
  anim: string;
  tone: "green" | "blue";
  status: string;
  count: number;
  kg: string;
}) {
  const { t } = useT();
  return (
    <div data-anim={anim} className={cn("orrn-block p-4", `orrn-block-${tone}`)}>
      <p className="m-0 text-[14px] font-semibold">{status}</p>
      <p className="m-0 mt-2 flex items-baseline gap-1.5">
        <span className="font-display text-[40px] font-extrabold leading-none tracking-[-0.045em] sm:text-[48px]">
          {count}
        </span>
        <span className="text-[13px] font-semibold">{t("marketing.visual.bundles", { count })}</span>
      </p>
      <p className="m-0 mt-2 font-mono text-[13px]">{kg} kg</p>
    </div>
  );
}

/** Four corner brackets of the camera frame. */
function ScanCorners() {
  const corner = "absolute size-5 border-tone-neutral-on";
  return (
    <>
      <span className={cn(corner, "left-3 top-3 rounded-tl-input border-l-2 border-t-2")} />
      <span className={cn(corner, "right-3 top-3 rounded-tr-input border-r-2 border-t-2")} />
      <span className={cn(corner, "bottom-3 left-3 rounded-bl-input border-b-2 border-l-2")} />
      <span className={cn(corner, "bottom-3 right-3 rounded-br-input border-b-2 border-r-2")} />
    </>
  );
}
