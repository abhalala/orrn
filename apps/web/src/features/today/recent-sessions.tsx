import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { UiLink } from "@orrn/ui/components/link";
import { useMemo } from "react";

import { formatCount, type TodayData } from "./today-model";
import { TodayEmptyRows, TodayRows, TodaySection, rowLinkClass } from "./today-section";

/** 24h clock time on the plant's wall clock ("14:05"). */
function useClockTime(timezone: string) {
  return useMemo(() => {
    let format: Intl.DateTimeFormat;
    try {
      format = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone });
    } catch {
      format = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    }
    return (iso: string) => format.format(new Date(iso));
  }, [timezone]);
}

/**
 * Today's packing sessions (newest first, up to 10): session code, die,
 * bundles and kg (void bundles left out, RP11) and the time it was saved.
 */
export function RecentSessions({ data }: { data: TodayData }) {
  const { t } = useT();
  const time = useClockTime(data.timezone);
  const rows = data.recentSessions;
  return (
    <TodaySection
      testId="today-sessions"
      title={t("today.sessionsTodayHeading")}
      more={{ to: "/pack", label: t("today.allSessions") }}
    >
      {rows.length === 0 ? (
        <TodayEmptyRows title={t("today.noSessionsToday")} body={t("today.noSessionsTodayBody")} />
      ) : (
        <TodayRows>
          {rows.map((s) => (
            <li key={s.id}>
              <UiLink to={`/pack/${encodeURIComponent(s.id)}`} className={rowLinkClass}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-mono text-[15px] leading-6 font-semibold tabular-nums [overflow-wrap:anywhere]">
                    {s.code}
                  </span>
                  <span title={s.dieLabel} className="truncate text-[13px] leading-5 text-muted-foreground">
                    {s.dieLabel}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  <span data-no-truncate="" className="font-mono text-[13px] leading-5 font-semibold tabular-nums">
                    {t("units.bundlesKg", { bundles: formatCount(s.bundles), kg: formatKgTotal(s.weightG / 1000) })}
                  </span>
                  <time dateTime={s.createdAt} className="font-mono text-[13px] leading-5 tabular-nums text-muted-foreground">
                    {time(s.createdAt)}
                  </time>
                </span>
              </UiLink>
            </li>
          ))}
        </TodayRows>
      )}
    </TodaySection>
  );
}
