import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { announce } from "@/lib/a11y";
import { reasonCodeText } from "@/features/press/reason-label";
import { useFormat } from "@/lib/use-format";
import { useNow } from "@/lib/use-now";
import { webUrl } from "@/lib/web-url";
import { can, useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

import {
  batchWebPath,
  canAddReading,
  canHoldRow,
  canRequestOverride,
  canUnholdRow,
  capacityTone,
  gasText,
  hardnessTone,
  nextAction,
  nextActionPermission,
  rowsToTest,
  soakProgress,
  stageIndex,
  webOnlyActions,
  x10Text,
  type NextAction,
} from "./model";
import { HardnessSheet, HoldSheet, OverrideSheet, StartSheet, TakeOutSheet, TempSheet, UnholdSheet, recipeLine, type Notice } from "./sheets";
import { TempSpark } from "./spark";
import { ErrorLine, Figure, Note, PhaseChip, RowChip, Section, SoakChip, StageStepper } from "./ui";
import { BOARD_POLL_MS, useAgeingRefresh, useKeyedWrite, type Batch, type BatchRow } from "./use-ageing";
import { useDuration } from "./use-duration";

type Dlg = "start" | "out" | "temp" | "hardness" | "override" | null;

const kgText = (g: number) => formatKgTotal(gToKg(g));

/**
 * One cycle from the trolley to the verdict (FP-AG-16). The stage stepper says where it stands; the one primary
 * action at the bottom is what the status allows (Start, Take out, Record hardness or Release). The soak verdict, the
 * readings, the hardness, the release plan and every count are the server's: this screen shows them and never works
 * one out. Rework, discard and void stay on the web and say so.
 */
export function BatchView({ id }: { id: string }) {
  const { t } = useT();
  const query = useQuery({
    ...trpc.ageing.batches.get.queryOptions({ id }),
    refetchInterval: (q) => (q.state.data?.status === "in_oven" || q.state.data?.status === "out" ? BOARD_POLL_MS : false),
  });
  const batch = query.data;
  if (query.isError && !batch) {
    const notFound = (query.error as { data?: { code?: string } } | null)?.data?.code === "NOT_FOUND";
    return (
      <Screen>
        <PageHeader title={t("ageing.batch.title")} />
        {notFound ? <EmptyState title={t("ageing.refusal.batchNotFound")} /> : <ErrorBlock error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} />}
      </Screen>
    );
  }
  if (!batch) {
    return (
      <Screen>
        <PageHeader title={t("ageing.batch.title")} />
        <LoadingBlock />
      </Screen>
    );
  }
  return <BatchBody batch={batch} refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />;
}

