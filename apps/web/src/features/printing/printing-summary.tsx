import { useT } from "@orrn/i18n";
import type { StatusTone } from "@orrn/domain";
import { Button } from "@orrn/ui/components/button";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { formatAgo } from "@/features/admin/format";
import { trpc } from "@/shared/utils/trpc";

import { PRINT_PAGE_SIZE, printSummary, type PrintStatus, type PrintTab } from "./model";
import { PRINT_COMPUTER_REFRESH_MS, printComputerState } from "./print-computer";

const DOT: Record<StatusTone, string> = {
  green: "bg-tone-green",
  blue: "bg-tone-blue",
  amber: "bg-tone-amber",
  red: "bg-tone-red",
  neutral: "border border-input",
};

const COMPUTER_TONE = { online: "green", offline: "red", never: "amber", none: "neutral" } as const satisfies Record<string, StatusTone>;

const ITEM =
  "animate-press flex h-full min-h-[88px] min-w-0 flex-col justify-between gap-2 rounded-card border p-3.5 text-foreground no-underline transition-[background-color,border-color,scale] duration-[var(--dur-fast)] sm:p-4";

/**
 * The strip above the Printing tabs: what needs a retry, what is waiting, what went to the printer, what printed, and
 * whether the print computer is reporting in. Built from `spool.queue` (its per-status counts; the same query as the
 * Queue tab's first page) and `edge.overview`. Each item opens the tab and filter that lists what it counts.
 */
export function PrintingSummary({ tab, status, now }: { tab: PrintTab; status: PrintStatus | undefined; now: number }) {
  const { t, locale } = useT();
  const queue = useQuery({
    ...trpc.spool.queue.queryOptions({ limit: PRINT_PAGE_SIZE, offset: 0 }),
    refetchInterval: PRINT_COMPUTER_REFRESH_MS,
  });
  const nodes = useQuery({ ...trpc.edge.overview.queryOptions(), refetchInterval: PRINT_COMPUTER_REFRESH_MS });

  const items = queue.data ? printSummary(queue.data.counts) : null;
  const computer = nodes.data ? printComputerState(nodes.data.nodes, now) : null;

  let counts: ReactNode;
  if (items) {
    counts = items.map((item) => {
      const active = tab === "queue" && status === item.status;
      // The one loud element: jobs that need a retry, while there are any.
      const loud = item.key === "retry" && item.count > 0;
      return (
        <li key={item.key} className="min-w-0">
          <Link
            to="/printing"
            search={{ status: item.status }}
            data-summary={item.key}
            data-tone={item.tone}
            className={cn(
              ITEM,
              loud ? "border-transparent bg-tone-red-tint text-tone-red-ink" : "border-border bg-card hover:bg-surface-sunken",
              active && "border-foreground",
            )}
          >
            <span className={cn("flex min-w-0 items-center gap-2 text-[13px] font-medium", loud ? "text-tone-red-ink" : "text-muted-foreground")}>
              <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", loud ? "bg-current" : DOT[item.tone])} />
              <span className="min-w-0 break-words">{t(`printing.summary.${item.key}`)}</span>
            </span>
            <span className={cn("font-display text-[28px] leading-none font-bold tabular-nums", item.count === 0 && !loud && "text-muted-foreground")}>
              {item.count.toLocaleString("en-IN")}
            </span>
          </Link>
        </li>
      );
    });
  } else if (queue.isError) {
    counts = (
      <li className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card p-4 sm:col-span-3 lg:col-span-4">
        <p role="alert" className="m-0 text-[14px] text-muted-foreground">
          {t("printing.summary.countsFailed")}
        </p>
        <Button variant="secondary" size="sm" onClick={() => void queue.refetch()}>
          {t("common.retry")}
        </Button>
      </li>
    );
  } else {
    counts = (["retry", "waiting", "sent", "printed"] as const).map((key) => (
      <li key={key} aria-hidden="true" className={cn(ITEM, "border-border bg-card")}>
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-7 w-12" />
      </li>
    ));
  }

  const computerActive = tab === "printers";
  return (
    <section aria-labelledby="printing-summary-title" data-testid="printing-summary" aria-busy={!items && !queue.isError ? true : undefined}>
      <h2 id="printing-summary-title" className="sr-only">
        {t("printing.summary.label")}
      </h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        {counts}
        <li className="col-span-2 min-w-0 lg:col-span-1">
          {computer || nodes.isError ? (
            <Link
              to="/printing"
              search={{ tab: "printers" }}
              data-summary="computer"
              data-state={computer?.kind ?? "error"}
              className={cn(ITEM, "border-border bg-card hover:bg-surface-sunken", computerActive && "border-foreground")}
            >
              <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-muted-foreground">
                <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[computer ? COMPUTER_TONE[computer.kind] : "neutral"])} />
                <span className="min-w-0 break-words">{t("printing.summary.computer")}</span>
              </span>
              {computer ? (
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[17px] leading-6 font-semibold break-words">
                    {t(
                      computer.kind === "online"
                        ? "printing.summary.online"
                        : computer.kind === "offline"
                          ? "printing.summary.offline"
                          : computer.kind === "never"
                            ? "printing.summary.never"
                            : "printing.summary.notSetUp",
                    )}
                  </span>
                  <span className="text-[13px] leading-5 break-words text-muted-foreground">
                    {computer.kind === "online"
                      ? t("printing.summary.reported", { time: formatAgo(computer.at, { now: new Date(now), locale }) })
                      : computer.kind === "offline"
                        ? t("printing.summary.offlineSince", { time: formatAgo(computer.since, { now: new Date(now), locale }) })
                        : computer.kind === "never"
                          ? t("printing.summary.neverHint")
                          : t("printing.summary.notSetUpHint")}
                  </span>
                </span>
              ) : (
                <span className="text-[14px] leading-6 break-words text-muted-foreground">{t("printing.summary.computerFailed")}</span>
              )}
            </Link>
          ) : (
            <div aria-hidden="true" className={cn(ITEM, "border-border bg-card")}>
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-5 w-20" />
            </div>
          )}
        </li>
      </ul>
    </section>
  );
}
