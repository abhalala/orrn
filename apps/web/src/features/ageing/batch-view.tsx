import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Stepper } from "@orrn/ui/components/stepper";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AuditRows } from "@/features/audit/audit-rows";
import { PackBar } from "@/features/pack/pack-ui";
import { kgFromG } from "@/features/press/model";
import { reasonCodeText } from "@/features/press/reason-label";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { showsQueryError } from "@/shared/lib/query-errors";
import { dayText } from "@/features/orders/format";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { trpc } from "@/shared/utils/trpc";

import {
  DiscardSheet,
  HardnessSheet,
  HoldSheet,
  OverrideSheet,
  ReworkSheet,
  SplitSheet,
  StartSheet,
  TakeOutSheet,
  TempSheet,
  UnholdDialog,
  VoidSheet,
  recipeLine,
} from "./batch-sheets";
import { useActionKey, useAgeingInvalidate, useBatch, useDuration, useNow, type Batch, type BatchRow } from "./hooks";
import {
  STAGES,
  STAGE_KEYS,
  canDiscardRow,
  canHoldRow,
  canRequestOverride,
  canRework,
  canUnholdRow,
  capacityTone,
  nextAction,
  nextActionPermission,
  rowsToTest,
  soakProgress,
  stageIndex,
  voidPermission,
  x10Text,
  type NextAction,
} from "./model";
import { TempSpark } from "./sparkline";
import { Fact, Panel, PhaseChip, RowChip, Section, SoakChip } from "./ui";
import { useRefusal } from "./hooks";
import { useShifts } from "./hooks";

type Dlg = "start" | "out" | "temp" | "hardness" | "override" | "rework" | "void" | null;

/**
 * `/ageing/batch/$id` (FP-AG-05..14): one cycle from the trolley to the verdict. The stage stepper
 * says where it stands; the one primary action is what the status allows (Start, Take out, Record
 * hardness or Release). The soak verdict, the readings, the hardness and the release plan are the
 * server's: this screen shows them and never recomputes one.
 */
export function BatchScreen({ id }: { id: string }) {
  const { t } = useT();
  const query = useBatch(id);
  const batch = query.data;
  const back = { to: "/ageing", label: t("ageing.title") };
  if (showsQueryError(query)) {
    const notFound = (query.error as { data?: { code?: string } } | null)?.data?.code === "NOT_FOUND";
    return (
      <>
        <PageHeader title={t("ageing.batch.title")} back={back} />
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={notFound ? t("ageing.refusal.batchNotFound") : t("ageing.loadFailed")} action={notFound ? undefined : <Button variant="secondary" onClick={() => void query.refetch()}>{t("common.retry")}</Button>} />
        </div>
      </>
    );
  }
  if (!batch) {
    return (
      <>
        <PageHeader title={t("ageing.batch.title")} back={back} />
        <Skeleton className="h-64 rounded-card" aria-busy="true" />
      </>
    );
  }
  return <BatchBody batch={batch} />;
}

