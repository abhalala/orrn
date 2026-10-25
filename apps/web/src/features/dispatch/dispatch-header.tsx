import { dispatchTone, type DispatchStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { BigNumber } from "@orrn/ui/components/big-number";
import { cn } from "@orrn/ui/lib/utils";

import { dispatchKgText, formatYmdDay } from "./format";

export type DispatchHeaderProps = {
  code: string;
  status: DispatchStatus;
  customerName: string;
  /** The server's one ship day (BACKLOG 80): the day it left once completed, else the planned day. */
  shipDay: { ymd: string; kind: "dispatched" | "ship" } | null;
  bundles: number;
  weightG: number;
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
  shipDay,
  bundles,
  weightG,
  celebrate,
}: DispatchHeaderProps) {
  const { t, locale } = useT();
  const day = formatYmdDay(shipDay?.ymd, { locale });
  const when = day
    ? shipDay?.kind === "dispatched"
      ? t("dispatch.detail.dispatchedOn", { date: day })
      : t("dispatch.detail.shipOn", { date: day })
    : t("dispatch.detail.noShipDate");

  return (
    <section
      aria-labelledby="dispatch-title"
      data-slot="dispatch-hero"
      data-status={status}
      className={cn(
        // Phones stack the numbers under the name; wider screens put them on the right so the
        // block stays short and the bundles list starts higher.
        "orrn-block orrn-block-hero orrn-block-sheen flex min-w-0 flex-col gap-6 p-5 sm:p-6 md:flex-row md:items-end md:justify-between md:gap-8",
        `orrn-block-${dispatchTone(status)}`,
        celebrate && "animate-pop animate-shimmer",
      )}
    >
      <div className="relative flex min-w-0 flex-col gap-1 md:flex-1">
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
      <dl className="relative m-0 flex shrink-0 flex-wrap gap-x-10 gap-y-3 sm:gap-x-12 md:flex-nowrap">
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
              format={(kg) => dispatchKgText(Math.round(kg * 1000))}
              className="text-[40px] sm:text-[52px]"
            />
          </dd>
        </div>
      </dl>
    </section>
  );
}
