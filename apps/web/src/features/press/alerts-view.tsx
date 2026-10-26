import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { UiLink } from "@orrn/ui/components/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { toast } from "sonner";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import type { AlertsSearch } from "./search";

type Alert = inferRouterOutputs<AppRouter>["press"]["collector"]["alerts"][number];

/**
 * The row's chip: "Ongoing" while its last out-of-band reading is recent, "Ended" after, "Acknowledged" once
 * someone has seen it. Not the same word as "Open", which is every alert not acknowledged yet (BACKLOG 81).
 */
export function alertState(a: Pick<Alert, "endedAt" | "acknowledgedAt">): "open" | "ended" | "acknowledged" {
  if (a.acknowledgedAt) return "acknowledged";
  return a.endedAt ? "ended" : "open";
}

const TONE = { open: "red", ended: "amber", acknowledged: "neutral" } as const;

/**
 * `/press/alerts` (FP-PR-22): readings that went outside the limits set for a press, newest first,
 * open ones by default. Anyone who can open the press reads it; press.close holders acknowledge.
 * Nothing here is a notification: the Today press tile links here.
 */
export function AlertsScreen({ search, onSearch }: { search: AlertsSearch; onSearch: (next: AlertsSearch) => void }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const queryClient = useQueryClient();
  const openOnly = search.show !== "all";
  const query = useQuery({ ...trpc.press.collector.alerts.queryOptions({ openOnly, limit: 100 }), meta: INLINE_ERROR_META });
  const counts = useQuery({ ...trpc.press.collector.openAlertCount.queryOptions(), meta: INLINE_ERROR_META });
  const ack = useMutation(
    trpc.press.collector.acknowledgeAlert.mutationOptions({
      onSuccess: async () => {
        toast.success(t("press.alerts.acknowledged"));
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.press.collector.pathKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.dashboard.pathKey() }),
        ]);
      },
      onError: () => toast.error(t("press.alerts.ackFailed")),
    }),
  );

  const header = (
    <PageHeader title={t("press.alerts.title")} subtitle={t("press.alerts.subtitle")} back={{ to: "/press", label: t("press.title") }} />
  );
  if (showsQueryError(query)) {
    return (
      <>
        {header}
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("press.alerts.loadFailed")} action={<Button variant="secondary" onClick={() => void query.refetch()}>{t("common.retry")}</Button>} />
        </div>
      </>
    );
  }

  const columns: ResponsiveListColumn<Alert>[] = [
    {
      key: "line",
      header: t("press.alerts.columns.line"),
      cell: (a) => (
        <span className="flex flex-wrap items-center gap-2 font-semibold">
          <span className="font-mono whitespace-nowrap">{a.lineCode}</span>
          {a.simulated ? <Chip tone="blue">{t("press.alerts.simulated")}</Chip> : null}
        </span>
      ),
    },
    { key: "metric", header: t("press.alerts.columns.metric"), cell: (a) => t(`press.alerts.metric.${a.metric}`) },
    {
      key: "limit",
      header: t("press.alerts.columns.limit"),
      cell: (a) => <span className="tabular-nums">{t(`press.alerts.${a.direction}`, { limit: a.limit, unit: t(`press.alerts.unit.${a.metric}`) })}</span>,
    },
    {
      key: "peak",
      header: t("press.alerts.columns.peak"),
      align: "end",
      cell: (a) => (
        <span className="tabular-nums">
          {a.peak} {t(`press.alerts.unit.${a.metric}`)}
        </span>
      ),
    },
    { key: "started", header: t("press.alerts.columns.started"), hideOnPhone: true, cell: (a) => <span className="tabular-nums">{when(a.startedAt)}</span> },
    {
      key: "last",
      header: t("press.alerts.columns.last"),
      hideOnPhone: true,
      cell: (a) => (
        <span className="tabular-nums">
          {when(a.lastAt)} <span className="text-muted-foreground">({t("press.alerts.frames", { count: a.frames })})</span>
        </span>
      ),
    },
    {
      key: "run",
      header: t("press.alerts.columns.run"),
      hideOnPhone: true,
      cell: (a) =>
        a.pressRunId && a.runNumber ? (
          <UiLink to={`/press/runs/${a.pressRunId}`} className="font-mono whitespace-nowrap">
            {a.runNumber}
          </UiLink>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "status",
      header: t("press.alerts.columns.status"),
      phoneWide: true,
      cell: (a) => {
        const state = alertState(a);
        return (
          <span className="flex flex-col items-start gap-1">
            <Chip tone={TONE[state]}>{t(`press.alerts.status.${state}`)}</Chip>
            {a.acknowledgedAt ? <span className="text-[13px] text-muted-foreground">{t("press.alerts.ackedAt", { time: when(a.acknowledgedAt) })}</span> : null}
          </span>
        );
      },
    },
    {
      key: "act",
      header: t("press.alerts.acknowledge"),
      headerHidden: true,
      cell: (a) =>
        a.acknowledgedAt ? null : (
          <Can do="press.close">
            <Button variant="secondary" size="sm" loading={ack.isPending && ack.variables?.id === a.id} onClick={() => ack.mutate({ id: a.id })}>
              {t("press.alerts.acknowledge")}
            </Button>
          </Can>
        ),
    },
  ];

  return (
    <>
      {header}
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<"open" | "all">
          label={t("press.alerts.show")}
          value={openOnly ? "open" : "all"}
          onChange={(v) => onSearch(v === "all" ? { show: "all" } : {})}
          options={[
            { value: "open", label: counts.data ? t("press.alerts.showOpenCount", { count: counts.data.open }) : t("press.alerts.showOpen") },
            { value: "all", label: counts.data ? t("press.alerts.showAllCount", { count: counts.data.all }) : t("press.alerts.showAll") },
          ]}
        />
        <p className="m-0 min-w-0 text-[14px] text-muted-foreground">{t("press.alerts.openRule")}</p>
      </div>
      <ResponsiveList
        rows={query.data ?? []}
        columns={columns}
        rowKey={(a) => a.id}
        loading={query.isLoading}
        label={t("press.alerts.title")}
        empty={<EmptyState title={openOnly ? t("press.alerts.emptyOpen") : t("press.alerts.empty")} />}
      />
    </>
  );
}