function BatchBody({ batch, refreshing, onRefresh }: { batch: Batch; refreshing: boolean; onRefresh: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: me } = useMe();
  const now = useNow(30_000);
  const [dialog, setDialog] = useState<Dlg>(null);
  const [holdRow, setHoldRow] = useState<BatchRow | null>(null);
  const [holdBatch, setHoldBatch] = useState(false);
  const [unholdRow, setUnholdRow] = useState<BatchRow | null>(null);
  const [testRow, setTestRow] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice | null>(null);
  const action = nextAction(batch);
  const live = batch.status !== "closed" && batch.status !== "void";
  const perm = nextActionPermission(action);
  const mayAct = perm !== null && can(me, perm);
  const hasHeld = batch.rows.some((r) => r.status === "held");
  const askable = canRequestOverride(batch, hasHeld) && can(me, "ageing.release");
  const webOnly = webOnlyActions(batch);
  const subtitle = [t("ageing.floor.onTrolley", { trolley: batch.trolleyCode }), batch.ovenCode, batch.recipeLabel].filter(Boolean).join(", ");
  const open = (d: Dlg) => {
    setNotice(null);
    setDialog(d);
  };

  return (
    <View className="flex-1 bg-canvas">
      <Stack.Screen options={{ title: batch.number }} />
      <Screen onRefresh={onRefresh} refreshing={refreshing}>
        <PageHeader title={batch.number} subtitle={subtitle} right={<PhaseChip phase={batch.phase} />} />
        {notice ? <Note tone={notice.tone}>{notice.text}</Note> : null}
        {batch.status === "void" ? <Note tone="red">{batch.voidReason ? t("ageing.batch.voidWhy", { reason: batch.voidReason }) : t("ageing.status.void")}</Note> : <StageStepper current={stageIndex(batch)} />}
        <Links batch={batch} onOpen={(id) => router.push({ pathname: "/more/ageing/[id]", params: { id } })} />
        <Facts batch={batch} />
        <VerdictPanel batch={batch} askable={askable} onOverride={() => open("override")} />
        <Readings batch={batch} now={now} onAdd={() => open("temp")} />
        <Lines
          batch={batch}
          onTest={(rowId) => {
            setTestRow(rowId);
            open("hardness");
          }}
          onHold={setHoldRow}
          onUnhold={setUnholdRow}
        />
        {live && (batch.status === "out" || batch.status === "released") ? (
          <Can do="ageing.release">
            <Button variant="secondary" label={t("ageing.action.holdBatch")} onPress={() => setHoldBatch(true)} />
          </Can>
        ) : null}
        {batch.status === "closed" ? <Note>{t("ageing.batch.closedNote")}</Note> : null}
        {webOnly.length > 0 ? <WebOnly id={batch.id} actions={webOnly} /> : null}
        {live && action === "release" && !mayAct ? <Note>{t("ageing.next.askRelease")}</Note> : null}
        {live && mayAct && action !== "none" ? <View className="h-24" /> : null}
      </Screen>

      {live && mayAct && action !== "none" ? (
        <ActionBar
          batch={batch}
          action={action}
          bottom={insets.bottom}
          onOpen={(d) => {
            setTestRow(undefined);
            open(d);
          }}
          onDone={setNotice}
        />
      ) : null}

      <StartSheet visible={dialog === "start" && action === "start"} onClose={() => setDialog(null)} batch={batch} onDone={setNotice} />
      <TakeOutSheet visible={dialog === "out" && batch.status === "in_oven"} onClose={() => setDialog(null)} batch={batch} onDone={setNotice} />
      <TempSheet visible={dialog === "temp" && canAddReading(batch, now)} onClose={() => setDialog(null)} batch={batch} onDone={setNotice} />
      <HardnessSheet visible={dialog === "hardness" && (batch.status === "out" || batch.status === "held")} onClose={() => setDialog(null)} batch={batch} onDone={setNotice} rowId={testRow} />
      <OverrideSheet visible={dialog === "override" && askable} onClose={() => setDialog(null)} batch={batch} onDone={setNotice} />
      <HoldSheet
        visible={holdRow !== null || holdBatch}
        onClose={() => {
          setHoldRow(null);
          setHoldBatch(false);
        }}
        batch={batch}
        row={holdRow}
        onDone={setNotice}
      />
      <UnholdSheet batch={batch} row={unholdRow} onClose={() => setUnholdRow(null)} onDone={setNotice} />
    </View>
  );
}

function Links({ batch, onOpen }: { batch: Batch; onOpen: (id: string) => void }) {
  const { t } = useT();
  if (!batch.reworkOfBatchId && !batch.successorBatchId) return null;
  return (
    <View className="gap-2">
      {batch.reworkOfBatchId ? <Button variant="secondary" label={t("ageing.batch.reworkOf")} onPress={() => onOpen(batch.reworkOfBatchId!)} /> : null}
      {batch.successorBatchId ? <Button variant="secondary" label={t("ageing.batch.successor")} onPress={() => onOpen(batch.successorBatchId!)} /> : null}
    </View>
  );
}

