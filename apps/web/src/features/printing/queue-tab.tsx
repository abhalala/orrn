import { useT } from "@orrn/i18n";
import type { AppRouter } from "@orrn/server/routers/index";
import { PALETTE_CLASSES } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Check, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { formatAgo } from "@/features/admin/format";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { bundleDetailPath } from "@/shared/lib/paths";
import { trpc } from "@/shared/utils/trpc";

import { canCancel, canRetry, PRINT_PAGE_SIZE, PRINT_STATUSES, printJobTone, statusFilters, type PrintStatus } from "./model";
import { PRINT_COMPUTER_REFRESH_MS, printComputerBanner } from "./print-computer";

type Job = inferRouterOutputs<AppRouter>["spool"]["queue"]["rows"][number];

/** The status colour as a small dot on an unselected filter chip (static class names for Tailwind). */
const DOT: Record<string, string> = {
  green: "bg-tone-green",
  blue: "bg-tone-blue",
  amber: "bg-tone-amber",
  red: "bg-tone-red",
  neutral: "bg-tone-neutral-ink",
};

const CHIP =
  "animate-press inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap transition-[background-color,border-color,color,scale] duration-[var(--dur-fast)] pointer-coarse:h-11 pointer-coarse:px-4";

/** Jobs whose stored reason is worth reading: it says why the label did not print. */
const WITH_REASON: Partial<Record<PrintStatus, true>> = { failed: true, outcome_unknown: true, cancelled: true };

/**
 * Print queue from `spool.queue`, newest first: the bundle, its label design, printer, copies, status, attempt and
 * when it was asked for. Status chips with counts filter the list through the URL. Failed and ambiguous jobs carry the
 * reason the server stored and Retry; jobs that have not reached the printer can be cancelled. Both actions are for
 * people who hold `spool.manage_jobs`; everyone else reads the same list without them.
 */
