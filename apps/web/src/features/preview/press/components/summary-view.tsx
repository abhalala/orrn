import { formatKgTotal, gToKg } from "@orrn/domain";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { Link } from "@tanstack/react-router";

import { LINE, PRODUCTION_DAY, reasonLabel } from "../fixtures";
import { usePressDemo } from "../store";
import { ScreenLinks } from "./chrome";

export function SummaryView() {
  const demo = usePressDemo();
  const logged = demo.pr42.phase === "logged" ? demo.pr42.logged : null;
  const recovery = logged ? Number((logged.recoveryBp / 100).toFixed(1)) : null;
  const stops = logged ? groupStops(logged.downtimeRows) : [];
  const totalStop = stops.reduce((sum, row) => sum + row.minutes, 0);

  return (
    <>
      <ScreenLinks current="summary" />
      <header className="flex min-w-0 flex-col gap-1">
        <h2 className="m-0 font-display text-[28px] font-extrabold leading-none tracking-[-0.03em]">
          Day, from 08:00
        </h2>
        <p className="m-0 text-[15px] text-muted-foreground">
          {PRODUCTION_DAY} · {LINE.name} · one line. Day opens the production day at 08:00, not midnight.
        </p>
      </header>

      {logged && recovery !== null ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatusBlock
            tone="green"
            title="Good"
            meta="Logged"
            value={gToKg(logged.goodG)}
            unit="kg"
            format={formatKgTotal}
            countUp={false}
          />
          <StatusBlock
            tone="blue"
            title="Recovery"
            meta="Calculated, not entered"
            value={recovery}
            unit="%"
            format={(n) => n.toFixed(1)}
            countUp={false}
          />
          <StatusBlock
            tone="amber"
            title="Downtime"
            meta={logged.downtimeCodes.join(", ") || "None"}
            value={logged.downtimeMin}
            unit="min"
            countUp={false}
          />
        </div>
      ) : (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState
            title="Nothing logged for this day"
            body="Log a run on the station. This page does not invent a recovery."
            action={
              <Button asChild variant="secondary">
                <Link to="/preview/press/console" search={{ run: "PR-42" }}>
                  Open the station
                </Link>
              </Button>
            }
          />
        </div>
      )}

      <p className="m-0 text-[15px] font-medium leading-6">Recovery is calculated. It is not entered.</p>

      <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-5">
        <div>
          <h2 className="m-0 text-[15px] font-semibold">Stoppages · {LINE.name}</h2>
          <p className="m-0 mt-1 text-[13px] leading-5 text-muted-foreground">
            Stops, longest first. The press report lists runs. It does not draw this.
          </p>
        </div>
        {stops.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {stops.map((row) => (
              <li key={row.reason} className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-mono text-[14px]">{row.reason}</span>
                  <span className="text-[13px] text-muted-foreground">{reasonLabel(row.reason)}</span>
                  <span className="ml-auto tabular-nums">{row.minutes} min</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-2 rounded-full bg-foreground"
                    style={{ width: `${Math.max(8, (row.minutes / totalStop) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[14px] text-muted-foreground">No stoppage on a logged run yet.</p>
        )}
      </section>

      <div>
        <Button asChild variant="secondary">
          <Link to="/preview/press/report">Press report</Link>
        </Button>
      </div>
    </>
  );
}

function groupStops(rows: { reason: string; minutes: number }[]): { reason: string; minutes: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.reason, (totals.get(row.reason) ?? 0) + row.minutes);
  return [...totals.entries()]
    .map(([reason, minutes]) => ({ reason, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}
