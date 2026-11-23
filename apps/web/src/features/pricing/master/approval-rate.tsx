import { useT } from "@orrn/i18n";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";

import { useFmt } from "@/shared/lib/fmt";
import { rateText } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { rateName, rateQuoted } from "./rate-words";
import type { RateItem } from "./rate-model";

/**
 * What an approver reads on a `price_change` request: the rate now and the rate asked, and the date it starts
 * (a master rate), or the rate the master gives against the rate asked (a line). Read live from
 * `pricing.rates.get`, so the money never sits in the approval's own meta. Only for people who hold `price.view`.
 */
export function PriceChangeFigures({ rateId }: { rateId: string }) {
  const { t } = useT();
  const fmt = useFmt();
  const rate = useQuery({ ...trpc.pricing.rates.get.queryOptions({ id: rateId }), meta: INLINE_ERROR_META });

  const rows: { label: string; value: string }[] = [];
  const data = rate.data;
  if (data) {
    const item: RateItem = {
      kind: data.rate.kind,
      key: data.rate.key,
      name: data.rate.name,
      current: null,
      pending: [{ id: data.rate.id, paise: data.rate.paise, effectiveFrom: data.rate.effectiveFrom, status: data.rate.status, detail: data.rate.detail, reason: data.rate.reason }],
      upcoming: [],
    };
    const money = (paise: number) => rateQuoted(t, item, rateText(fmt, paise));
    if (data.line) {
      rows.push({ label: t("price.approval.order"), value: t("price.approval.orderValue", { order: data.line.orderNumber, line: data.line.lineNo }) });
      if (data.line.computedPaisePerKg !== null) rows.push({ label: t("price.approval.computed"), value: money(data.line.computedPaisePerKg) });
      rows.push({ label: t("price.approval.askedLine"), value: money(data.rate.paise) });
    } else {
      rows.push({ label: t("price.approval.what"), value: rateName(t, item) });
      rows.push({ label: t("price.approval.now"), value: data.replaces ? money(data.replaces.paise) : t("price.approval.noBefore") });
      rows.push({ label: t("price.approval.asked"), value: money(data.rate.paise) });
      rows.push({ label: t("price.approval.startsOn"), value: fmt.day(data.rate.effectiveFrom) });
    }
  }

  return (
    <section className="flex flex-col gap-2" data-testid="price-change-figures">
      <h3 className="m-0 text-[14px] font-semibold">{t("price.approval.title")}</h3>
      {rate.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <p role="alert" className="m-0 text-[14px] text-muted-foreground">
          {t("price.approval.loadFailed")}
        </p>
      ) : (
        <dl className="m-0 flex flex-col divide-y divide-border rounded-card border border-border px-4">
          {rows.map((r) => (
            <div key={r.label} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 py-2 text-[15px]">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="m-0 min-w-0 text-right font-medium tabular-nums break-words">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