function Facts({ batch }: { batch: Batch }) {
  const { t } = useT();
  const duration = useDuration();
  const format = useFormat();
  const when = (ms: number) => `${format.day(ms) ?? ""} ${format.time(ms) ?? ""}`.trim();
  const snap = batch.snapshot;
  return (
    <View className="gap-3 rounded-card border border-hairline bg-surface p-4">
      <View className="flex-row flex-wrap gap-x-4 gap-y-3">
        <Figure label={t("ageing.field.loaded")} value={t("ageing.pcsKg", { pcs: batch.totals.loadedPcs, kg: kgText(batch.totals.loadedKgG) })} />
        <Figure label={t("ageing.field.packable")} value={String(batch.totals.packablePcs)} />
        <Figure label={t("ageing.field.held")} value={String(batch.totals.heldPcs)} />
        <Figure label={t("ageing.field.packed")} value={String(batch.totals.packedPcs)} />
        <Figure label={t("ageing.field.remaining")} value={String(batch.totals.remainingPcs)} />
        <Figure label={t("ageing.field.theoreticalKg")} value={kgText(batch.totals.theoreticalRemainingKgG)} />
        {batch.totals.scrapPcs > 0 ? <Figure label={t("ageing.field.scrap")} value={String(batch.totals.scrapPcs)} /> : null}
        {batch.totals.reworkPcs > 0 ? <Figure label={t("ageing.field.reworked")} value={String(batch.totals.reworkPcs)} /> : null}
        {batch.inAt ? <Figure label={t("ageing.field.inAt")} value={when(batch.inAt)} /> : null}
        {batch.outAt ? <Figure label={t("ageing.field.outAt")} value={when(batch.outAt)} /> : null}
        {batch.productionDay ? <Figure label={t("ageing.field.day")} value={batch.productionDay} /> : null}
        {batch.gasStartMilli !== null ? <Figure label={t("ageing.field.gasStart")} value={gasText(batch.gasStartMilli)} /> : null}
        {batch.gasEndMilli !== null ? <Figure label={t("ageing.field.gasEnd")} value={gasText(batch.gasEndMilli)} /> : null}
        {batch.gasUsedMilli !== null ? <Figure label={t("ageing.field.gasUsed")} value={gasText(batch.gasUsedMilli)} /> : null}
      </View>
      {batch.capacity !== "unknown" && batch.capacity !== "ok" ? <Chip tone={capacityTone(batch.capacity)} label={t(`ageing.capacity.${batch.capacity}`)} /> : null}
      {snap ? (
        <Text className="border-t border-hairline pt-3 font-sans text-sm leading-6 text-ink-muted">
          <Text className="font-sans-semibold text-ink">{batch.recipeLabel}</Text>
          {`, ${recipeLine(t, duration, snap)}`}
        </Text>
      ) : null}
    </View>
  );
}

/** The soak verdict panel (ok, under-aged, over-aged, no readings) and, once judged, the approval state. All the server's. */
function VerdictPanel({ batch, askable, onOverride }: { batch: Batch; askable: boolean; onOverride: () => void }) {
  const { t } = useT();
  const duration = useDuration();
  const soak = batch.soak;
  const hasHeld = batch.rows.some((r) => r.status === "held");
  const showSoak = soak && batch.status !== "loading";
  if (!showSoak && !batch.pendingOverrideId && !batch.overrideApprovalId && !hasHeld) return null;
  return (
    <Section title={t("ageing.verdict.title")}>
      <View className="flex-row flex-wrap items-center gap-2">
        {soak && showSoak ? <SoakChip verdict={soak.verdict} /> : null}
        {batch.qcVerdict ? <Chip tone={batch.qcVerdict === "fail" ? "red" : "green"} label={t(`ageing.qcVerdict.${batch.qcVerdict}`)} /> : null}
      </View>
      {soak && showSoak ? (
        <>
          <View className="flex-row flex-wrap gap-x-4 gap-y-3">
            <Figure label={t("ageing.verdict.inBand")} value={batch.snapshot ? t("ageing.verdict.inBandOf", { min: duration(soak.inBandMin), total: duration(batch.snapshot.soakMin) }) : duration(soak.inBandMin)} />
            <Figure label={t("ageing.verdict.above")} value={duration(soak.aboveBandMin)} />
            <Figure label={t("ageing.verdict.below")} value={duration(soak.belowBandMin)} />
            <Figure label={t("ageing.verdict.unknown")} value={duration(soak.unknownMin)} />
          </View>
          <Text className="font-sans text-sm leading-6 text-ink-muted">
            {t(`ageing.verdict.say.${soak.verdict}`, {
              short: batch.snapshot ? duration(Math.max(0, batch.snapshot.soakMin - soak.inBandMin)) : "",
              over: batch.snapshot?.maxSoakMin != null ? duration(Math.max(0, soak.inBandMin - batch.snapshot.maxSoakMin)) : "",
              above: duration(soak.aboveBandMin),
            })}
            {soak.unknownMin > 0 ? ` ${t("ageing.verdict.unknownHint")}` : ""}
          </Text>
        </>
      ) : null}
      {batch.pendingOverrideId ? (
        <Note tone="amber">{t("ageing.override.pending")}</Note>
      ) : batch.overrideApprovalId && (batch.status === "held" || batch.status === "out") ? (
        <Note tone="green">{t("ageing.override.approved")}</Note>
      ) : null}
      {askable ? <Button variant="secondary" label={t("ageing.action.requestOverride")} onPress={onOverride} /> : null}
    </Section>
  );
}

