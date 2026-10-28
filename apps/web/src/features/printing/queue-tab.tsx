import { useT } from "@orrn/i18n";
import type { AppRouter } from "@orrn/server/routers/index";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { cn } from "@orrn/ui/lib/utils";
import { PALETTE_CLASSES } from "@orrn/ui/components/badge";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Check, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { bundleDetailPath } from "@/shared/lib/paths";
import { trpc } from "@/shared/utils/trpc";

import { canRetry, PRINT_PAGE_SIZE, PRINT_STATUSES, printJobTone, queueSummary, type PrintStatus } from "./model";
import { PRINT_COMPUTER_REFRESH_MS, printComputerBanner } from "./print-computer";

type Job = inferRouterOutputs<AppRouter>["spool"]["queue"]["rows"][number];

const DOT: Record<string, string> = {
  green: "bg-tone-green",
  blue: "bg-tone-blue",
  amber: "bg-tone-amber",
  red: "bg-tone-red",
  neutral: "bg-tone-neutral-ink",
};

/**
 * Print queue from `spool.queue`: status filter chips with counts, then the
 * jobs newest first. Failed jobs carry the reason the server stored and a
 * Retry button for people who hold `spool.manage_jobs`.
 */
export function QueueTab({
  status,
  page,
  onStatus,
  onPage,
}: {
  status: PrintStatus | undefined;
  page: number;
  onStatus(next: PrintStatus | undefined): void;
  onPage(next: number): void;
}) {
  const { t } = useT();
  const when = useCompanyWhen();
  const queryClient = useQueryClient();
  const offset = (page - 1) * PRINT_PAGE_SIZE;
  const queue = useQuery({
    ...trpc.spool.queue.queryOptions({ limit: PRINT_PAGE_SIZE, offset, status }),
    placeholderData: keepPreviousData,
  });

  const retry = useMutation(
    trpc.spool.retryJob.mutationOptions({
      onSuccess: () => {
        toast.success(t("printing.queue.retried"));
        void queryClient.invalidateQueries({ queryKey: trpc.spool.queue.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.dashboard.today.queryKey() });
      },
      onError: () => toast.error(t("printing.queueExtra.retryFailed")),
    }),
  );

  const counts = queue.data?.counts;
  const summary = counts ? queueSummary(counts) : null;
  // BACKLOG 102: labels waiting while no print computer is reporting in.
  // The query asks again and the clock ticks while the tab is open, so the banner appears when the print computer goes quiet and clears when it reports in.
  const nodes = useQuery({ ...trpc.edge.overview.queryOptions(), refetchInterval: PRINT_COMPUTER_REFRESH_MS });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), PRINT_COMPUTER_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);
  const banner = summary && nodes.data ? printComputerBanner(nodes.data.nodes, summary.waiting, now) : null;

  const columns: ResponsiveListColumn<Job>[] = [
    {
      key: "label",
      header: t("printing.queue.label"),
      cell: (job) =>
        job.bundleSerial ? (
          <UiLink to={bundleDetailPath({ serial: job.bundleSerial })} className="font-mono font-semibold whitespace-nowrap">
            {job.bundleSerial}
          </UiLink>
        ) : (
          <span className="text-muted-foreground">{t("printing.queueExtra.noBundle")}</span>
        ),
    },
    { key: "printer", header: t("printing.queue.printer"), cell: (job) => job.profileName },
    {
      key: "status",
      header: t("printing.queue.status"),
      cell: (job) => (
        <Chip tone={printJobTone(job.status)}>
          {job.status === "accepted"
            ? "Accepted"
            : job.status === "outcome_unknown"
              ? "Outcome unknown"
              : job.status === "cancelled"
                ? "Cancelled"
                : t(`status.printJob.${job.status}`)}
        </Chip>
      ),
    },
    {
      key: "when",
      header: t("printing.queue.when"),
      cell: (job) => <span className="whitespace-nowrap">{when(job.createdAt)}</span>,
    },
    {
      key: "error",
      header: t("printing.queue.error"),
      cell: (job) =>
        job.status === "failed" || job.status === "outcome_unknown" || job.status === "cancelled" ? (
          <span className="flex min-w-0 flex-col gap-0.5 break-words">
            <span>{job.responseText?.trim() || t("printing.queueExtra.noReason")}</span>
            {job.attempt > 1 ? (
              <span className="text-[13px] text-muted-foreground">{t("printing.queueExtra.attempt", { n: job.attempt })}</span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "retry",
      header: "",
      cell: (job) =>
        canRetry(job.status) ? (
          <Can do="spool.manage_jobs">
            <Button
              variant="secondary"
              data-testid="retry-job"
              loading={retry.isPending && retry.variables?.id === job.id}
              aria-label={t("printing.queueExtra.retryFor", { label: job.bundleSerial ?? job.profileName })}
              onClick={() => retry.mutate({ id: job.id })}
            >
              {retry.isPending && retry.variables?.id === job.id ? null : <RotateCcw aria-hidden="true" strokeWidth={2} />}
              {t("printing.queue.retry")}
            </Button>
          </Can>
        ) : null,
    },
  ];

  const failedWithoutData = queue.isError && !queue.data;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {banner && summary ? (
        <div role="status" data-testid="print-computer-banner" data-kind={banner.kind} className="flex min-w-0 flex-col gap-1 rounded-card bg-tone-amber-tint px-4 py-3 text-tone-amber-ink">
          <p className="m-0 text-[15px] font-semibold">
            {banner.kind === "never" ? t("printing.computerBanner.neverTitle") : t("printing.computerBanner.offlineTitle", { time: when(banner.since) })}
          </p>
          <p className="m-0 text-[14px] leading-6">
            {t(banner.kind === "never" ? "printing.computerBanner.neverBody" : "printing.computerBanner.offlineBody", { waiting: summary.waiting })}
          </p>
        </div>
      ) : null}
      {summary ? (
        <p className="m-0 text-[15px] leading-6 text-muted-foreground" role="status" data-testid="queue-summary">
          {summary.clear
            ? t("printing.queueExtra.summaryClear")
            : t("printing.queueExtra.summary", { failed: summary.failed, waiting: summary.waiting })}
          {summary.unknown > 0 ? ` Outcome unknown: ${summary.unknown}.` : null}
        </p>
      ) : null}

      <div role="group" aria-label={t("printing.queueExtra.filterLabel")} className="flex flex-wrap gap-2">
        {([undefined, ...PRINT_STATUSES] as (PrintStatus | undefined)[]).map((opt) => {
          const active = opt === status;
          const tone = opt ? printJobTone(opt) : null;
          const n = counts ? (opt ? counts[opt] : PRINT_STATUSES.reduce((sum, s) => sum + counts[s], 0)) : null;
          return (
            <button
              key={opt ?? "all"}
              type="button"
              aria-pressed={active}
              data-status={opt ?? "all"}
              onClick={() => onStatus(opt)}
              className={cn(
                "animate-press inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[14px] font-semibold whitespace-nowrap transition-[background-color,border-color,color,scale] duration-[var(--dur-fast)]",
                active
                  ? tone
                    ? cn("border-transparent", PALETTE_CLASSES[tone])
                    : "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-surface-sunken",
              )}
            >
              {active ? (
                <Check aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
              ) : tone ? (
                <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
              ) : null}
              {opt === "accepted"
                ? "Accepted"
                : opt === "outcome_unknown"
                  ? "Outcome unknown"
                  : opt === "cancelled"
                    ? "Cancelled"
                    : opt
                      ? t(`status.printJob.${opt}`)
                      : t("printing.queueExtra.all")}
              {n !== null ? <span className="font-mono tabular-nums">{n.toLocaleString("en-IN")}</span> : null}
            </button>
          );
        })}
      </div>

      <ResponsiveList
        rows={queue.data?.rows ?? []}
        total={queue.data?.total}
        page={{ offset, limit: PRINT_PAGE_SIZE, onChange: (next) => onPage(next / PRINT_PAGE_SIZE + 1) }}
        // Dim the rows only while a different page or filter loads, not on a silent background refresh.
        loading={queue.isPending || queue.isPlaceholderData}
        label={t("printing.tabs.queue")}
        rowKey={(job) => job.id}
        empty={
          failedWithoutData ? (
            <EmptyState
              title={t("printing.loadFailed")}
              action={
                <Button variant="secondary" onClick={() => void queue.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={status ? t("printing.queueExtra.emptyFiltered") : t("printing.queue.empty")} />
          )
        }
        columns={columns}
      />
    </div>
  );
}