function BatchBody({ batch }: { batch: Batch }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const [dialog, setDialog] = useState<Dlg>(null);
  const [holdRow, setHoldRow] = useState<BatchRow | null>(null);
  const [holdBatch, setHoldBatch] = useState(false);
  const [unholdRow, setUnholdRow] = useState<BatchRow | null>(null);
  const [discardRow, setDiscardRow] = useState<BatchRow | null>(null);
  const [splitRow, setSplitRow] = useState<BatchRow | null>(null);
  const [testRow, setTestRow] = useState<string | undefined>();
  const action = nextAction(batch);
  const stage = stageIndex(batch);
  const steps = STAGES.map((s) => t(STAGE_KEYS[s]));
  const vp = voidPermission(batch);
  const live = batch.status !== "closed" && batch.status !== "void";

  const subtitle = [t("ageing.floor.onTrolley", { trolley: batch.trolleyCode }), batch.ovenCode, batch.recipeLabel].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        title={batch.number}
        subtitle={subtitle}
        back={{ to: "/ageing", label: t("ageing.title") }}
        actions={<PhaseChip phase={batch.phase} />}
      />
      {batch.status === "void" ? (
        <Panel className="border-tone-red-ink/30 bg-tone-red-tint/40" data-testid="void-note">
          <p className="m-0 text-[15px] font-medium">{batch.voidReason ? t("ageing.batch.voidWhy", { reason: batch.voidReason }) : t("ageing.status.void")}</p>
        </Panel>
      ) : (
        <Stepper steps={steps} current={stage} />
      )}
      <Links batch={batch} />
      <Facts batch={batch} when={when} />
      <VerdictPanel batch={batch} onOverride={() => setDialog("override")} />
      <SoakAndReadings batch={batch} when={when} onAdd={() => setDialog("temp")} />
      <Lines
        batch={batch}
        onTest={(id) => {
          setTestRow(id);
          setDialog("hardness");
        }}
        onHold={setHoldRow}
        onUnhold={setUnholdRow}
        onDiscard={setDiscardRow}
        onSplit={setSplitRow}
      />
      {live ? (
        <Can do={["ageing.release", "ageing.load"]}>
          <Section id="more-title" title={t("ageing.batch.more")} className="mt-1">
            <div className="flex flex-wrap gap-2">
              {batch.status === "out" || batch.status === "released" ? (
                <Can do="ageing.release">
                  <Button variant="secondary" onClick={() => setHoldBatch(true)} data-testid="hold-batch">
                    {t("ageing.action.holdBatch")}
                  </Button>
                </Can>
              ) : null}
              {canRework(batch) ? (
                <Can do="ageing.release">
                  <Button variant="secondary" onClick={() => setDialog("rework")} data-testid="rework-open">
                    {t("ageing.action.rework")}
                  </Button>
                </Can>
              ) : null}
              {vp ? (
                <Can do={vp}>
                  <Button variant="ghost" onClick={() => setDialog("void")} data-testid="void-open">
                    {t("ageing.action.void")}
                  </Button>
                </Can>
              ) : null}
            </div>
          </Section>
        </Can>
      ) : batch.status === "closed" ? (
        <p className="m-0 text-[14px] text-muted-foreground" data-testid="closed-note">{t("ageing.batch.closedNote")}</p>
      ) : null}
      <Can do="audit.read">
        <Trail id={batch.id} when={when} />
      </Can>

      {live && action !== "none" ? <ActionBar batch={batch} action={action} onOpen={(d) => { setTestRow(undefined); setDialog(d); }} /> : null}

      <StartSheet open={dialog === "start"} onOpenChange={(o) => !o && setDialog(null)} batch={batch} />
      <TakeOutSheet open={dialog === "out"} onOpenChange={(o) => !o && setDialog(null)} batch={batch} />
      <TempSheet open={dialog === "temp"} onOpenChange={(o) => !o && setDialog(null)} batch={batch} />
      <HardnessSheet open={dialog === "hardness"} onOpenChange={(o) => !o && setDialog(null)} batch={batch} rowId={testRow} />
      <OverrideSheet open={dialog === "override"} onOpenChange={(o) => !o && setDialog(null)} batch={batch} />
      <ReworkSheet open={dialog === "rework"} onOpenChange={(o) => !o && setDialog(null)} batch={batch} />
      <VoidSheet open={dialog === "void"} onOpenChange={(o) => !o && setDialog(null)} batch={batch} />
      <HoldSheet open={holdRow !== null || holdBatch} onOpenChange={(o) => !o && (setHoldRow(null), setHoldBatch(false))} batch={batch} row={holdRow} />
      <UnholdDialog row={unholdRow} onClose={() => setUnholdRow(null)} />
      <DiscardSheet open={discardRow !== null} onOpenChange={(o) => !o && setDiscardRow(null)} batch={batch} row={discardRow} />
      <SplitSheet open={splitRow !== null} onOpenChange={(o) => !o && setSplitRow(null)} batch={batch} row={splitRow} />
    </>
  );
}

function Links({ batch }: { batch: Batch }) {
  const { t } = useT();
  if (!batch.reworkOfBatchId && !batch.successorBatchId) return null;
  return (
    <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[14px]" data-testid="batch-links">
      {batch.reworkOfBatchId ? <UiLink to={`/ageing/batch/${batch.reworkOfBatchId}`}>{t("ageing.batch.reworkOf")}</UiLink> : null}
      {batch.successorBatchId ? <UiLink to={`/ageing/batch/${batch.successorBatchId}`} data-testid="successor-link">{t("ageing.batch.successor")}</UiLink> : null}
    </p>
  );
}

