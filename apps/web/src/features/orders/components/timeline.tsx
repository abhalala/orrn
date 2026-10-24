import { useT } from "@orrn/i18n";

import { dayTimeText } from "../format";
import { useCompanyTimeZone } from "../hooks";
import { timelineLabel, type TimelineEvent } from "../view";

/** What happened to an order, oldest first: each audit action worded in the person's language. */
export function Timeline({ events }: { events: readonly TimelineEvent[] }) {
  const { t, locale } = useT();
  const zone = useCompanyTimeZone();
  if (events.length === 0) return <p className="m-0 text-[14px] text-muted-foreground">{t("orders.detail.timelineEmpty")}</p>;
  return (
    <ol className="m-0 flex list-none flex-col p-0" aria-label={t("orders.detail.timeline")}>
      {events.map((ev, index) => {
        const label = timelineLabel(ev);
        return (
          <li key={ev.id} className="relative flex gap-3 pb-4 last:pb-0" data-timeline={ev.action}>
            {index < events.length - 1 ? <span aria-hidden="true" className="absolute top-3 bottom-0 left-[5px] w-px bg-border" /> : null}
            <span aria-hidden="true" className="relative mt-1.5 size-2.5 shrink-0 rounded-full bg-foreground" />
            <div className="min-w-0">
              <p className="m-0 text-[15px] font-semibold leading-5 break-words">{t(label.key, label.vars)}</p>
              <p className="m-0 text-[13px] leading-5 text-muted-foreground">
                {dayTimeText(ev.at, locale, zone)}
                {ev.actorName ? ` · ${ev.actorName}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
