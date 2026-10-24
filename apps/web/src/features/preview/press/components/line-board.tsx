import { formatKg, gToKg } from "@orrn/domain";
import { ActionTile } from "@orrn/ui/components/action-tile";
import { Button } from "@orrn/ui/components/button";
import { Card } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { ListCard, stretchedLink } from "@orrn/ui/components/list-card";
import { Link } from "@tanstack/react-router";
import { FileText, Package, Printer } from "lucide-react";

import {
  ISSUE,
  LINE,
  ORDERS,
  PR43,
  SECTION,
  SHIFTS,
  formatKgG,
  lengthLabel,
  lineStatusLabel,
  orderByNumber,
  theoreticalGoodG,
  todayLoggedG,
} from "../fixtures";
import { usePressDemo } from "../store";
import { ScreenLinks } from "./chrome";

function releasedKgText(pcs: number, cutLengthMm: number): string {
  const g = theoreticalGoodG(pcs, cutLengthMm, SECTION.latestMilli);
  return g === null ? "—" : `${formatKg(gToKg(g))} kg`;
}

export function LineBoard() {
  const demo = usePressDemo();
  const loggedG = todayLoggedG(demo);
  const status = lineStatusLabel(demo);
  const shift = SHIFTS[0];

  return (
    <>
      <ScreenLinks current="board" />
      <Card className="gap-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">{LINE.code}</p>
            <h2 className="m-0 font-display text-[28px] font-extrabold leading-none tracking-[-0.03em]">
              {LINE.name}
            </h2>
            <p className="m-0 mt-1 text-[14px] text-muted-foreground">
              Tonnage not set · {shift.name} {shift.start}–{shift.end}
            </p>
          </div>
          <Chip tone={demo.nothingReleased ? "neutral" : demo.pr42.phase === "logged" ? "green" : "blue"}>
            {status}
          </Chip>
        </div>
        <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-surface-sunken px-4 py-3">
            <dt className="text-xs font-medium text-muted-foreground">On the line</dt>
            <dd className="m-0 mt-1 font-mono text-[22px] font-semibold tabular-nums">{status}</dd>
          </div>
          <div className="rounded-card bg-surface-sunken px-4 py-3">
            <dt className="text-xs font-medium text-muted-foreground">Queue</dt>
            <dd className="m-0 mt-1 font-mono text-[22px] font-semibold tabular-nums">
              {demo.nothingReleased ? 0 : 1}
            </dd>
          </div>
          <div className="rounded-card bg-surface-sunken px-4 py-3">
            <dt className="text-xs font-medium text-muted-foreground">Today, logged</dt>
            <dd className="m-0 mt-1 font-mono text-[22px] font-semibold tabular-nums">
              {loggedG === 0 ? "0 kg" : `${formatKgG(loggedG)} kg`}
            </dd>
          </div>
        </dl>
        <Button
          onClick={() => document.getElementById("press-queue")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          Open the queue
        </Button>
      </Card>

      <section id="press-queue" className="flex min-w-0 flex-col gap-5">
        {demo.nothingReleased ? (
          <div className="rounded-card border border-dashed border-border bg-card">
            <EmptyState
              title="Nothing released"
              body="Nothing released to this line."
              action={
                <Button asChild variant="secondary">
                  <Link to="/preview/orders">Orders & planning</Link>
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <div className="flex min-w-0 flex-col gap-3">
              <h2 className="m-0 text-[15px] font-semibold">On the line</h2>
              <ListCard
                mono
                className="md:max-w-xl"
                title={
                  <Link to="/preview/press/console" search={{ run: "PR-42" }} className={stretchedLink}>
                    PR-42
                  </Link>
                }
                subtitle={`${SECTION.label} · ${ISSUE.copy} issued · ${shift.name} shift`}
                status={
                  <Chip tone={demo.pr42.phase === "logged" ? "green" : "blue"}>
                    {demo.pr42.phase === "logged"
                      ? "Logged"
                      : demo.pr42.phase === "running"
                        ? "Running"
                        : demo.pr42.phase === "stopped"
                          ? "Stopped"
                          : "Counting"}
                  </Chip>
                }
                facts={[
                  { label: "Die copy", value: ISSUE.copy, mono: true },
                  {
                    label: "Orders",
                    value: (
                      <span className="flex flex-col gap-0.5">
                        {demo.pr42.cuts.map((cut) => {
                          const order = orderByNumber(cut.salesOrder);
                          return (
                            <span key={cut.id}>
                              {cut.salesOrder} · {order?.customer}, {order?.city}
                            </span>
                          );
                        })}
                      </span>
                    ),
                  },
                  {
                    label: "Released",
                    value: (
                      <span className="flex flex-col gap-0.5">
                        {demo.pr42.cuts.map((cut) => (
                          <span key={cut.id}>
                            {lengthLabel(cut.cutLengthMm)} × {cut.releasedPcs} pcs ·{" "}
                            {releasedKgText(cut.releasedPcs, cut.cutLengthMm)}
                          </span>
                        ))}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <h2 className="m-0 text-[15px] font-semibold">Queue</h2>
              <ListCard
                mono
                className="md:max-w-xl"
                title={
                  <Link to="/preview/press/console" search={{ run: "PR-43" }} className={stretchedLink}>
                    PR-43
                  </Link>
                }
                subtitle={`${SECTION.label} · Die not issued`}
                status={<Chip tone="amber">Queued</Chip>}
                facts={[
                  { label: "Die copy", value: "Die not issued" },
                  {
                    label: "Orders",
                    value: (
                      <span className="flex flex-col gap-0.5">
                        {PR43.cuts.map((cut) => {
                          const order = orderByNumber(cut.salesOrder);
                          return (
                            <span key={cut.salesOrder}>
                              {cut.salesOrder} · {order?.customer}, {order?.city}
                            </span>
                          );
                        })}
                      </span>
                    ),
                  },
                  {
                    label: "Released",
                    value: (
                      <span className="flex flex-col gap-0.5">
                        {PR43.cuts.map((cut) => (
                          <span key={cut.salesOrder}>
                            {lengthLabel(cut.cutLengthMm)} × {cut.pcs} pcs · {releasedKgText(cut.pcs, cut.cutLengthMm)}
                          </span>
                        ))}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-3">
        <h2 className="m-0 text-[15px] font-semibold">Open a screen</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ActionTile
            tone="ink"
            title="Station"
            hint="PR-42 on the tablet"
            icon={<Package aria-hidden="true" />}
            to="/preview/press/console"
          />
          <ActionTile
            tone="neutral"
            title="Press report"
            hint="Logged runs, ready to print"
            icon={<FileText aria-hidden="true" />}
            to="/preview/press/report"
          />
          <ActionTile
            tone="neutral"
            title="Daily summary"
            hint="Today's three numbers"
            icon={<Printer aria-hidden="true" />}
            to="/preview/press/summary"
          />
        </div>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">
          {ORDERS.map((order) => `${order.short}, ${order.city}`).join(" · ")}. One running run per line.
        </p>
      </section>
    </>
  );
}