function Facts({ batch, when }: { batch: Batch; when: (at: number) => string }) {
  const { t, locale } = useT();
  const duration = useDuration();
  const { shifts } = useShifts();
  const shift = shifts.find((s) => s.id === batch.shiftId);
  const snap = batch.snapshot;
  return (
    <Panel>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4" data-testid="batch-facts">
        <Fact label={t("ageing.field.loaded")} mono>{t("ageing.pcsKg", { pcs: batch.totals.loadedPcs, kg: kgFromG(batch.totals.loadedKgG) })}</Fact>
        <Fact label={t("ageing.field.packable")} mono>{batch.totals.packablePcs}</Fact>
        <Fact label={t("ageing.field.held")} mono>{batch.totals.heldPcs}</Fact>
        <Fact label={t("ageing.field.packed")} mono>{batch.totals.packedPcs}</Fact>
        <Fact label={t("ageing.field.remaining")} mono>{batch.totals.remainingPcs}</Fact>
        <Fact label={t("ageing.field.theoreticalKg")} mono>{kgFromG(batch.totals.theoreticalRemainingKgG)}</Fact>
        {batch.totals.scrapPcs > 0 ? <Fact label={t("ageing.field.scrap")} mono>{batch.totals.scrapPcs}</Fact> : null}
        {batch.totals.reworkPcs > 0 ? <Fact label={t("ageing.field.reworked")} mono>{batch.totals.reworkPcs}</Fact> : null}
        {batch.inAt ? <Fact label={t("ageing.field.inAt")} mono>{when(batch.inAt)}</Fact> : null}
        {batch.outAt ? <Fact label={t("ageing.field.outAt")} mono>{when(batch.outAt)}</Fact> : null}
        {shift ? <Fact label={t("ageing.field.shift")}>{shift.name}</Fact> : null}
        {batch.productionDay ? <Fact label={t("ageing.field.day")}>{dayText(batch.productionDay, locale)}</Fact> : null}
        {batch.gasStartMilli !== null ? <Fact label={t("ageing.field.gasStart")} mono>{(batch.gasStartMilli / 1000).toFixed(3)}</Fact> : null}
        {batch.gasEndMilli !== null ? <Fact label={t("ageing.field.gasEnd")} mono>{(batch.gasEndMilli / 1000).toFixed(3)}</Fact> : null}
        {batch.gasUsedMilli !== null ? <Fact label={t("ageing.field.gasUsed")} mono>{(batch.gasUsedMilli / 1000).toFixed(3)}</Fact> : null}
        {batch.capacity !== "unknown" && batch.capacity !== "ok" ? (
          <Fact label={t("ageing.field.capacity")}>
            <Chip tone={capacityTone(batch.capacity)} truncate={false}>{t(`ageing.capacity.${batch.capacity}`)}</Chip>
          </Fact>
        ) : null}
      </dl>
      {snap ? (
        <p className="mt-4 mb-0 border-t border-border pt-3 text-[14px] leading-6 text-muted-foreground" data-testid="batch-recipe">
          <span className="font-semibold text-foreground">{batch.recipeLabel}</span> · {recipeLine(t, duration, snap)}
        </p>
      ) : null}
    </Panel>
  );
}

