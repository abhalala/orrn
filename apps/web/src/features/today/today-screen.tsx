import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useState } from "react";

import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { TodayTiles } from "./action-tiles";
import { TodayKpis, TodayKpisSkeleton } from "./kpis";
import { OpenDispatches } from "./open-dispatches";
import { PrintProblems } from "./print-problems";
import { RecentSessions } from "./recent-sessions";
import { StartHere } from "./start-here";
import { DEFAULT_TIMEZONE, companyClock, greetingKey, needsStartHere, todayTiles } from "./today-model";
import { TodaySectionSkeleton } from "./today-section";

/** The chart kit (and d3) loads only for analytics.view roles, never in the entry chunk. */
const TodayCharts = lazy(() => import("./today-charts"));

/** A floor screen stays current: the numbers refresh every minute and on focus. */
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

function ChartsSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Skeleton className="h-[372px] rounded-card lg:col-span-2" />
      <Skeleton className="h-[372px] rounded-card" />
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

  // Same number of tile placeholders as real tiles (none for viewers), so nothing jumps on load.
  const tileCount = todayTiles(me).length;
  const header = <PageHeader title={t(greetingKey(clock.hour), { name })} subtitle={clock.date} />;

  if (today.isPending) {
    return (
      <>
        {header}
        <div aria-busy="true" className="flex flex-col gap-5">
          <span className="sr-only">{t("common.loading")}</span>
          <TodayKpisSkeleton />
          {tileCount > 0 ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: tileCount }, (_, i) => (
                <Skeleton key={i} className="min-h-[128px] rounded-block" />
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TodaySectionSkeleton />
            <TodaySectionSkeleton />
          </div>
        </div>
      </>
    );
  }

  if (today.isError) {
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
      <TodayTiles openCount={data.openDispatchCount} startIndex={3} />
      <PrintProblems failed={data.failedPrintJobs} />
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <OpenDispatches data={data} />
        <RecentSessions data={data} />
      </div>
      <Can do="analytics.view">
        <Suspense fallback={<ChartsSkeleton />}>
          <TodayCharts />
        </Suspense>
      </Can>
    </>
  );
}
