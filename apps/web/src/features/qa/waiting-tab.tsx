import type { QaCheckKind, QaStage } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { CheckSheet, type CheckPreset } from "./check-sheet";
import { useQaInvalidate, useQaRefusal, type QaWaitingRow } from "./hooks";
import { QA_STAGE_LIST, type QaStageId } from "./search";
import { Block, QaSelect } from "./ui";

/** The check a waiting item gets at each stage: a lot is inspected, a run's first piece, a batch or run cleared for pack. */
export function checkForStage(stage: QaStage, row: Pick<QaWaitingRow, "subjectType" | "subjectId" | "number" | "station">): CheckPreset {
  const kind: QaCheckKind = stage === "incoming" ? "incoming" : stage === "press" ? "first_piece" : "clearance";
  return {
    kind,
    subjectType: row.subjectType,
    subject: { id: row.subjectId, number: row.number },
    ...(kind === "clearance" ? { stage: "pack" as const } : {}),
    ...(row.station ? { stationId: row.station.id } : {}),
  };
}

/**
 * Row 36 (and the pending list of row 22): what waits for a check at one stage, and the inspection point
 * each item sits at. At dispatch the quality hold list is the queue.
 */
export function WaitingTab({ stage, onStage }: { stage: QaStageId; onStage(stage: QaStageId): void }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const say = useQaRefusal();
  const invalidate = useQaInvalidate();
  const [stationId, setStationId] = useState("");
  const [checking, setChecking] = useState<CheckPreset | null>(null);
  const stations = useQuery(trpc.qa.stations.list.queryOptions({ stage }));
  const list = useQuery({ ...trpc.qa.waiting.list.queryOptions({ stage, ...(stationId ? { stationId } : {}) }), enabled: stage !== "dispatch", meta: INLINE_ERROR_META });
  const place = useMutation(
    trpc.qa.waiting.place.mutationOptions({
      onSuccess: async (_r, v) => {
        const code = stations.data?.items.find((s) => s.id === v.stationId)?.code ?? "";
        toast.success(t("qa.waiting.placed", { code }));
        await invalidate();
      },
      onError: (e) => toast.error(say(e)),
    }),
  );

  const columns: ResponsiveListColumn<QaWaitingRow>[] = [
    {
      key: "number",
      header: t("qa.waiting.number"),
      cell: (r) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono whitespace-nowrap font-semibold">{r.number}</span>
          <span className="text-[13px] text-muted-foreground">{t(`qa.subject.${r.subjectType}`)}</span>
        </span>
      ),
    },
    {
      key: "state",
      header: t("qa.checks.result"),
      cell: (r) => (
        <Chip tone={r.state === "failed" ? "red" : "amber"} truncate={false} data-state={r.state}>
          {t(`qa.state.${r.state}`)}
        </Chip>
      ),
    },
    { key: "since", header: t("qa.waiting.since"), hideOnPhone: true, cell: (r) => (r.since ? when(r.since) : "-") },
    {
      key: "station",
      header: t("qa.waiting.station"),
      cell: (r) => (
        <Can do="qa.check" fallback={<span>{r.station?.code ?? "-"}</span>}>
          <QaSelect
            aria-label={t("qa.waiting.putAt")}
            value={r.station?.id ?? ""}
            disabled={place.isPending}
            onChange={(e) => {
              const v = e.currentTarget.value;
              if (v) place.mutate({ subjectType: r.subjectType, subjectId: r.subjectId, stationId: v });
            }}
            data-testid={`qa-put-at-${r.number}`}
          >
            <option value="">{t("qa.waiting.putAt")}</option>
            {(stations.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} {s.name}
              </option>
            ))}
          </QaSelect>
        </Can>
      ),
    },
    {
      key: "act",
      header: t("qa.waiting.check"),
      headerHidden: true,
      cell: (r) => (
        <Can do="qa.check">
          <Button variant="secondary" onClick={() => setChecking(checkForStage(stage, r))} data-testid={`qa-check-${r.number}`}>
            {t("qa.waiting.check")}
          </Button>
        </Can>
      ),
    },
  ];

  return (
    <Block id="qa-waiting" title={t(`qa.stage.${stage}`)}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field label={t("qa.waiting.stage")}>
            <QaSelect
              value={stage}
              onChange={(e) => {
                setStationId("");
                onStage(e.currentTarget.value as QaStageId);
              }}
              data-testid="qa-waiting-stage"
            >
              {QA_STAGE_LIST.map((s) => (
                <option key={s} value={s}>
                  {t(`qa.stage.${s}`)}
                </option>
              ))}
            </QaSelect>
          </Field>
        </div>
        {stage !== "dispatch" && (stations.data?.items.length ?? 0) > 0 ? (
          <div className="w-56">
            <Field label={t("qa.waiting.station")}>
              <QaSelect value={stationId} onChange={(e) => setStationId(e.currentTarget.value)} data-testid="qa-waiting-station">
                <option value="">{t("qa.waiting.allStations")}</option>
                {(stations.data?.items ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} {s.name}
                  </option>
                ))}
              </QaSelect>
            </Field>
          </div>
        ) : null}
      </div>
      {stage === "dispatch" ? (
        <p className="m-0 text-[15px]" data-testid="qa-waiting-dispatch">
          {t("qa.waiting.dispatchHint")}{" "}
          <UiLink to="/qa?tab=holds" className="font-semibold underline underline-offset-4">
            {t("qa.tabs.holds")}
          </UiLink>
        </p>
      ) : showsQueryError(list) ? (
        <EmptyState title={t("qa.loadFailed")} action={<Button variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>} />
      ) : (
        <ResponsiveList
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => `${r.subjectType}-${r.subjectId}`}
          loading={list.isLoading}
          label={t(`qa.stage.${stage}`)}
          empty={<EmptyState title={t("qa.waiting.empty")} />}
        />
      )}
      <CheckSheet open={checking !== null} onOpenChange={(o) => (o ? undefined : setChecking(null))} preset={checking ?? undefined} />
    </Block>
  );
}
