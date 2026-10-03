import { useT, type MessageKey } from "@orrn/i18n";
import { riseDelay } from "@orrn/ui/components/motion";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";

type Tile = {
  tone: "green" | "blue" | "red";
  step: MessageKey;
  status: MessageKey;
  line: MessageKey;
};

/** The plant flow as the status colours the app uses for it. Words only, no numbers (nothing invented). */
const TILES: Tile[] = [
  { tone: "green", step: "nav.pack", status: "status.bundle.available", line: "auth.brand.pack" },
  { tone: "blue", step: "auth.brand.holdStep", status: "status.bundle.reserved", line: "auth.brand.hold" },
  { tone: "red", step: "nav.dispatch", status: "status.bundle.dispatched", line: "auth.brand.dispatch" },
];

export function Wordmark({ className, onInk = false }: { className?: string; onInk?: boolean }) {
  const { t } = useT();
  return (
    <Link
      to="/"
      aria-label={t("nav.home")}
      className={cn("inline-flex min-h-11 items-center gap-2.5 rounded-full pr-2 no-underline", className)}
    >
      <span aria-hidden="true" className="orrn-mark size-8" />
      <span
        className={cn(
          "font-display text-[22px] font-extrabold tracking-[-0.035em]",
          onInk ? "text-tone-neutral-on" : "text-foreground",
        )}
      >
        {t("common.appName")}
      </span>
    </Link>
  );
}

/**
 * Laptop brand panel for the front door: one ink hero block holding the
 * product line and the flow as three status tiles. It is the screen's one
 * loud element. Motion is a single moment on arrival: the tiles rise in turn
 * and the "In stock" word pops once, as a packed bundle does on the floor.
 * Nothing loops; under reduced motion it is all still.
 */
export function BrandPanel({ className }: { className?: string }) {
  const { t } = useT();
  return (
    <aside aria-label={t("auth.brand.label")} className={cn("p-4", className)}>
      <div className="orrn-block orrn-block-neutral orrn-block-hero flex h-full min-h-0 flex-col gap-10 overflow-hidden p-8 xl:p-12">
        <Wordmark onInk className="self-start" />
        <div className="mt-auto flex flex-col gap-8">
          <div className="flex max-w-[34rem] flex-col gap-4">
            <p className="m-0 font-display text-[40px] font-extrabold leading-[1.02] tracking-[-0.04em] text-balance xl:text-[54px]">
              {t("marketing.headline")}
            </p>
            <p className="m-0 max-w-[44ch] text-[16px] leading-6 font-medium xl:text-[17px]">{t("marketing.sub")}</p>
          </div>
          <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0">
            {TILES.map((tile, i) => (
              <li
                key={tile.tone}
                style={riseDelay(i + 1)}
                className={cn(
                  "orrn-block orrn-block-sheen animate-rise flex min-w-0 flex-col justify-between gap-6 p-4 xl:p-5",
                  `orrn-block-${tile.tone}`,
                  i === 0 ? "row-span-2 min-h-[220px]" : "min-h-[104px]",
                )}
              >
                <span className="relative flex flex-col gap-1">
                  <span className="font-display text-[17px] font-bold leading-tight tracking-[-0.02em]">{t(tile.step)}</span>
                  {i === 0 ? (
                    <span className="text-[14px] font-medium leading-snug break-words">{t(tile.line)}</span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "relative block font-display font-extrabold leading-[0.95] tracking-[-0.04em] break-words",
                    i === 0 ? "animate-pop text-[34px] xl:text-[44px]" : "text-[24px] xl:text-[30px]",
                  )}
                  // The pop lands after the tiles have risen.
                  style={i === 0 ? { animationDelay: "420ms" } : undefined}
                >
                  {t(tile.status)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}

/**
 * Phone and iPad stand-in for the panel: the three status words as a slim row
 * of colour tiles above the form. Decorative (the form is the job), so it is
 * hidden from screen readers; the words repeat what the laptop panel says.
 */
export function BrandStrip({ className }: { className?: string }) {
  const { t } = useT();
  return (
    <div aria-hidden="true" className={cn("grid grid-cols-3 gap-2", className)}>
      {TILES.map((tile, i) => (
        <div
          key={tile.tone}
          style={riseDelay(i)}
          className={cn(
            "orrn-block animate-rise flex min-h-[64px] min-w-0 items-end p-3",
            `orrn-block-${tile.tone}`,
          )}
        >
          <span className="relative font-display text-[15px] font-bold leading-tight tracking-[-0.02em] break-words">
            {t(tile.status)}
          </span>
        </div>
      ))}
    </div>
  );
}
