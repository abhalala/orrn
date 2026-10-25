import { useT } from "@orrn/i18n";
import { UiLink } from "@orrn/ui/components/link";
import { StatusBlock } from "@orrn/ui/components/status-block";

/** `dashboard.today.ageing` (W3-AG-S): null for people without `ageing.view`. */
export type AgeingToday = { inOven: number; held: number; out: number } | null;

/**
 * Today's ageing tile: batches in the oven, out and waiting for the test, and held. Each block
 * opens the board. Strings are `today.oven.*`, a floor namespace gu carries in full.
 */
export function TodayAgeingTile({ data }: { data: NonNullable<AgeingToday> }) {
  const { t } = useT();
  return (
    <section aria-labelledby="today-ageing" data-testid="today-ageing" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-ageing" className="m-0 text-[17px] font-semibold">
          {t("today.oven.title")}
        </h2>
        <UiLink to="/ageing" className="text-[14px] font-semibold text-foreground underline underline-offset-4">
          {t("today.oven.open")}
        </UiLink>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatusBlock tone="amber" title={t("today.oven.inOven")} meta={t("today.oven.inOvenMeta")} value={data.inOven} countUp={false} href="/ageing" />
        <StatusBlock tone="blue" title={t("today.oven.out")} meta={t("today.oven.outMeta")} value={data.out} countUp={false} href="/ageing" />
        <StatusBlock tone={data.held > 0 ? "red" : "neutral"} title={t("today.oven.held")} meta={t("today.oven.heldMeta")} value={data.held} countUp={false} href="/ageing" />
      </div>
    </section>
  );
}
