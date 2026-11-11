import { dispatchActions, dispatchTone, vehicleGate } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Switch, Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { announce } from "@/lib/a11y";
import { toEntering } from "@/lib/entering";
import { feedback } from "@/lib/feedback";
import { popEntering } from "@/lib/motion";
import { AnimatedView } from "@/lib/nativewind-interop";
import { useReduceMotion } from "@/lib/reduced-motion";
import { saveErrorText } from "@/lib/save-error";
import { useFormat } from "@/lib/use-format";
import { can, useMe } from "@/utils/me";
import { queryClient, trpc } from "@/utils/trpc";

import { ActionBar } from "@/features/dispatch/action-bar";
import { CapacityBanner } from "@/features/dispatch/capacity-banner";
import { capacityView, completeExtras, overRaceAfterComplete, overReasonError } from "@/features/dispatch/capacity";
import { completeRefusalText, offBandNote, offBandStops, overdrawLines } from "@/features/dispatch/off-band";
import { lateCheck, lateExtras, lateStart, lockedCheck, type LateCheck } from "@/features/dispatch/late-entry";
import { kgTotal } from "@/features/dispatch/format";
import { hasTransport, transportFacts } from "@/features/dispatch/transport";
import { ConfirmSheet } from "@/features/dispatch/confirm-sheet";
import { dispatchNow } from "@/features/dispatch/dispatch-now";
import { GroupCard } from "@/features/dispatch/group-card";
import { dispatchTotals, groupItems, type ItemGroup } from "@/features/dispatch/group-items";
import { LabelSheet } from "@/features/dispatch/label-sheet";
import { nextStep, showsActionBar, stepPerms } from "@/features/dispatch/next-step";
import { PackingListSection } from "@/features/dispatch/packing-list-section";
import { PasteSheet } from "@/features/dispatch/paste-sheet";
import { shipDayLine } from "@/features/dispatch/ship-date";
import { DispatchStepper } from "@/features/dispatch/stepper";
import { randomId } from "@/lib/random-id";
import { replayKey, sendOnce, type ReplayAttempt } from "@/lib/replay-key";
import type { AddBundlesReport } from "@/features/scan/outcome";
import type { ResolveHit } from "@/features/scan/scan-flow";

type Item = NonNullable<ReturnType<typeof useDispatchQuery>["data"]>["items"][number];
type Sheet = "paste" | "dispatch" | "cancel" | "delete" | "regenerate" | { remove: Item } | { label: ItemGroup<Item> } | null;

function useDispatchQuery(id: string) {
  return useQuery(trpc.dispatch.getDispatch.queryOptions({ id }));
}

const isNotFound = (error: unknown) => (error as { data?: { code?: unknown } } | null)?.data?.code === "NOT_FOUND";

/**
 * One dispatch, from building to the packing list. Items are grouped like the
 * printed list; the bottom bar holds the one next step (Scan bundles, Hold
 * stock or Dispatch) as a large button. Every write goes through
 * `saveErrorText`: an unsure save never says it worked, and Dispatch re-reads
 * the dispatch before it decides what happened.
 */
