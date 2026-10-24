import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { lazy, Suspense } from "react";

import { Can } from "@/shared/components/can";

import { PercentChip } from "./drift-chips";
import { milliKgText, shortDateTime } from "./die-room-model";
import type { CardData } from "./types";

const ReadingTrend = lazy(() => import("./reading-trend").then((mod) => ({ default: mod.ReadingTrend })));

/** Readings, newest first, each chipped by the server against the copy's band. */
export function ReadingsPanel({ card, onAdd }: { card: CardData; onAdd(): void }) {
  const { t } = useT();
  const trial = card.instance.trialKgPer12ftMilli;
  // The chart reads left to right in time; the list shows the newest first.
  const points = [...card.readings].reverse().map((r) => r.kgPer12ftMilli / 1000);

  if (card.readings.length === 0 && trial == null) {
    return (
      <EmptyState
        title={t("dieRoom.reading.empty")}
        body={t("dieRoom.reading.emptyBody")}
        action={
          <Can do="die.reading">
            <Button onClick={onAdd} disabled={card.instance.status === "retired"}>
              {t("dieRoom.reading.add")}
            </Button>
          </Can>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {points.length >= 2 ? (
        // Inset by the dot radius so the newest point is never clipped at the screen edge.
        <div className="px-3">
          <Suspense fallback={<div className="h-16 rounded-card bg-surface-sunken" aria-busy="true" />}>
            <ReadingTrend points={points} label={t("dieRoom.reading.trendLabel")} />
          </Suspense>
        </div>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-3 p-0" data-testid="readings-list">
        {card.readings.map((row) => (
          <li key={row.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-card border border-border bg-card p-4">
            <span data-no-truncate="" className="font-mono text-[16px] font-semibold tabular-nums">
              {milliKgText(row.kgPer12ftMilli)}
            </span>
            <PercentChip tone={row.tone} pctTenth={row.pctTenth} />
            <span className="text-[13px] text-muted-foreground">
              {shortDateTime(row.readAt)}
              {row.pressRunId ? ` · ${row.pressRunId}` : ` · ${t("dieRoom.reading.bench")}`}
            </span>
          </li>
        ))}
        {trial != null ? (
          <li className="rounded-card border border-dashed border-border bg-surface-sunken p-4">
            <p className="m-0 font-mono text-[16px] font-semibold tabular-nums">
              {milliKgText(trial)} {t("units.kgPer12ft")}
            </p>
            <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("dieRoom.reading.trialNote")}</p>
          </li>
        ) : null}
      </ol>
      <Can do="die.reading">
        <Button variant="secondary" onClick={onAdd} disabled={card.instance.status === "retired"}>
          {t("dieRoom.reading.add")}
        </Button>
      </Can>
    </div>
  );
}
