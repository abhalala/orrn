import { dispatchTone, formatKgTotal, type DispatchStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { BigNumber } from "@orrn/ui/components/big-number";
import { cn } from "@orrn/ui/lib/utils";

import { formatDay, formatShipDate } from "./format";

export type DispatchHeaderProps = {
  code: string;
  status: DispatchStatus;
  customerName: string;
  shipDate: string | Date | null;
  completedAt: string | Date | null;
  bundles: number;
  weightG: number;
  timeZone: string;
  /** Plays the dispatch-done moment (pop + one shimmer). Change the key to replay. */
  celebrate?: boolean;
};

/**
 * The dispatch's one loud element: a hero block whose colour IS the status
 * (amber building, blue held, green dispatched, red cancelled), with the
 * status word written on it, the code as the page title, the customer, the
 * ship date and the two numbers that matter on the floor: bundles and kg.
 */
export function DispatchHeader({
  code,
  status,
  customerName,
  shipDate,
  completedAt,
  bundles,
  weightG,
  timeZone,
  celebrate,
}: DispatchHeaderProps) {
  const { t, locale } = useT();
  const ship = formatShipDate(shipDate, { locale });
  const done = status === "completed" ? formatDay(completedAt, { locale, timeZone }) : null;
  const when = done
    ? t("dispatch.detail.dispatchedOn", { date: done })
    : ship
      ? t("dispatch.detail.shipOn", { date: ship })
      : t("dispatch.detail.noShipDate");

  return (
    <section
      aria-labelledby="dispatch-title"
      data-slot="dispatch-hero"
      data-status={status}
      className={cn(
        "orrn-block orrn-block-hero orrn-block-sheen flex min-w-0 flex-col gap-6 p-5 sm:p-6",
        `orrn-block-${dispatchTone(status)}`,
        celebrate && "animate-pop animate-shimmer",
      )}
    >
      <div className="relative flex min-w-0 flex-col gap-1">
        <p className="m-0 text-[15px] font-semibold">{t(`status.dispatch.${status}`)}</p>
        <h1
          id="dispatch-title"
          data-no-truncate=""
          className="m-0 font-mono text-[34px] leading-[1.05] font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-[40px]"
        >
          {code}
        </h1>
        <p className="m-0 mt-1 font-display text-[19px] leading-snug font-bold tracking-[-0.015em] break-words sm:text-[21px]">
          {customerName}
        </p>
        <p className="m-0 text-[14px] font-medium">{when}</p>
      </div>
      <dl className="relative m-0 flex flex-wrap gap-x-10 gap-y-3 sm:gap-x-12">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-[13px] font-semibold">{t("dispatch.columns.bundles")}</dt>
          <dd className="m-0">
            <BigNumber data-testid="dispatch-bundles" value={bundles} className="text-[40px] sm:text-[52px]" />
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-[13px] font-semibold">{t("units.kg")}</dt>
          <dd className="m-0">
            <BigNumber
              data-testid="dispatch-kg"
              value={weightG / 1000}
              format={formatKgTotal}
              className="text-[40px] sm:text-[52px]"
            />
          </dd>
        </div>
      </dl>
    </section>
  );
}
