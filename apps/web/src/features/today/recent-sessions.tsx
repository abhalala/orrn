import { useT } from "@orrn/i18n";
import { UiLink } from "@orrn/ui/components/link";
import { cn } from "@orrn/ui/lib/utils";
import { useMemo } from "react";

import { Can } from "@/shared/components/can";

import { clockTime, sessionSummary, type TodayData } from "./today-model";
import { TodayEmptyAction, TodayEmptyRows, TodayRows, TodaySection, rowLinkClass, rowNameClass } from "./today-section";

/**
 * Today's packing sessions (newest first, up to 10): session code, die,
 * bundles and kg (void bundles left out, RP11; "All bundles void" when
 * nothing is left) and the time it was saved, on the plant's clock.
 */
export function RecentSessions({ data }: { data: TodayData }) {
  const { t } = useT();
  const time = useMemo(() => clockTime(data.timezone), [data.timezone]);
  const rows = data.recentSessions;
  return (
    <TodaySection
      testId="today-sessions"
      title={t("today.sessionsTodayHeading")}
      more={{ to: "/pack", label: t("today.allSessions") }}
    >
      {rows.length === 0 ? (
        <TodayEmptyRows
          title={t("today.noSessionsToday")}
          body={t("today.noSessionsTodayBody")}
          action={
            <Can do="bundle.create">
              <TodayEmptyAction to="/pack/new" label={t("pack.newSession")} />
            </Can>
          }
        />
      ) : (
        <TodayRows>
          {rows.map((s) => {
            const summary = sessionSummary(s);
            return (
              <li key={s.id}>
                <UiLink to={`/pack/${encodeURIComponent(s.id)}`} className={rowLinkClass}>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-mono text-[15px] leading-6 font-semibold tabular-nums [overflow-wrap:anywhere]">
                      {s.code}
                    </span>
                    <span title={s.dieLabel} className={rowNameClass}>
                      {s.dieLabel}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    <span
                      data-no-truncate=""
                      className={cn(
                        "text-[13px] leading-5 font-semibold",
                        s.bundles > 0 ? "font-mono tabular-nums" : "text-muted-foreground",
                      )}
                    >
                      {t(summary.key, summary.vars)}
                    </span>
                    <time dateTime={s.createdAt} className="font-mono text-[13px] leading-5 tabular-nums text-muted-foreground">
                      {time(s.createdAt)}
                    </time>
                  </span>
                </UiLink>
              </li>
            );
          })}
        </TodayRows>
      )}
    </TodaySection>
  );
}