/** The soak verdict panel and, once judged, what the release did (the server's plan, shown). */
function VerdictPanel({ batch, onOverride }: { batch: Batch; onOverride: () => void }) {
  const { t } = useT();
  const duration = useDuration();
  const soak = batch.soak;
  const hasHeld = batch.rows.some((r) => r.status === "held");
  const askable = canRequestOverride(batch, hasHeld);
  const showSoak = soak && batch.status !== "loading";
  if (!showSoak && !batch.pendingOverrideId && !batch.overrideApprovalId && !hasHeld) return null;
  return (
    <Panel className="flex flex-col gap-3" data-testid="verdict-panel" data-verdict={soak?.verdict ?? "none"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 font-display text-[18px] font-bold tracking-[-0.02em]">{t("ageing.verdict.title")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {soak ? <SoakChip verdict={soak.verdict} /> : null}
          {batch.qcVerdict ? <Chip tone={batch.qcVerdict === "fail" ? "red" : "green"} truncate={false}>{t(`ageing.qcVerdict.${batch.qcVerdict}`)}</Chip> : null}
        </div>
      </div>
      {soak && showSoak ? (
        <>
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
            <Fact label={t("ageing.verdict.inBand")} mono>
              {batch.snapshot ? t("ageing.verdict.inBandOf", { min: duration(soak.inBandMin), total: duration(batch.snapshot.soakMin) }) : duration(soak.inBandMin)}
            </Fact>
            <Fact label={t("ageing.verdict.above")} mono>{duration(soak.aboveBandMin)}</Fact>
            <Fact label={t("ageing.verdict.below")} mono>{duration(soak.belowBandMin)}</Fact>
            <Fact label={t("ageing.verdict.unknown")} mono>{duration(soak.unknownMin)}</Fact>
          </dl>
          <p className="m-0 text-[14px] leading-6 text-muted-foreground" data-testid="verdict-text">
            {t(`ageing.verdict.say.${soak.verdict}`, {
              short: batch.snapshot ? duration(Math.max(0, batch.snapshot.soakMin - soak.inBandMin)) : "",
              over: batch.snapshot?.maxSoakMin != null ? duration(Math.max(0, soak.inBandMin - batch.snapshot.maxSoakMin)) : "",
              above: duration(soak.aboveBandMin),
            })}
            {soak.unknownMin > 0 ? ` ${t("ageing.verdict.unknownHint")}` : ""}
          </p>
        </>
      ) : null}
      {batch.pendingOverrideId ? (
        <p role="status" className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card bg-tone-amber-tint px-4 py-3 text-[14px] font-medium text-tone-amber-ink" data-testid="override-state" data-state="pending">
          <span>{t("ageing.override.pending")}</span>
          <Can do="masters.publish">
            <UiLink to="/approvals">{t("ageing.override.open")}</UiLink>
          </Can>
        </p>
      ) : batch.overrideApprovalId && (batch.status === "held" || batch.status === "out") ? (
        <p role="status" className="m-0 rounded-card bg-tone-green-tint px-4 py-3 text-[14px] font-medium text-tone-green-ink" data-testid="override-state" data-state="approved">
          {t("ageing.override.approved")}
        </p>
      ) : null}
      {askable ? (
        <Can do="ageing.release">
          <div>
            <Button variant="secondary" onClick={onOverride} data-testid="override-open">
              {t("ageing.action.requestOverride")}
            </Button>
          </div>
        </Can>
      ) : null}
    </Panel>
  );
}

function SoakAndReadings({ batch, when, onAdd }: { batch: Batch; when: (at: number) => string; onAdd: () => void }) {
  const { t } = useT();
  const now = useNow();
  const duration = useDuration();
  const qc = useAgeingInvalidate();
  const snap = batch.snapshot;
  const band = snap ? { lowX10: snap.targetTempX10 - snap.toleranceX10, highX10: snap.targetTempX10 + snap.toleranceX10 } : null;
  const progress = soakProgress(batch.soakStartedAt, snap?.soakMin ?? null, batch.outAt ?? now);
  const canAdd = batch.status === "in_oven" || (batch.status === "out" && batch.outAt !== null && now - batch.outAt < 30 * 60_000);
  const simulate = useOnceMutation(
    trpc.ageing.batches.simulate.mutationOptions({
      onSuccess: async (res) => {
        toast.success(t("ageing.sim.done", { count: res.inserted }));
        await qc();
      },
    }),
  );
  if (batch.status === "loading" || batch.status === "void") return null;
  const hasFeed = batch.readings.some((r) => r.source === "telemetry");
  return (
    <Section
      id="readings-title"
      title={t("ageing.readings.title")}
      hint={snap ? t("ageing.readings.target", { temp: x10Text(snap.targetTempX10), tol: x10Text(snap.toleranceX10) }) : undefined}
      actions={
        <>
          {batch.simulator && (batch.status === "in_oven" || batch.status === "out") ? (
            <Can do="ageing.record">
              <Button variant="secondary" loading={simulate.isPending} onClick={() => simulate.mutate({ batchId: batch.id })} data-testid="simulate">
                {t("ageing.sim.run")}
              </Button>
            </Can>
          ) : null}
          {canAdd ? (
            <Can do="ageing.record">
              <Button onClick={onAdd} data-testid="add-reading">
                {t("ageing.readings.addReading")}
              </Button>
            </Can>
          ) : null}
        </>
      }
    >
      <Panel className="flex flex-col gap-3">
        <TempSpark readings={batch.readings} band={band} height={88} />
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          <Fact label={t("ageing.floor.lastTemp")} mono>{batch.lastTempCX10 === null ? "-" : `${x10Text(batch.lastTempCX10)} °C`}</Fact>
          <Fact label={t("ageing.field.minMax")} mono>{batch.soak && batch.soak.minX10 !== null ? `${x10Text(batch.soak.minX10)} / ${x10Text(batch.soak.maxX10)}` : "-"}</Fact>
          <Fact label={t("ageing.field.soakStarted")} mono>{batch.soakStartedAt ? when(batch.soakStartedAt) : "-"}</Fact>
          {progress && snap ? <Fact label={t("ageing.floor.soakOf", { total: duration(snap.soakMin) })} mono>{duration(progress.elapsedMin)}</Fact> : null}
        </dl>
        {batch.simulator && batch.readings.some((r) => r.source === "simulator") ? <Chip tone="blue" truncate={false}>{t("ageing.simulator")}</Chip> : null}
        {hasFeed ? <p className="m-0 text-[13px] text-muted-foreground" data-testid="feed-note">{t("ageing.readings.feedNote")}</p> : null}
        <ReadingsTable batch={batch} when={when} />
      </Panel>
    </Section>
  );
}

function ReadingsTable({ batch, when }: { batch: Batch; when: (at: number) => string }) {
  const { t } = useT();
  const [all, setAll] = useState(false);
  const sorted = [...batch.readings].sort((a, b) => b.at - a.at);
  if (sorted.length === 0) return <p className="m-0 text-[14px] text-muted-foreground">{t("ageing.readings.empty")}</p>;
  const shown = all ? sorted : sorted.slice(0, 8);
  const columns: ResponsiveListColumn<(typeof sorted)[number]>[] = [
    { key: "at", header: t("ageing.readings.at"), cell: (r) => <span className="whitespace-nowrap tabular-nums">{when(r.at)}</span> },
    {
      key: "temp",
      header: t("ageing.readings.temperature"),
      align: "end",
      cell: (r) => (
        <span className="flex items-center justify-end gap-2 font-mono tabular-nums">
          {x10Text(r.tempCX10)}
          <Chip tone={r.inBand ? "green" : "neutral"} truncate={false}>{r.inBand ? t("ageing.readings.inBand") : t("ageing.readings.outBand")}</Chip>
        </span>
      ),
    },
    { key: "source", header: t("ageing.readings.source"), cell: (r) => t(`ageing.tempSource.${r.source}`) },
    { key: "note", header: t("ageing.readings.note"), hideOnPhone: true, cell: (r) => r.note ?? "" },
  ];
  return (
    <div className="flex flex-col gap-2" data-testid="readings-table">
      <ResponsiveList rows={shown} columns={columns} rowKey={(r) => r.id} label={t("ageing.readings.title")} empty={null} />
      {sorted.length > 8 ? (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
            {all ? t("ageing.readings.showLess") : t("ageing.readings.showAll", { count: sorted.length })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Lines({
  batch,
  onTest,
  onHold,
  onUnhold,
  onDiscard,
  onSplit,
}: {
  batch: Batch;
  onTest(rowId: string): void;
  onHold(row: BatchRow): void;
  onUnhold(row: BatchRow): void;
  onDiscard(row: BatchRow): void;
  onSplit(row: BatchRow): void;
}) {
  const { t, locale } = useT();
  const { settings } = useShifts();
  const splitOn = settings.data?.ageing?.split === true;
  const holdReasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "ageing_hold", includeInactive: true }), staleTime: 5 * 60_000, enabled: batch.rows.some((r) => r.holdReasonCodeId) });
  const rejectReasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "ageing_reject", includeInactive: true }), staleTime: 5 * 60_000, enabled: batch.rows.some((r) => r.holdReasonCodeId) });
  const holdWhy = (r: BatchRow): string | null => {
    if (!r.holdReasonCodeId) return null;
    const hold = holdReasons.data?.find((x) => x.id === r.holdReasonCodeId);
    if (hold) return reasonCodeText(t, "ageing_hold", hold.code, holdReasons.data, locale);
    const reject = rejectReasons.data?.find((x) => x.id === r.holdReasonCodeId);
    if (reject) return reasonCodeText(t, "ageing_reject", reject.code, rejectReasons.data, locale);
    return null;
  };
  const rows = batch.rows.filter((r) => r.status !== "void");
  const columns: ResponsiveListColumn<BatchRow>[] = [
    {
      key: "section",
      header: t("ageing.field.section"),
      phoneWide: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold break-words">{r.sectionLabel}</span>
          <span className="text-[13px] text-muted-foreground">
            {[r.dieInstanceCode, r.source === "bundle" ? r.bundleSerial : null, r.pressRunNumber, r.source !== "press" ? t(`ageing.source.${r.source}`) : null].filter(Boolean).join(" · ")}
          </span>
        </span>
      ),
    },
    { key: "len", header: t("ageing.field.cutLength"), cell: (r) => <span className="font-mono tabular-nums whitespace-nowrap">{r.lengthMm} mm</span> },
    { key: "pcs", header: t("ageing.field.pieces"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.pcs}</span> },
    { key: "kg", header: t("units.kg"), align: "end", hideOnPhone: true, cell: (r) => <span className="font-mono tabular-nums">{kgFromG(r.kgG)}</span> },
    { key: "rem", header: t("ageing.field.remaining"), align: "end", cell: (r) => <span className="font-mono tabular-nums" data-testid="row-remaining">{r.remainingPcs}</span> },
    { key: "cast", header: t("ageing.field.cast"), hideOnPhone: true, cell: (r) => <span className="font-mono">{r.castCode ?? "-"}</span> },
    {
      key: "order",
      header: t("ageing.field.salesOrder"),
      hideOnPhone: true,
      cell: (r) => (r.salesOrderNumber ? <span className="break-words">{[r.salesOrderNumber, r.customerName, r.customerPo ? `PO ${r.customerPo}` : null].filter(Boolean).join(" · ")}</span> : <span className="text-muted-foreground">-</span>),
    },
    {
      key: "hardness",
      header: t("ageing.field.hardness"),
      phoneWide: true,
      cell: (r) =>
        r.hardnessReadingX10 === null ? (
          <span className="text-muted-foreground">{t("ageing.hardness.untested")}</span>
        ) : (
          <span className="flex flex-wrap items-center gap-2" data-testid="row-hardness">
            <span className="font-mono tabular-nums">
              {x10Text(r.hardnessReadingX10)} {r.hardnessMethod ? t(`ageing.method.${r.hardnessMethod}`) : ""}
            </span>
            {r.hardnessPass === null ? null : <Chip tone={r.hardnessPass ? "green" : "red"} truncate={false}>{r.hardnessPass ? t("ageing.readings.pass") : t("ageing.readings.fail")}</Chip>}
          </span>
        ),
    },
    {
      key: "status",
      header: t("ageing.field.verdict"),
      phoneWide: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col items-start gap-1">
          <RowChip status={r.status} />
          {r.status === "held" && holdWhy(r) ? <span className="text-[13px] text-muted-foreground" data-testid="row-hold-why">{holdWhy(r)}</span> : null}
          {r.holdNote ? <span className="text-[13px] text-muted-foreground break-words">{r.holdNote}</span> : null}
        </span>
      ),
    },
    {
      key: "act",
      header: t("ageing.batch.actions"),
      headerHidden: true,
      phoneWide: true,
      cell: (r) => (
        <span className="flex flex-col items-start gap-1.5">
          {(batch.status === "out" && r.status === "pending") || (batch.status === "held" && r.status === "held" && r.hardnessPass === false) ? (
            <Can do="ageing.record">
              <Button variant="secondary" size="sm" onClick={() => onTest(r.id)} data-testid="row-test">
                {r.status === "held" ? t("ageing.action.retest") : t("ageing.action.hardness")}
              </Button>
            </Can>
          ) : null}
          {canHoldRow(batch, r) ? (
            <Can do="ageing.release">
              <Button variant="ghost" size="sm" onClick={() => onHold(r)} data-testid="row-hold">
                {t("ageing.action.hold")}
              </Button>
            </Can>
          ) : null}
          {canUnholdRow(r) && r.holdReasonCodeId && holdReasons.data?.some((x) => x.id === r.holdReasonCodeId) ? (
            <Can do="ageing.release">
              <Button variant="secondary" size="sm" onClick={() => onUnhold(r)} data-testid="row-unhold">
                {t("ageing.action.unhold")}
              </Button>
            </Can>
          ) : null}
          {canDiscardRow(batch, r) ? (
            <Can do="ageing.release">
              <Button variant="ghost" size="sm" onClick={() => onDiscard(r)} data-testid="row-discard">
                {t("ageing.action.discard")}
              </Button>
            </Can>
          ) : null}
          {splitOn && (r.status === "pending" || r.status === "released") && r.packedPcs === 0 && r.scrapPcs === 0 && r.reworkPcs === 0 && r.source !== "bundle" ? (
            <Can do="ageing.release">
              <Button variant="ghost" size="sm" onClick={() => onSplit(r)} data-testid="row-split">
                {t("ageing.action.split")}
              </Button>
            </Can>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <Section id="lines-title" title={t("ageing.batch.lines")} hint={batch.status === "loading" && rows.length === 0 ? undefined : t("ageing.batch.linesHint")}>
      <ResponsiveList
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        label={t("ageing.batch.lines")}
        empty={<EmptyState title={t("ageing.empty.noRows")} action={batch.status === "loading" ? <Can do="ageing.load"><Button asChild variant="secondary"><UiLink to={`/ageing/load?trolley=${batch.trolleyId}`} className="no-underline">{t("ageing.action.load")}</UiLink></Button></Can> : undefined} />}
      />
      {rowsToTest(batch).length > 0 && batch.status === "out" ? <p className="m-0 text-[14px] text-muted-foreground">{t("ageing.batch.testFirst", { count: rowsToTest(batch).length })}</p> : null}
      {batch.status === "loading" && rows.length > 0 ? (
        <Can do="ageing.load">
          <div>
            <Button asChild variant="secondary" size="sm">
              <UiLink to={`/ageing/load?trolley=${batch.trolleyId}`} className="no-underline">
                {t("ageing.batch.addMore")}
              </UiLink>
            </Button>
          </div>
        </Can>
      ) : null}
    </Section>
  );
}

function ActionBar({ batch, action, onOpen }: { batch: Batch; action: NextAction; onOpen(d: "start" | "out" | "hardness"): void }) {
  const { t } = useT();
  const invalidate = useAgeingInvalidate();
  const key = useActionKey();
  const say = useRefusal();
  const [result, setResult] = useState<{ held: number; override: boolean } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const release = useOnceMutation(
    trpc.ageing.batches.release.mutationOptions({
      onSuccess: async (res) => {
        key.reset();
        setError(null);
        const held = res.rows.filter((r) => r.status === "held").length;
        setResult({ held, override: res.overrideWouldHelp });
        toast.success(held > 0 ? t("ageing.release.partial", { count: held }) : t("ageing.release.done", { number: batch.number }));
        await invalidate();
      },
      onError: (e) => setError(e),
    }),
  );
  const perm = nextActionPermission(action);
  if (!perm) return null;
  const waiting = action === "release" ? <p className="m-0 text-[14px] text-muted-foreground" data-testid="waiting-release">{t("ageing.next.askRelease")}</p> : null;
  const label = {
    start: t("ageing.action.start"),
    takeOut: t("ageing.action.takeOut"),
    hardness: t("ageing.action.hardness"),
    release: t("ageing.action.release"),
    none: "",
  }[action];
  const press = () => {
    if (action === "start") onOpen("start");
    else if (action === "takeOut") onOpen("out");
    else if (action === "hardness") onOpen("hardness");
    else release.mutate({ batchId: batch.id, clientMutationId: key.get() });
  };
  return (
    <Can do={perm} fallback={waiting}>
      <PackBar
        className="ageing-action-bar"
        notice={error ? <p role="alert" data-testid="release-refusal" className="m-0 text-[14px] font-medium text-destructive">{say(error)}</p> : result && result.held > 0 ? <p role="status" className="m-0 text-[14px] font-medium" data-testid="release-result">{t("ageing.release.partial", { count: result.held })}{result.override ? ` ${t("ageing.release.overrideHelps")}` : ""}</p> : undefined}
        summary={<p className="m-0 text-[14px] font-medium text-muted-foreground">{action === "none" ? "" : t(`ageing.next.${action}`)}</p>}
      >
        <Button size="lg" onClick={press} loading={release.isPending} data-testid={`action-${action}`}>
          {label}
        </Button>
      </PackBar>
    </Can>
  );
}

function Trail({ id, when }: { id: string; when: (at: string) => string }) {
  const { t } = useT();
  const trail = useQuery({ ...trpc.audit.forSubject.queryOptions({ subjectType: "ageing_batch", subjectId: id }), staleTime: 10_000 });
  return (
    <Section id="trail-title" title={t("ageing.batch.trail")}>
      <AuditRows rows={trail.data?.items ?? []} loading={trail.isLoading} empty={<EmptyState title={t("ageing.batch.trailEmpty")} />} when={when} label={t("ageing.batch.trail")} />
    </Section>
  );
}
