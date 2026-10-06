/**
 * Built for the floor: the bundle entry card as packers see it (big fields,
 * a 56px pill), beside four plain points. The language point is live: the
 * toggle here switches the whole page, the card included.
 */
import { useT, type MessageKey } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { cn } from "@orrn/ui/lib/utils";
import { Hand, Languages, ScanLine, Smartphone, type LucideIcon } from "lucide-react";

import { LanguageToggle } from "@/shell/language-toggle";

import { DEMO_BUNDLE, demoKg, demoKg12ft } from "./demo-data";
import { DemoLabel } from "./demo-label";
import { displaySetting } from "./display-type";

const POINTS: { icon: LucideIcon; text: MessageKey }[] = [
  { icon: Hand, text: "marketing.floor.buttons" },
  { icon: Languages, text: "marketing.floor.hindi" },
  { icon: ScanLine, text: "marketing.floor.camera" },
  { icon: Smartphone, text: "marketing.floor.devices" },
];

export function Floor() {
  const { t, locale } = useT();
  return (
    <section id="floor" aria-labelledby="floor-title" className="orrn-section py-20 md:py-28">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:gap-16">
        <div className="min-w-0 lg:order-2">
          <h2 id="floor-title" className={cn("orrn-display-2 m-0 text-balance text-foreground", displaySetting(locale))}>
            {t("marketing.floor.title")}
          </h2>
          <ul className="m-0 mt-8 grid list-none gap-x-10 gap-y-7 p-0 sm:grid-cols-2">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex min-w-0 gap-3.5">
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-foreground"
                >
                  <Icon className="size-5" strokeWidth={2} />
                </span>
                <p className="m-0 min-w-0 text-pretty pt-2.5 text-[16px] leading-7 text-foreground">{t(text)}</p>
              </li>
            ))}
          </ul>
          <div className="mt-9 flex flex-wrap items-center gap-x-4 gap-y-3">
            <p className="m-0 text-[15px] font-semibold text-muted-foreground">{t("marketing.floor.tryIt")}</p>
            <LanguageToggle className="w-auto" />
          </div>
        </div>

        <div className="min-w-0 lg:order-1">
          <BundleCard />
        </div>
      </div>
    </section>
  );
}

function BundleCard() {
  const { t } = useT();
  return (
    <div
      data-demo-visual
      aria-hidden="true"
      // Tablets stack it under the text: set right, like the hero picture (one diagonal).
      className="mx-auto flex w-full max-w-[26rem] flex-col gap-5 rounded-card border border-border bg-card p-5 sm:p-6 md:mr-0 lg:mx-0"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 font-display text-[22px] font-bold tracking-[-0.03em] text-foreground">
          {t("pack.new.bundleNumber", { n: 8 })}
        </p>
        <DemoLabel />
      </div>
      <BigField label={t("pack.new.weight")} value={demoKg(DEMO_BUNDLE)} />
      <BigField label={t("pack.new.pieces")} value={String(DEMO_BUNDLE.pieces)} />
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[15px] font-semibold text-foreground">
          {demoKg12ft(DEMO_BUNDLE)} {t("units.kgPer12ft")}
        </span>
        <Chip tone="green">{t("status.range.inRange")}</Chip>
      </div>
      <span className="flex h-14 w-full items-center justify-center rounded-full bg-primary px-7 text-[17px] font-bold tracking-[-0.01em] text-primary-foreground shadow-button">
        {t("pack.new.saveBundle")}
      </span>
    </div>
  );
}

function BigField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[15px] font-semibold text-foreground">{label}</span>
      <span className="flex h-16 items-center rounded-input border-2 border-foreground bg-card px-4 font-mono text-[30px] font-semibold text-foreground">
        {value}
      </span>
    </div>
  );
}