/** The readings: a line against the band, the figures, and the log (typed ones and the oven collector's, which are read-only). */
function Readings({ batch, now, onAdd }: { batch: Batch; now: number; onAdd: () => void }) {
  const { t } = useT();
  const duration = useDuration();
  const format = useFormat();
  const [all, setAll] = useState(false);
  const snap = batch.snapshot;
  const band = snap ? { lowX10: snap.targetTempX10 - snap.toleranceX10, highX10: snap.targetTempX10 + snap.toleranceX10 } : null;
  const progress = soakProgress(batch.soakStartedAt, snap?.soakMin ?? null, batch.outAt ?? now);
  if (batch.status === "loading" || batch.status === "void") return null;
  const sorted = [...batch.readings].sort((a, b) => b.at - a.at);
  const shown = all ? sorted : sorted.slice(0, 8);
  const hasFeed = batch.readings.some((r) => r.source === "telemetry");
  return (
    <Section title={t("ageing.readings.title")} hint={snap ? t("ageing.readings.target", { temp: x10Text(snap.targetTempX10), tol: x10Text(snap.toleranceX10) }) : undefined}>
      <TempSpark readings={batch.readings} band={band} height={88} />
      <View className="flex-row flex-wrap gap-x-4 gap-y-3">
        <Figure label={t("ageing.floor.lastTemp")} value={batch.lastTempCX10 === null ? "-" : `${x10Text(batch.lastTempCX10)} °C`} />
        <Figure label={t("ageing.field.minMax")} value={batch.soak && batch.soak.minX10 !== null ? `${x10Text(batch.soak.minX10)} / ${x10Text(batch.soak.maxX10)}` : "-"} />
        {progress && snap ? <Figure label={t("ageing.floor.soakOf", { total: duration(snap.soakMin) })} value={duration(progress.elapsedMin)} /> : null}
      </View>
      {batch.simulator && batch.readings.some((r) => r.source === "simulator") ? <Chip tone="blue" label={t("ageing.simulator")} /> : null}
      {canAddReading(batch, now) ? (
        <Can do="ageing.record">
          <Button size="lg" label={t("ageing.readings.addReading")} onPress={onAdd} />
        </Can>
      ) : null}
      {hasFeed ? <Text className="font-sans text-[13px] text-ink-muted">{t("ageing.readings.feedNote")}</Text> : null}
      {sorted.length === 0 ? <Text className="font-sans text-sm text-ink-muted">{t("ageing.readings.empty")}</Text> : null}
      <View className="gap-2">
        {shown.map((r) => (
          <View key={r.id} accessible accessibilityLabel={`${format.time(r.at) ?? ""}, ${x10Text(r.tempCX10)} °C, ${r.inBand ? t("ageing.readings.inBand") : t("ageing.readings.outBand")}, ${t(`ageing.tempSource.${r.source}`)}`} className="min-h-11 flex-row items-center justify-between gap-2 border-b border-hairline pb-2">
            <Text className="font-mono text-sm text-ink-muted">{`${format.day(r.at) ?? ""} ${format.time(r.at) ?? ""}`.trim()}</Text>
            <Text className="font-mono-semibold text-base text-ink">{x10Text(r.tempCX10)}</Text>
            <View className="items-end gap-1">
              <Chip tone={r.inBand ? "green" : "neutral"} label={r.inBand ? t("ageing.readings.inBand") : t("ageing.readings.outBand")} />
              {r.source !== "typed" ? <Chip tone="blue" label={t(`ageing.tempSource.${r.source}`)} /> : null}
            </View>
          </View>
        ))}
      </View>
      {sorted.length > 8 ? <Button variant="ghost" label={all ? t("ageing.readings.showLess") : t("ageing.readings.showAll", { count: sorted.length })} onPress={() => setAll((v) => !v)} /> : null}
    </Section>
  );
}