export default function DispatchDetailScreen() {
  const { t } = useT();
  const router = useRouter();
  const format = useFormat();
  const reduceMotion = useReduceMotion();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: me } = useMe();

  const detail = useDispatchQuery(id);
  const status = detail.data?.dispatch.status;
  const plQuery = useQuery({ ...trpc.packingList.byDispatch.queryOptions({ dispatchId: id }), enabled: status === "completed" });

  const reserve = useMutation(trpc.dispatch.reserve.mutationOptions());
  const unreserve = useMutation(trpc.dispatch.unreserve.mutationOptions());
  const complete = useMutation(trpc.dispatch.complete.mutationOptions());
  const saveVehicle = useMutation(trpc.dispatch.update.mutationOptions());
  const cancel = useMutation(trpc.dispatch.cancel.mutationOptions());
  const softDelete = useMutation(trpc.dispatch.softDelete.mutationOptions());
  const removeBundle = useMutation(trpc.dispatch.removeBundle.mutationOptions());
  const setLabel = useMutation(trpc.dispatch.setItemGroupLabel.mutationOptions());
  const scanSerials = useMutation(trpc.dispatch.scan.mutationOptions());
  const pasteAttempt = useRef<ReplayAttempt>(null);
  const regenerate = useMutation(trpc.packingList.regenerate.mutationOptions());

  const [sheet, setSheet] = useState<Sheet>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Why the load goes over the truck's capacity: asked at Dispatch, kept with the dispatch (FP-PK-12).
  const [overReason, setOverReason] = useState("");
  const [overTried, setOverTried] = useState(false);
  // BACKLOG 62: no vehicle in the header, so the Dispatch sheet asks for it and saves it first.
  const [vehicle, setVehicle] = useState("");
  const [vehicleError, setVehicleError] = useState<"missing" | "invalid" | null>(null);
  // Arch 52: the truck left while the line or the internet was down; entered at that time.
  const timeZone = format.zone;
  const [late, setLate] = useState(false);
  const [lateDate, setLateDate] = useState("");
  const [lateTime, setLateTime] = useState("");
  const [lateReason, setLateReason] = useState("");
  const [lateError, setLateError] = useState<Extract<LateCheck, { kind: "error" }> | null>(null);
  // Review 5: locked to the time already asked for until "Use another time".
  const [lateLocked, setLateLocked] = useState(false);
  const [banner, setBanner] = useState<{ title: string; body: string } | null>(null);
  const [justDispatched, setJustDispatched] = useState(false);
  // Remembers that the hold went through, so a retry after a failed complete does not hold twice (ruling T22).
  const held = useRef({ held: false });
  // Review 5: the time already asked for (waiting or approved) fills the sheet and locks it.
  const lateAsk = detail.data?.lateEntry ?? null;
  const fillLate = () => {
    const start = lateStart(lateAsk, timeZone);
    setLate(start.late);
    setLateDate(start.date);
    setLateTime(start.time);
    setLateReason(start.reason);
    setLateError(null);
    setLateLocked(start.locked);
  };
  // Again while the sheet is open, when a press opens the request or a manager decides it.
  const askKey = lateAsk ? `${lateAsk.approvalId}:${lateAsk.status}` : "";
  useEffect(() => {
    if (sheet === "dispatch" && lateAsk) fillLate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the ask itself changes
  }, [askKey]);

  const refresh = () => {
    void queryClient.invalidateQueries(trpc.dispatch.pathFilter());
    void queryClient.invalidateQueries(trpc.packingList.pathFilter());
    void queryClient.invalidateQueries(trpc.stock.pathFilter());
    void queryClient.invalidateQueries(trpc.bundle.pathFilter());
  };

  const openSheet = (next: Sheet) => {
    setSheetError(null);
    if (next === "dispatch") {
      setOverReason("");
      setOverTried(false);
      setVehicle("");
      setVehicleError(null);
      fillLate();
    }
    setSheet(next);
  };
  const closeSheet = () => {
    setSheet(null);
    setSheetError(null);
  };

  /** A failed save, said honestly (unsure vs failed), on the page or inside the open sheet. */
  const fail = (error: unknown, inSheet: boolean) => {
    feedback.error();
    const text = saveErrorText(t, error);
    announce(`${text.title}. ${text.body}`, { shownInLiveRegion: true });
    if (inSheet) setSheetError(text.body);
    else setBanner({ title: text.title, body: text.body });
  };

  const done = (message: string) => {
    feedback.success();
    announce(message);
    setBanner(null);
    refresh();
  };

  if (detail.isPending) {
    return (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }
  if (!detail.data) {
    return (
      <Screen>
        {isNotFound(detail.error) ? (
          <EmptyState title={t("errors.notFoundInCompany")} actionLabel={t("dispatch.title")} onAction={() => router.replace("/dispatch")} />
        ) : (
          <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isRefetching} />
        )}
      </Screen>
    );
  }

  const { dispatch: d, customer, items } = detail.data;
  const customerName = customer?.name ?? "";
  const actions = dispatchActions(d.status);
  // Q36 decided: off-band rows waiting or rejected hold Dispatch (Hold stock stays open).
  const offNote = offBandNote(detail.data.offBand);
  // pl-flow 61: lines past ordered + tolerance, in amber (a manager is asked at the scan or at Dispatch).
  const overOrder = overdrawLines(detail.data.overdraw);
  const live = items.filter((i) => i.status !== "void");
  const voided = items.filter((i) => i.status === "void");
  const groups = groupItems(items);
  const totals = dispatchTotals(items);
  const editable = (d.status === "draft" || d.status === "reserved") && can(me, "dispatch.addBundle");
  const step = nextStep(d.status, live.length, stepPerms(me, d.status));
  const pl = plQuery.data ?? null;
  const capacity = capacityView(detail.data.capacity);
  const transport = transportFacts(d);

  const scan = () => router.navigate({ pathname: "/scan", params: { dispatchId: d.id, code: d.code } });

  const hold = async () => {
    setBusy(true);
    try {
      await reserve.mutateAsync({ id: d.id });
      held.current.held = true;
      done(t("dispatch.held"));
    } catch (error) {
      fail(error, false);
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    setBusy(true);
    try {
      await unreserve.mutateAsync({ id: d.id });
      held.current.held = false;
      done(t("dispatch.released"));
    } catch (error) {
      fail(error, false);
    } finally {
      setBusy(false);
    }
  };

  const dispatchIt = async () => {
    const gate = vehicleGate(d.vehicleNo, vehicle);
    if (gate.kind === "missing" || gate.kind === "invalid") {
      setVehicleError(gate.kind);
      feedback.error();
      return;
    }
    // Over the truck's capacity needs a reason; the server refuses without it and audits it.
    if (overReasonError(capacity, overReason)) {
      setOverTried(true);
      return;
    }
    const lateSend = !late ? null : lateLocked && lateAsk ? lockedCheck(lateAsk) : lateCheck(lateDate, lateTime, lateReason, timeZone, Date.now());
    if (lateSend?.kind === "error") {
      setLateError(lateSend);
      feedback.error();
      return;
    }
    setBusy(true);
    setSheetError(null);
    try {
      if (gate.kind === "save") await saveVehicle.mutateAsync({ id: d.id, vehicleNo: gate.vehicleNo });
      await dispatchNow(d.status, held.current, {
        reserve: () => reserve.mutateAsync({ id: d.id }),
        complete: () => complete.mutateAsync({ id: d.id, ...completeExtras(capacity, overReason), ...lateExtras(lateSend) }),
      });
      setJustDispatched(true);
      closeSheet();
      done(t("dispatch.dispatched"));
    } catch (error) {
      // Never claim Dispatched on a guess: ask the server what state it is in.
      const fresh = await detail.refetch();
      if (fresh.data?.dispatch.status === "completed") {
        setJustDispatched(true);
        closeSheet();
        done(t("dispatch.dispatched"));
      } else if (overRaceAfterComplete(error, completeExtras(capacity, overReason).capacityOverrideReason !== undefined, fresh.data?.capacity)) {
        // The load went over while the sheet was open: keep it open and ask why.
        feedback.error();
        setOverTried(true);
        setSheetError(t("dispatch.capacity.reasonRequired"));
        announce(t("dispatch.capacity.reasonRequired"), { shownInLiveRegion: true });
        refresh();
      } else if (completeRefusalText(t, error)) {
        // A dispatch rule refused it (off-band rows): say which rule and what to do.
        const text = completeRefusalText(t, error)!;
        feedback.error();
        setSheetError(text);
        announce(text, { shownInLiveRegion: true });
        refresh();
      } else {
        fail(error, true);
        refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelIt = async () => {
    setBusy(true);
    try {
      await cancel.mutateAsync({ id: d.id });
      closeSheet();
      done(t("dispatch.cancelled"));
    } catch (error) {
      fail(error, true);
    } finally {
      setBusy(false);
    }
  };

  const deleteIt = async () => {
    setBusy(true);
    try {
      await softDelete.mutateAsync({ id: d.id });
      closeSheet();
      done(t("dispatch.deleted"));
      router.replace("/dispatch");
    } catch (error) {
      // An unsure delete may have gone through: if the dispatch is gone, that is the answer.
      const fresh = await detail.refetch();
      if (isNotFound(fresh.error)) {
        closeSheet();
        done(t("dispatch.deleted"));
        router.replace("/dispatch");
      } else {
        fail(error, true);
      }
    } finally {
      setBusy(false);
    }
  };

  const removeIt = async (item: Item) => {
    setBusy(true);
    try {
      await removeBundle.mutateAsync({ id: d.id, bundleId: item.bundleId });
      closeSheet();
      done(t("dispatch.build.removed", { serial: item.serial }));
    } catch (error) {
      fail(error, true);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const labelIt = async (group: ItemGroup<Item>, label: string | null) => {
    setBusy(true);
    try {
      // The server keeps a label per bundle: a group is relabelled bundle by bundle.
      for (const b of group.bundles) await setLabel.mutateAsync({ id: d.id, bundleId: b.bundleId, groupLabel: label });
      closeSheet();
      done(t("common.saved"));
    } catch (error) {
      fail(error, true);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const regenerateIt = async () => {
    if (!pl) return;
    setBusy(true);
    try {
      await regenerate.mutateAsync({ id: pl.id });
      closeSheet();
      done(t("packingList.regenerated"));
    } catch (error) {
      fail(error, true);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  // The floor add (`dispatch.scan`), one request id per pasted chunk: a lost reply is sent once more with the same id.
  const send = (serials: string[]): Promise<AddBundlesReport> => {
    const next = replayKey(pasteAttempt.current, { id: d.id, serials }, randomId);
    pasteAttempt.current = next.attempt;
    return sendOnce((clientRequestId) => scanSerials.mutateAsync({ id: d.id, serials, clientRequestId }), next.id).then((report) => {
      pasteAttempt.current = null;
      return report as AddBundlesReport;
    });
  };
  const resolve = (code: string) => queryClient.fetchQuery({ ...trpc.resolve.byCode.queryOptions({ code }), staleTime: 0 }) as Promise<ResolveHit>;

  const kg = kgTotal(totals.weightG);
  const removing = typeof sheet === "object" && sheet && "remove" in sheet ? sheet.remove : null;
  const labelling = typeof sheet === "object" && sheet && "label" in sheet ? sheet.label : null;

  return (
    <>
      <Stack.Screen options={{ title: d.code }} />
      <View className="flex-1 bg-canvas">
        <Screen onRefresh={() => void Promise.all([detail.refetch(), plQuery.refetch()])} refreshing={detail.isRefetching}>
          <PageHeader
            title={customerName}
            subtitle={[d.code, shipDayLine(detail.data.shipDay, format.day, t)].join(" · ")}
            right={<Chip tone={dispatchTone(d.status)} label={t(`status.dispatch.${d.status}`)} />}
          />
          {d.notes ? <Text className="font-sans text-[15px] leading-6 text-ink-muted">{d.notes}</Text> : null}
          <DispatchStepper status={d.status} />
          {d.status === "reserved" ? <Text className="font-sans text-[15px] text-ink-muted">{t("dispatch.heldNote")}</Text> : null}
          {hasTransport(transport) ? (
            <View accessible accessibilityLabel={[transport.transporter, transport.vehicleNo, transport.driver].filter(Boolean).join(", ")} className="gap-1 rounded-card border border-hairline bg-surface px-4 py-3">
              {transport.transporter ? <Text className="font-sans-semibold text-[15px] text-ink">{`${t("dispatch.transporter.label")}: ${transport.transporter}`}</Text> : null}
              {transport.vehicleNo ? <Text className="font-mono-semibold text-[15px] text-ink">{`${t("dispatch.header.vehicleNo")}: ${transport.vehicleNo}`}</Text> : null}
              {transport.driver ? <Text className="font-sans text-[15px] text-ink-muted">{`${t("dispatch.header.driverName")}: ${transport.driver}`}</Text> : null}
            </View>
          ) : null}
          {d.status !== "completed" ? <CapacityBanner capacity={detail.data.capacity} /> : null}
          {d.status !== "completed" && offNote ? (
            <View accessibilityLiveRegion="polite" testID="dispatch-off-band-note" className="rounded-card bg-tone-amber-tint p-4">
              <Text className="font-sans text-[15px] leading-6 text-tone-amber-ink">{t(offNote.key, { count: offNote.count })}</Text>
            </View>
          ) : null}
          {d.status !== "completed" && overOrder ? (
            <View accessibilityLiveRegion="polite" testID="dispatch-over-tolerance" className="gap-1 rounded-card bg-tone-amber-tint p-4">
              {overOrder.lines.map((l) => (
                <Text key={l.lineId} className="font-sans-semibold text-[15px] text-tone-amber-ink">
                  {t("dispatch.overTolerance.line", { pct: l.pct, order: l.orderNumber, line: l.lineNo, kg: kgTotal(l.overG) })}
                </Text>
              ))}
              <Text className="font-sans text-[15px] leading-6 text-tone-amber-ink">{t(overOrder.statusKey)}</Text>
            </View>
          ) : null}

          {banner ? (
            <View accessibilityLiveRegion="polite" className="gap-1 rounded-card bg-tone-red-tint p-4">
              <Text className="font-sans-semibold text-base text-tone-red-ink">{banner.title}</Text>
              <Text className="font-sans text-[15px] leading-6 text-tone-red-ink">{banner.body}</Text>
            </View>
          ) : null}

          {d.status === "completed" ? (
            <AnimatedView entering={justDispatched ? toEntering(popEntering(reduceMotion)) : undefined}>
              <View accessible accessibilityLabel={`${t("dispatch.dispatched")}, ${customerName}, ${kg} kg`} className="gap-1 rounded-block bg-tone-green p-[18px]">
                <Text className="font-display-bold text-xl text-tone-green-on">{t("dispatch.dispatched")}</Text>
                <Text className="font-sans-medium text-[15px] text-tone-green-on">{t("native.dispatch.doneMeta", { customer: customerName })}</Text>
                <Text className="mt-3 font-mono-semibold text-[32px] leading-[42px] text-tone-green-on">{`${kg} kg`}</Text>
                <Text className="font-sans-medium text-[15px] text-tone-green-on">{t("packingList.totals", { bundles: totals.bundles, kg })}</Text>
              </View>
            </AnimatedView>
          ) : null}

          <View className="gap-3">
            <View className="flex-row items-baseline justify-between gap-3">
              <Text accessibilityRole="header" className="font-display-bold text-xl text-ink">
                {t("native.dispatch.bundlesHeading")}
              </Text>
              <Text className="font-sans-semibold text-[15px] text-ink-muted">{t("packingList.totals", { bundles: totals.bundles, kg })}</Text>
            </View>
            {editable ? (
              <View className="flex-row gap-2">
                <Button className="flex-1" variant="secondary" label={t("dispatch.build.scanBundles")} onPress={scan} />
                <Button className="flex-1" variant="secondary" label={t("dispatch.build.pasteSerials")} onPress={() => openSheet("paste")} />
              </View>
            ) : null}
            {live.length === 0 && voided.length === 0 ? <EmptyState title={t("dispatch.build.empty")} /> : null}
            {groups.map((group) => (
              <GroupCard
                key={group.key}
                group={group}
                editable={editable}
                onEditLabel={(g) => openSheet({ label: g })}
                onRemove={(item) => openSheet({ remove: item })}
              />
            ))}
            {voided.map((b) => (
              <View key={b.itemId} className="flex-row items-center gap-3 rounded-card bg-tone-amber-tint px-4 py-2">
                <View className="min-w-0 flex-1">
                  <Text className="font-mono-semibold text-base text-tone-amber-ink">{b.serial}</Text>
                  <Text className="font-sans text-sm text-tone-amber-ink">{t("status.bundle.void")}</Text>
                </View>
                {editable ? <Button variant="secondary" label={t("dispatch.build.removeBundle", { serial: b.serial })} onPress={() => openSheet({ remove: b })} /> : null}
              </View>
            ))}
          </View>

          {d.status === "completed" && d.lateEntry && d.completedAt ? (
            // Arch 52: entered after the line came back, at the time the truck left.
            <View className="flex-row flex-wrap items-center gap-2" testID="late-entry-note">
              <Chip tone="amber" label={t("dispatch.late.chip")} />
              <Text className="min-w-0 flex-1 font-sans text-sm text-muted-foreground">
                {t("dispatch.late.left", { when: `${format.day(d.completedAt)} ${format.time(d.completedAt)}`, reason: d.lateEntryReason ?? "" })}
              </Text>
            </View>
          ) : null}

          {d.status === "completed" ? (
            plQuery.isPending ? (
              <LoadingBlock />
            ) : pl ? (
              <PackingListSection list={pl} dispatchCode={d.code} regenerating={busy && sheet === "regenerate"} onRegenerate={() => openSheet("regenerate")} />
            ) : (
              <Text className="font-sans text-[15px] text-ink-muted">{t("native.dispatch.noPackingList")}</Text>
            )
          ) : null}

          {actions.canCancel || actions.canDelete ? (
            <View className="gap-2">
              {actions.canCancel ? (
                <Can do="dispatch.cancel">
                  <Button variant="secondary" label={t("dispatch.cancel")} onPress={() => openSheet("cancel")} />
                </Can>
              ) : null}
              {actions.canDelete ? (
                <Can do="dispatch.delete">
                  <Button variant="ghost" label={t("dispatch.delete")} onPress={() => openSheet("delete")} />
                </Can>
              ) : null}
            </View>
          ) : null}
        </Screen>

        {showsActionBar(step) ? (
          <ActionBar>
            {step.secondary.length > 0 ? (
              <View className="flex-row gap-2">
                {step.secondary.map((s) => (
                  <Button
                    key={s}
                    className="flex-1"
                    variant="secondary"
                    label={s === "hold" ? t("dispatch.holdStock") : t("dispatch.release")}
                    disabled={busy}
                    onPress={() => void (s === "hold" ? hold() : release())}
                  />
                ))}
              </View>
            ) : null}
            {step.primary ? (
              <Button
                size="lg"
                label={step.primary === "scan" ? t("dispatch.build.scanBundles") : step.primary === "hold" ? t("dispatch.holdStock") : t("dispatch.dispatchAction")}
                loading={busy && step.primary !== "scan" && sheet === null}
                disabled={busy || (step.primary === "dispatch" && offBandStops(detail.data.offBand))}
                onPress={() => {
                  if (step.primary === "scan") scan();
                  else if (step.primary === "hold") void hold();
                  else openSheet("dispatch");
                }}
              />
            ) : null}
          </ActionBar>
        ) : null}
      </View>

      <PasteSheet visible={sheet === "paste"} onClose={closeSheet} send={send} resolve={resolve} onAdded={refresh} />
      <ConfirmSheet
        visible={sheet === "dispatch"}
        title={t("dispatch.confirmTitle", { code: d.code })}
        body={t("dispatch.confirmBody", { bundles: totals.bundles, kg, customer: customerName })}
        confirmLabel={t("dispatch.confirm")}
        loading={busy}
        error={sheetError}
        onConfirm={() => void dispatchIt()}
        onClose={closeSheet}
      >
        {d.vehicleNo?.trim() ? null : (
          <Field
            label={t("dispatch.header.vehicleNo")}
            hint={t("dispatch.vehicleNeeded")}
            error={vehicleError === "missing" ? t("dispatch.vehicleMissing") : vehicleError === "invalid" ? t("dispatch.header.vehicleHint") : null}
            value={vehicle}
            onChangeText={(v) => {
              setVehicle(v);
              setVehicleError(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={30}
            mono
            testID="dispatch-vehicle"
          />
        )}
        <CapacityBanner capacity={detail.data.capacity} />
        {capacity?.needsReason ? (
          <Field
            label={t("dispatch.capacity.overReason")}
            hint={t("dispatch.capacity.overReasonHint")}
            error={overTried && overReasonError(capacity, overReason) ? t("dispatch.capacity.reasonRequired") : null}
            value={overReason}
            onChangeText={setOverReason}
            multiline
            maxLength={500}
          />
        ) : null}
        <View className="min-h-12 flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-[15px] font-medium text-foreground">{t("dispatch.late.toggle")}</Text>
          <Switch
            accessibilityLabel={t("dispatch.late.toggle")}
            value={late}
            onValueChange={(on) => {
              setLate(on);
              setLateError(null);
            }}
            testID="late-entry-toggle"
          />
        </View>
        {late ? (
          <>
            {lateLocked && lateAsk ? (
              <View
                className={`gap-2 rounded-card p-4 ${lateAsk.status === "approved" ? "bg-tone-green-tint" : "bg-tone-amber-tint"}`}
                testID="late-locked"
              >
                <Text className={`text-[15px] font-semibold ${lateAsk.status === "approved" ? "text-tone-green-ink" : "text-tone-amber-ink"}`}>
                  {t(lateAsk.status === "approved" ? "dispatch.late.approvedFor" : "dispatch.late.waitingFor", {
                    when: `${format.day(lateAsk.occurredAt)} ${format.time(lateAsk.occurredAt)}`,
                  })}
                </Text>
                <Button
                  label={t("dispatch.late.useAnother")}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => {
                    setLateLocked(false);
                    setLateTime("");
                    setLateReason("");
                    setLateError(null);
                  }}
                  testID="late-use-another"
                />
              </View>
            ) : lateAsk ? (
              <Text className="text-[14px] text-muted-foreground">{t("dispatch.late.anotherAsks")}</Text>
            ) : null}
            <Field
              label={t("dispatch.late.date")}
              editable={!lateLocked}
              value={lateDate}
              onChangeText={(v) => {
                setLateDate(v);
                setLateError(null);
              }}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              mono
              testID="late-date"
            />
            <Field
              label={t("dispatch.late.clock")}
              hint={t("dispatch.late.clockHint")}
              error={lateError?.field === "time" ? t(lateError.key) : null}
              editable={!lateLocked}
              value={lateTime}
              onChangeText={(v) => {
                setLateTime(v);
                setLateError(null);
              }}
              placeholder="14:30"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              mono
              testID="late-time"
            />
            <Field
              label={t("dispatch.late.reason")}
              hint={t("dispatch.late.reasonHint")}
              error={lateError?.field === "reason" ? t(lateError.key) : null}
              editable={!lateLocked}
              value={lateReason}
              onChangeText={(v) => {
                setLateReason(v);
                setLateError(null);
              }}
              multiline
              maxLength={500}
              testID="late-reason"
            />
          </>
        ) : null}
      </ConfirmSheet>
      <ConfirmSheet
        visible={sheet === "cancel"}
        title={t("dispatch.cancelTitle")}
        body={t("dispatch.cancelBody")}
        confirmLabel={t("dispatch.cancel")}
        keepLabel={t("native.dispatch.keepIt")}
        danger
        loading={busy}
        error={sheetError}
        onConfirm={() => void cancelIt()}
        onClose={closeSheet}
      />
      <ConfirmSheet
        visible={sheet === "delete"}
        title={t("dispatch.deleteTitle")}
        body={t("dispatch.deleteBody")}
        confirmLabel={t("dispatch.delete")}
        keepLabel={t("native.dispatch.keepIt")}
        danger
        loading={busy}
        error={sheetError}
        onConfirm={() => void deleteIt()}
        onClose={closeSheet}
      />
      <ConfirmSheet
        visible={sheet === "regenerate"}
        title={t("packingList.regenerateTitle")}
        body={t("packingList.regenerateBody")}
        confirmLabel={t("packingList.regenerate")}
        loading={busy}
        error={sheetError}
        onConfirm={() => void regenerateIt()}
        onClose={closeSheet}
      />
      <ConfirmSheet
        visible={removing !== null}
        title={t("native.dispatch.removeTitle", { serial: removing?.serial ?? "" })}
        body={t("native.dispatch.removeBody")}
        confirmLabel={t("common.remove")}
        keepLabel={t("native.dispatch.keepIt")}
        danger
        loading={busy}
        error={sheetError}
        onConfirm={() => removing && void removeIt(removing)}
        onClose={closeSheet}
      />
      <LabelSheet
        visible={labelling !== null}
        initial={labelling?.labelled ? labelling.label : ""}
        loading={busy}
        error={sheetError}
        onSave={(label) => labelling && void labelIt(labelling, label)}
        onClose={closeSheet}
      />
    </>
  );
}

