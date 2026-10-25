import { useT } from "@orrn/i18n";
import type { MessageKey } from "@orrn/i18n";
import { ActionTile } from "@orrn/ui/components/action-tile";
import { Button } from "@orrn/ui/components/button";
import { Card } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { FileText, ListChecks, Printer } from "lucide-react";

import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { statusTone } from "./job-card";
import { kgFromG, splitQueue } from "./model";
import type { LineRow, SummaryOut } from "./types";

const REFRESH_MS = 20_000;

/** One press: what is on it, how many wait, what it logged today. */
function LineCard({ line, summary }: { line: LineRow; summary: SummaryOut | undefined }) {
  const { t } = useT();
  const queue = useQuery({
    ...trpc.press.queue.list.queryOptions({ pressLineId: line.id }),
    refetchInterval: REFRESH_MS,
    meta: INLINE_ERROR_META,
  });
  const cards = queue.data?.cards;
  const { onLine, waiting } = splitQueue(cards ?? []);
  const current = onLine[0];
  const today = summary?.byLine.find((l) => l.pressLineId === line.id);

  return (
    <Card className="gap-4" data-slot="press-line" data-line={line.code}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">{line.code}</p>
          <h2 className="m-0 font-display text-[28px] font-extrabold leading-none tracking-[-0.03em]">{line.name}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {line.openDowntime ? (
            <Chip tone="red" truncate={false}>
              {t("press.board.pressStopped")}
            </Chip>
          ) : null}
          {current ? (
            <Chip tone={statusTone(current.status)} truncate={false}>
              {t(`press.console.status.${current.status}` as MessageKey)}
            </Chip>
          ) : (
            <Chip tone="neutral" truncate={false}>
              {t("press.board.nothingRunning")}
            </Chip>
          )}
        </div>
      </div>
      <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-card bg-surface-sunken px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">{t("press.board.onLine")}</dt>
          <dd data-testid="line-on-line" className={current || queue.isPending ? "m-0 mt-1 font-mono text-[22px] font-semibold tabular-nums" : "m-0 mt-1 py-1 text-[17px] font-semibold"}>
            {current ? current.number : queue.isPending ? "…" : t("press.board.nothingRunning")}
          </dd>
        </div>
        <div className="rounded-card bg-surface-sunken px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">{t("press.board.waiting")}</dt>
          <dd data-testid="line-waiting" className="m-0 mt-1 font-mono text-[22px] font-semibold tabular-nums">
            {cards ? waiting.length : "…"}
          </dd>
        </div>
        <div className="rounded-card bg-surface-sunken px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">{t("press.board.todayLogged")}</dt>
          <dd className="m-0 mt-1 font-mono text-[22px] font-semibold tabular-nums">
            {summary ? `${kgFromG(today?.kgG ?? 0)} ${t("units.kg")}` : "…"}
          </dd>
        </div>
      </dl>
      {current ? (
        <p className="m-0 text-[14px] text-muted-foreground">
          <UiLink to={`/press/runs/${current.id}`} className="font-mono font-semibold text-foreground">
            {current.number}
          </UiLink>
          {" · "}
          {current.sectionCode}
          {current.copyCode ? ` · ${current.copyCode}` : ""}
          {current.lines.length > 0 ? ` · ${[...new Set(current.lines.map((l) => l.orderNumber))].join(", ")}` : ""}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <UiLink to={`/press/lines/${line.id}`}>{t("press.board.openQueue")}</UiLink>
        </Button>
        {current ? (
          <Button asChild variant="secondary">
            <UiLink to={`/press/runs/${current.id}`}>{t("press.board.openStation")}</UiLink>
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** `/press`: every press and what is on it. */
export function LineBoard() {
  const { t } = useT();
  const { data: me } = useMe();
  const lines = useQuery({ ...trpc.press.lines.list.queryOptions({ includeRetired: false }), refetchInterval: REFRESH_MS, meta: INLINE_ERROR_META });
  const canSummary = can(me, "reports.read") || can(me, "press.run");
  const summary = useQuery({ ...trpc.press.summary.queryOptions({}), enabled: canSummary, refetchInterval: 60_000, meta: INLINE_ERROR_META });

  const header = (
    <PageHeader
      title={t("press.title")}
      subtitle={t("press.board.subtitle")}
      actions={
        <Can do="masters.publish">
          <Button asChild variant="secondary">
            <UiLink to="/press/lines">{t("press.board.manageLines")}</UiLink>
          </Button>
        </Can>
      }
    />
  );

  if (showsQueryError(lines)) {
    return (
      <>
        {header}
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("press.board.loadFailed")}
            action={
              <Button variant="secondary" onClick={() => void lines.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      </>
    );
  }
  if (!lines.data) {
    return (
      <>
        {header}
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-56 rounded-card" />
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      {lines.data.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState
            title={t("press.board.noLines")}
            body={t("press.board.noLinesBody")}
            action={
              <Can do="masters.publish">
                <Button asChild>
                  <UiLink to="/press/lines">{t("press.board.manageLines")}</UiLink>
                </Button>
              </Can>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {lines.data.map((line) => (
            <LineCard key={line.id} line={line} summary={summary.data} />
          ))}
        </div>
      )}

      <Can do="reports.read">
        <section className="flex min-w-0 flex-col gap-3" aria-label={t("press.title")}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ActionTile tone="neutral" title={t("press.report.title")} icon={<FileText aria-hidden="true" />} to="/press/report" />
            <ActionTile tone="neutral" title={t("press.summary.title")} icon={<Printer aria-hidden="true" />} to="/press/summary" />
          </div>
        </section>
      </Can>
      {!can(me, "reports.read") && can(me, "press.run") ? (
        <ActionTile tone="neutral" title={t("press.summary.title")} icon={<ListChecks aria-hidden="true" />} to="/press/summary" />
      ) : null}
    </>
  );
}