export function QueueTab({
  status,
  page,
  now,
  onStatus,
  onPage,
}: {
  status: PrintStatus | undefined;
  page: number;
  /** The page's ticking clock (relative times and the print computer warning follow it). */
  now: number;
  onStatus(next: PrintStatus | undefined): void;
  onPage(next: number): void;
}) {
  const { t, locale } = useT();
  const when = useCompanyWhen();
  const { data: me } = useMe();
  const canManage = can(me, "spool.manage_jobs");
  const queryClient = useQueryClient();
  const offset = (page - 1) * PRINT_PAGE_SIZE;
  const input = { limit: PRINT_PAGE_SIZE, offset, status };
  const queue = useQuery({
    ...trpc.spool.queue.queryOptions(input),
    placeholderData: keepPreviousData,
    refetchInterval: PRINT_COMPUTER_REFRESH_MS,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.spool.queue.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.dashboard.today.queryKey() });
  };
  const retry = useMutation(
    trpc.spool.retryJob.mutationOptions({
      onSuccess: () => {
        toast.success(t("printing.queue.retried"));
        refresh();
      },
      onError: () => toast.error(t("printing.queue.retryFailed")),
    }),
  );
  const cancel = useMutation(
    trpc.spool.cancelJob.mutationOptions({
      onSuccess: (result) => {
        toast.success(t(result.commandId ? "printing.queue.cancelSent" : "printing.queue.cancelled"));
        refresh();
      },
      onError: () => toast.error(t("printing.queue.cancelFailed")),
    }),
  );

  const counts = queue.data?.counts;
  // BACKLOG 102: labels waiting while no print computer is reporting in. The query asks again and the page clock
  // ticks, so the warning appears when the print computer goes quiet and clears when it reports in.
  const nodes = useQuery({ ...trpc.edge.overview.queryOptions(), refetchInterval: PRINT_COMPUTER_REFRESH_MS });
  const banner = counts && nodes.data ? printComputerBanner(nodes.data.nodes, counts.queued, now) : null;

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
          <span className="font-normal text-muted-foreground">{t("printing.queue.noBundle")}</span>
        ),
    },
    {
      key: "status",
      header: t("printing.queue.status"),
      phoneWide: true,
      cell: (job) => (
        <span className="flex min-w-0 flex-col items-start gap-1">
          <Chip tone={printJobTone(job.status)} truncate={false} data-status={job.status}>
            {t(`printing.queue.statuses.${job.status}`)}
          </Chip>
          {WITH_REASON[job.status] ? (
            <span className="text-[13px] leading-5 break-words text-muted-foreground" data-testid="job-reason">
              {job.responseText?.trim() || t("printing.queue.noReason")}
            </span>
          ) : null}
          {/* A first attempt is the normal case; a later one says the label was sent again. */}
          {job.attempt > 1 ? (
            <span className="text-[13px] leading-5 text-muted-foreground tabular-nums" data-testid="job-attempt">
              {t("printing.queue.attempt", { n: job.attempt })}
            </span>
          ) : null}
        </span>
      ),
    },
    // A floor of width in the table keeps short names ("Packing bay") on one line; longer ones still wrap.
    { key: "printer", header: t("printing.queue.printer"), cell: (job) => <span className="block lg:min-w-28">{job.profileName}</span> },
    {
      key: "design",
      header: t("printing.queue.design"),
      cell: (job) => (
        <span className={cn("block lg:min-w-32", !job.templateName && "text-muted-foreground")}>{job.templateName ?? t("printing.queue.noDesign")}</span>
      ),
    },
    {
      key: "copies",
      header: t("printing.queue.copies"),
      align: "end",
      cell: (job) => <span className="font-mono tabular-nums">{job.copies}</span>,
    },
    {
      key: "when",
      header: t("printing.queue.when"),
      cell: (job) => (
        <time dateTime={new Date(job.createdAt).toISOString()} title={when(job.createdAt)} className="whitespace-nowrap">
          {formatAgo(job.createdAt, { now: new Date(now), locale })}
        </time>
      ),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: t("printing.queue.actions"),
            headerHidden: true,
            cell: (job: Job) => {
              const retryable = canRetry(job.status);
              const cancellable = canCancel(job.status);
              if (!retryable && !cancellable) return null;
              const retrying = retry.isPending && retry.variables?.id === job.id;
              const cancelling = cancel.isPending && cancel.variables?.id === job.id;
              return (
                <Can do="spool.manage_jobs">
                  <span className="flex flex-wrap justify-start gap-2 lg:justify-end">
                    {retryable ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        data-testid="retry-job"
                        loading={retrying}
                        aria-label={t("printing.queue.retryFor", { label: job.bundleSerial ?? job.profileName })}
                        onClick={() => retry.mutate({ id: job.id })}
                      >
                        {retrying ? null : <RotateCcw aria-hidden="true" strokeWidth={2} />}
                        {t("printing.queue.retry")}
                      </Button>
                    ) : null}
                    {cancellable ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        data-testid="cancel-job"
                        loading={cancelling}
                        aria-label={t("printing.queue.cancelFor", { label: job.bundleSerial ?? job.profileName })}
                        onClick={() => cancel.mutate({ id: job.id })}
                      >
                        {cancelling ? null : <X aria-hidden="true" strokeWidth={2} />}
                        {t("printing.queue.cancel")}
                      </Button>
                    ) : null}
                  </span>
                </Can>
              );
            },
          } satisfies ResponsiveListColumn<Job>,
        ]
      : []),
  ];

  const failedWithoutData = queue.isError && !queue.data;
  const total = counts ? PRINT_STATUSES.reduce((sum, s) => sum + counts[s], 0) : 0;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {banner && counts ? (
        <div
          role="status"
          data-testid="print-computer-banner"
          data-kind={banner.kind}
          className="flex min-w-0 flex-col gap-1 rounded-card bg-tone-amber-tint px-4 py-3 text-tone-amber-ink"
        >
          <p className="m-0 text-[15px] font-semibold">
            {banner.kind === "never"
              ? t("printing.computerBanner.neverTitle")
              : t("printing.computerBanner.offlineTitle", { time: when(banner.since) })}
          </p>
          <p className="m-0 text-[14px] leading-6">
            {t(banner.kind === "never" ? "printing.computerBanner.neverBody" : "printing.computerBanner.offlineBody", {
              waiting: counts.queued,
            })}
          </p>
        </div>
      ) : null}

      {counts ? (
        <div role="group" aria-label={t("printing.queue.filterLabel")} className="flex flex-wrap gap-2" data-testid="queue-filters">
          {([undefined, ...statusFilters(counts, status)] as (PrintStatus | undefined)[]).map((opt) => {
            const active = opt === status;
            const tone = opt ? printJobTone(opt) : null;
            const n = opt ? counts[opt] : total;
            return (
              <button
                key={opt ?? "all"}
                type="button"
                aria-pressed={active}
                data-status={opt ?? "all"}
                onClick={() => onStatus(opt)}
                className={cn(
                  CHIP,
                  active
                    ? tone
                      ? cn("border-transparent", PALETTE_CLASSES[tone])
                      : "border-transparent bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-surface-sunken",
                )}
              >
                {/* The check is the non-colour cue for the selected chip. */}
                {active ? (
                  <Check aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
                ) : tone ? (
                  <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
                ) : null}
                {opt ? t(`printing.queue.statuses.${opt}`) : t("printing.queue.all")}
                <span className="font-mono tabular-nums">{n.toLocaleString("en-IN")}</span>
              </button>
            );
          })}
        </div>
      ) : queue.isPending ? (
        <div aria-hidden="true" className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-20 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-24 rounded-full" />
        </div>
      ) : null}

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
          ) : status ? (
            <EmptyState
              title={t("printing.queue.emptyFilteredTitle")}
              body={t("printing.queue.emptyFilteredBody")}
              action={
                <Button variant="secondary" onClick={() => onStatus(undefined)}>
                  {t("printing.queue.showAll")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t("printing.queue.emptyTitle")} body={t("printing.queue.emptyBody")} />
          )
        }
        columns={columns}
      />
    </div>
  );
}