function Lines({ batch, onTest, onHold, onUnhold }: { batch: Batch; onTest: (rowId: string) => void; onHold: (row: BatchRow) => void; onUnhold: (row: BatchRow) => void }) {
  const { t, locale } = useT();
  const router = useRouter();
  const needReasons = batch.rows.some((r) => r.holdReasonCodeId);
  const holdReasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "ageing_hold", includeInactive: true }), staleTime: 5 * 60_000, enabled: needReasons });
  const rejectReasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "ageing_reject", includeInactive: true }), staleTime: 5 * 60_000, enabled: needReasons });
  const holdWhy = (r: BatchRow): string | null => {
    if (!r.holdReasonCodeId) return null;
    const hold = holdReasons.data?.find((x) => x.id === r.holdReasonCodeId);
    if (hold) return reasonCodeText(t, "ageing_hold", hold.code, holdReasons.data, locale);
    const reject = rejectReasons.data?.find((x) => x.id === r.holdReasonCodeId);
    return reject ? reasonCodeText(t, "ageing_reject", reject.code, rejectReasons.data, locale) : null;
  };
  const rows = batch.rows.filter((r) => r.status !== "void");
  return (
    <Section title={t("ageing.batch.lines")} hint={batch.status === "loading" && rows.length === 0 ? undefined : t("ageing.batch.linesHint")}>
      {rows.length === 0 ? <Text className="font-sans text-sm text-ink-muted">{t("ageing.empty.noRows")}</Text> : null}
      {rows.map((r) => {
        const why = r.status === "held" ? holdWhy(r) : null;
        const retest = batch.status === "held" && r.status === "held" && r.hardnessPass === false;
        const testable = (batch.status === "out" && r.status === "pending") || retest;
        return (
          <View key={r.id} className="gap-2 rounded-card border border-hairline bg-surface-sunken p-3">
            <View className="flex-row items-start justify-between gap-2">
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="font-sans-semibold text-base text-ink">{r.sectionLabel}</Text>
                <Text className="font-sans text-[13px] text-ink-muted">
                  {[r.dieInstanceCode, r.source === "bundle" ? r.bundleSerial : null, r.pressRunNumber, r.source !== "press" ? t(`ageing.source.${r.source}`) : null].filter(Boolean).join(", ")}
                </Text>
              </View>
              <RowChip status={r.status} />
            </View>
            <View className="flex-row flex-wrap gap-x-4 gap-y-2">
              <Figure label={t("ageing.field.cutLength")} value={`${r.lengthMm} mm`} />
              <Figure label={t("ageing.field.pieces")} value={String(r.pcs)} />
              <Figure label={t("ageing.field.remaining")} value={String(r.remainingPcs)} strong />
              {r.castCode ? <Figure label={t("ageing.field.cast")} value={r.castCode} /> : null}
            </View>
            {r.salesOrderNumber ? <Text className="font-sans text-[13px] text-ink-muted">{[r.salesOrderNumber, r.customerName, r.customerPo ? `PO ${r.customerPo}` : null].filter(Boolean).join(", ")}</Text> : null}
            <View className="flex-row flex-wrap items-center gap-2">
              {r.hardnessReadingX10 === null ? (
                <Text className="font-sans text-sm text-ink-muted">{t("ageing.hardness.untested")}</Text>
              ) : (
                <>
                  <Text className={r.hardnessPass === null ? "font-mono-medium text-base text-ink-muted" : "font-mono-medium text-base text-ink"}>
                    {`${x10Text(r.hardnessReadingX10)} ${r.hardnessMethod ? t(`ageing.method.${r.hardnessMethod}`) : ""}`.trim()}
                  </Text>
                  {r.hardnessPass === null ? null : <Chip tone={hardnessTone(r.hardnessPass)} label={r.hardnessPass ? t("ageing.readings.pass") : t("ageing.readings.fail")} />}
                </>
              )}
            </View>
            {why ? <Text className="font-sans text-sm text-tone-red-ink">{why}</Text> : null}
            {r.holdNote ? <Text className="font-sans text-sm text-ink-muted">{r.holdNote}</Text> : null}
            <View className="flex-row flex-wrap gap-2">
              {testable ? (
                <Can do="ageing.record">
                  <Button variant="secondary" label={r.status === "held" ? t("ageing.action.retest") : t("ageing.action.hardness")} onPress={() => onTest(r.id)} />
                </Can>
              ) : null}
              {canHoldRow(batch, r) ? (
                <Can do="ageing.release">
                  <Button variant="ghost" label={t("ageing.action.hold")} onPress={() => onHold(r)} />
                </Can>
              ) : null}
              {canUnholdRow(r) && r.holdReasonCodeId && holdReasons.data?.some((x) => x.id === r.holdReasonCodeId) ? (
                <Can do="ageing.release">
                  <Button variant="secondary" label={t("ageing.action.unhold")} onPress={() => onUnhold(r)} />
                </Can>
              ) : null}
            </View>
          </View>
        );
      })}
      {rowsToTest(batch).length > 0 && batch.status === "out" ? <Text className="font-sans text-sm text-ink-muted">{t("ageing.batch.testFirst", { count: rowsToTest(batch).length })}</Text> : null}
      {batch.status === "loading" && rows.length > 0 ? (
        <Can do="ageing.load">
          <Button variant="secondary" label={t("ageing.batch.addMore")} onPress={() => router.push({ pathname: "/more/ageing/load", params: { trolley: batch.trolleyId } })} />
        </Can>
      ) : batch.status === "loading" && rows.length === 0 ? (
        <Can do="ageing.load">
          <Button variant="secondary" label={t("ageing.action.load")} onPress={() => router.push({ pathname: "/more/ageing/load", params: { trolley: batch.trolleyId } })} />
        </Can>
      ) : null}
    </Section>
  );
}

