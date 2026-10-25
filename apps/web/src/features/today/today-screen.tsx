import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { CloudOff } from "lucide-react";
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";

import { TodaySpectroInbox } from "@/features/foundry/today-inbox";
import { TodayAgeingTile } from "@/features/ageing/today-tile";
import { TodayPressTile } from "@/features/press/today-tile";
import { TodayOldStockTile } from "@/features/reports/today-old-stock";
import { Can } from "@/shared/components/can";
import { canAny, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META, refreshFailed, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { TodayTiles, TodayTilesSkeleton } from "./action-tiles";
import { ChartsBoundary } from "./charts-boundary";
import { TodayKpis, TodayKpisSkeleton } from "./kpis";
import { OpenDispatches } from "./open-dispatches";
import { PrintProblems } from "./print-problems";
import { RecentSessions } from "./recent-sessions";
import { StartHere } from "./start-here";
import {
  DEFAULT_TIMEZONE,
  clockTime,
  companyClock,
  greetingKey,
  needsStartHere,
  productionDayCaption,
  todaySections,
  todayTiles,
  type TodayData,
} from "./today-model";
import { TodaySectionSkeleton } from "./today-section";

/** The chart kit (and d3) loads only for analytics.view roles, never in the entry chunk. */
const TodayCharts = lazy(() => import("./today-charts"));

/**
 * A floor screen stays current: the numbers refresh every minute and on focus
 * (ruling T19: a Today left open on the office monitor must not show the
 * morning's numbers at 4 pm; one 8-statement read per open screen a minute).
 */
const REFRESH_MS = 60_000;

/** Wall-clock time that ticks each minute, so the greeting and date roll over on an open screen. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Charts' loading shape: same columns as TodayCharts and roughly the cards' real heights. */
function ChartsSkeleton() {
  return (
    <div aria-hidden="true" className="@container min-w-0">
      <div className="grid grid-cols-1 gap-4 @[56rem]:grid-cols-3">
        <Skeleton className="h-[398px] rounded-card @[56rem]:col-span-2" />
        <Skeleton className="h-[398px] rounded-card" />
      </div>
    </div>
  );
}

/** The two lists: one column until the content column is wide enough for two (not the viewport: the sidebar takes 272 px from 1024). */
function ListsGrid({ pair, children }: { pair: boolean; children: ReactNode }) {
  return (
    <div className="@container min-w-0">
      <div className={cn("grid min-w-0 grid-cols-1 items-start gap-4", pair && "@[56rem]:grid-cols-2")}>{children}</div>
    </div>
  );
}

/**
 * Today (`/today`, spec §3 Today, plan Task 19): greeting and the plant's
 * date, then the day's numbers as status blocks (the screen's one loud
 * element), shortcuts by role, print problems, open dispatches and today's
 * packing sessions, and for analytics.view roles the 90-day trend and stock
 * age. A plant with no die or no bundle yet gets "Start here" instead.
 */
export function TodayScreen() {
  const { t, locale } = useT();
  const { data: me } = useMe();
  const today = useQuery({
    ...trpc.dashboard.today.queryOptions(),
    refetchInterval: REFRESH_MS,
    meta: INLINE_ERROR_META,
  });
  const now = useMinuteClock();

  const configured = me?.company?.settings?.timezone;
  const timezone = today.data?.timezone ?? (typeof configured === "string" && configured ? configured : DEFAULT_TIMEZONE);
  const clock = companyClock(timezone, now, locale);
  const name = me?.user.name?.trim() || me?.user.email || "";
  // Lists follow the modules, and a viewer's KPI-only answer has none (todaySections, scope).
  const sections = todaySections(me, today.data?.scope);

  // Same number of tile placeholders as real tiles (none for viewers), so nothing jumps on load.
  const tileCount = todayTiles(me).length;
  // A failed background refresh keeps the last numbers (React Query v5 keeps data on a failed
  // refetch) and says so in one quiet line. The status region is always mounted so the change
  // is announced.
  const header = (
    <div className="flex min-w-0 flex-col">
      <PageHeader title={t(greetingKey(clock.hour), { name })} subtitle={clock.date} />
      {today.data ? <DayCaption data={today.data} timezone={timezone} now={now} /> : null}
      <div role="status">
        {refreshFailed(today) ? (
          <div
            data-testid="today-refresh-failed"
            className="mt-4 flex min-w-0 items-center gap-3 rounded-card border border-border bg-card py-1 pr-1 pl-4"
          >
            <CloudOff aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} />
            <p className="m-0 min-w-0 flex-1 py-2 text-[14px] leading-5 text-muted-foreground break-words">
              {t("today.refreshFailed", { time: clockTime(timezone)(today.dataUpdatedAt) })}
            </p>
            <Button
              variant="ghost"
              className="shrink-0 px-3.5 text-[14px]"
              disabled={today.isFetching}
              onClick={() => void today.refetch()}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );

  // The error card only when there is nothing to show; a failed refresh keeps the screen.
  if (showsQueryError(today)) {
    return (
      <>
        {header}
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("today.loadErrorTitle")}
            body={t("today.loadErrorBody")}
            action={
              <Button variant="secondary" onClick={() => void today.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
        <TodayTiles />
      </>
    );
  }

  const data = today.data;

  if (data === undefined) {
    return (
      <>
        {header}
        <div aria-busy="true" className="flex flex-col gap-5">
          <span className="sr-only">{t("common.loading")}</span>
          <TodayKpisSkeleton />
          {tileCount > 0 ? <TodayTilesSkeleton count={tileCount} /> : null}
          <ListsGrid pair={sections.dispatches && sections.sessions}>
            {sections.dispatches ? <TodaySectionSkeleton /> : null}
            {sections.sessions ? <TodaySectionSkeleton /> : null}
          </ListsGrid>
        </div>
      </>
    );
  }

  if (needsStartHere(data.setup)) {
    return (
      <>
        {header}
        <StartHere setup={data.setup} />
      </>
    );
  }

  return (
    <>
      {header}
      <TodayKpis data={data} />
      {data.pressedToday && canAny(me, ["press.run", "press.close"]) ? <TodayPressTile data={data.pressedToday} alerts={data.pressAlerts} /> : null}
      {data.ageing ? <TodayAgeingTile data={data.ageing} /> : null}
      <Can do="cast.enter">
        <TodaySpectroInbox />
      </Can>
      <TodayTiles tiles={data.tiles} startIndex={3} />
      <PrintProblems failed={data.failedPrintJobs} />
      {sections.dispatches || sections.sessions ? (
        <ListsGrid pair={sections.dispatches && sections.sessions}>
          {sections.dispatches ? <OpenDispatches data={data} /> : null}
          {sections.sessions ? <RecentSessions data={data} /> : null}
        </ListsGrid>
      ) : null}
      <Can do="analytics.view">
        <TodayOldStockTile />
        <ChartsBoundary>
          <Suspense fallback={<ChartsSkeleton />}>
            <TodayCharts
              live={{
                date: data.date,
                packedG: data.packedToday.weightG,
                dispatchedG: data.dispatchedToday.weightG,
                // m-1: the same server figures as the In stock KPI, never summed here.
                stockBundles: data.kpis.inStockBundles,
                stockKg: data.kpis.inStockG / 1000,
              }}
            />
          </Suspense>
        </ChartsBoundary>
      </Can>
    </>
  );
}

/**
 * The production day these numbers cover (FP-PF-05): "Production day 24 Oct, from 08:00" (or "from
 * midnight" until shifts are saved), the calendar date and plant clock, the shift running now, and
 * when the calendar date is a day ahead of the production day, why (before shift 1 starts).
 */
function DayCaption({ data, timezone, now }: { data: TodayData; timezone: string; now: number }) {
  const { t, locale } = useT();
  const caption = productionDayCaption(data.productionDay, timezone, locale, now);
  return (
    <div className="mt-3 flex min-w-0 flex-col gap-1" data-testid="production-day">
      <p className="m-0 font-display text-[19px] leading-snug font-bold tracking-[-0.02em] break-words sm:text-[22px]" data-testid="production-day-caption">
        {caption.from
          ? t("today.productionDay", { date: caption.day, time: caption.from })
          : t("today.productionDayMidnight", { date: caption.day })}
      </p>
      <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-muted-foreground">
        <span>{t("today.calendarDate", { date: caption.calendar })}</span>
        <span className="tabular-nums">{t("today.clockNow", { time: clockTime(timezone)(now) })}</span>
        {caption.shiftName ? <Chip tone="blue">{caption.shiftName}</Chip> : null}
      </p>
      {caption.beforeStart && caption.from ? (
        <p className="m-0 text-[13px] leading-5 text-muted-foreground" data-testid="production-day-note">
          {t("today.beforeStart", { time: caption.from })}
        </p>
      ) : null}
    </div>
  );
}
