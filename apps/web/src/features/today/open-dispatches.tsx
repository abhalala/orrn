import { dispatchTone, formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";

import { formatCount, type TodayData } from "./today-model";
import { TodayEmptyRows, TodayRows, TodaySection, rowLinkClass } from "./today-section";

/**
 * Dispatches being built or held (newest first, up to 10): code, customer,
 * status word on its colour, bundles and kg so far. Each row opens the
 * dispatch.
 */
export function OpenDispatches({ data }: { data: TodayData }) {
  const { t } = useT();
  const rows = data.openDispatches;
  return (
    <TodaySection
      testId="today-open-dispatches"
      title={t("today.openDispatches")}
      more={{ to: "/dispatch", label: t("today.allDispatches") }}
    >
      {rows.length === 0 ? (
        <TodayEmptyRows title={t("today.noOpenDispatches")} body={t("today.noOpenDispatchesBody")} />
      ) : (
        <TodayRows>
          {rows.map((d) => (
            <li key={d.id}>
              <UiLink to={`/dispatch/${encodeURIComponent(d.id)}`} className={rowLinkClass}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-mono text-[15px] leading-6 font-semibold tabular-nums [overflow-wrap:anywhere]">
                    {d.code}
                  </span>
                  <span title={d.customerName} className="truncate text-[13px] leading-5 text-muted-foreground">
                    {d.customerName}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  <Chip tone={dispatchTone(d.status)}>{t(`status.dispatch.${d.status}`)}</Chip>
                  <span data-no-truncate="" className="font-mono text-[13px] leading-5 tabular-nums text-muted-foreground">
                    {t("units.bundlesKg", { bundles: formatCount(d.bundles), kg: formatKgTotal(d.weightG / 1000) })}
                  </span>
                </span>
              </UiLink>
            </li>
          ))}
        </TodayRows>
      )}
    </TodaySection>
  );
}