/** Age again, discard the rest and void are done on the web. This says which of them apply to this batch and opens its page there. */
function WebOnly({ id, actions }: { id: string; actions: ("rework" | "discard" | "void")[] }) {
  const { t } = useT();
  const labels = { rework: t("ageing.action.rework"), discard: t("ageing.action.discard"), void: t("ageing.action.void") } as const;
  return (
    <Can do="ageing.release">
      <Section title={t("native.web.title")} hint={actions.map((a) => labels[a]).join(", ")}>
        <PressableScale
          accessibilityRole="link"
          accessibilityLabel={`${t("native.web.title")}: ${actions.map((a) => labels[a]).join(", ")}`}
          accessibilityHint={t("native.web.hint")}
          onPress={() => void Linking.openURL(webUrl(batchWebPath(id))).catch(() => {})}
          className="min-h-14 flex-row items-center justify-center rounded-input border border-control bg-surface px-4"
        >
          <Text className="font-sans-semibold text-base text-ink">{t("native.web.title")}</Text>
        </PressableScale>
      </Section>
    </Can>
  );
}

/**
 * The one primary action at the bottom: Start and Take out and Record hardness open their sheet; Release sends
 * `ageing.batches.release` with a replay key. A release holds the lines that failed and says how many; an approval
 * can release them when the server says one would help.
 */
function ActionBar({ batch, action, bottom, onOpen, onDone }: { batch: Batch; action: NextAction; bottom: number; onOpen: (d: "start" | "out" | "hardness") => void; onDone: (notice: Notice) => void }) {
  const { t } = useT();
  const refresh = useAgeingRefresh();
  const release = useMutation(trpc.ageing.batches.release.mutationOptions());
  const write = useKeyedWrite(refresh);
  const [helps, setHelps] = useState(false);
  const label = { start: t("ageing.action.start"), takeOut: t("ageing.action.takeOut"), hardness: t("ageing.action.hardness"), release: t("ageing.action.release"), none: "" }[action];
  const press = async () => {
    if (action === "start") return onOpen("start");
    if (action === "takeOut") return onOpen("out");
    if (action === "hardness") return onOpen("hardness");
    const body = { batchId: batch.id };
    const res = await write.run(body, (clientMutationId) => release.mutateAsync({ ...body, clientMutationId }));
    if (!res) return;
    const held = res.rows.filter((r) => r.status === "held").length;
    setHelps(held > 0 && res.overrideWouldHelp);
    const text = held > 0 ? t("ageing.release.partial", { count: held }) : t("ageing.release.done", { number: batch.number });
    announce(text);
    onDone({ tone: held > 0 ? "amber" : "green", text });
    await refresh();
  };
  return (
    <View style={{ paddingBottom: Math.max(bottom, 12) }} className="gap-2 border-t border-hairline bg-canvas px-4 pt-3">
      <ErrorLine error={write.error} />
      {helps ? <Text className="font-sans text-sm text-ink-muted">{t("ageing.release.overrideHelps")}</Text> : null}
      <Text className="font-sans-medium text-sm text-ink-muted">{t(`ageing.next.${action === "none" ? "release" : action}`)}</Text>
      <Button size="lg" label={label} loading={write.pending} onPress={() => void press()} />
    </View>
  );
}
