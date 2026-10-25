import Feather from "@expo/vector-icons/Feather";
import { useT, type Translate } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { NumberInput } from "@/components/ui/number-input";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { announce } from "@/lib/a11y";
import { useThemeColor } from "@/lib/theme";
import { reasonOptions } from "@/features/press/reason-label";
import { trpc } from "@/utils/trpc";

import {
  gasFromText,
  gasText,
  hardnessReadings,
  previewMedianX10,
  rowsToTest,
  startDefaults,
  x10FromText,
  x10Text,
} from "./model";
import { ErrorLine, Note } from "./ui";
import { useAgeingRefresh, useGuardedWrite, useKeyedWrite, type Batch, type BatchRow, type Recipe } from "./use-ageing";
import { useDuration } from "./use-duration";

/** What a sheet tells the batch screen after a write landed: a line to show above the batch. */
export type Notice = { tone: "green" | "amber"; text: string };

type SheetProps = { visible: boolean; onClose: () => void; batch: Batch; onDone: (notice: Notice) => void };

/** The recipe a cycle will use, in one line: set point, soak and the hardness it must reach. */
export function recipeLine(t: Translate, d: (min: number) => string, r: Pick<Recipe, "targetTempX10" | "toleranceX10" | "soakMin" | "hardnessMinX10" | "hardnessMethod" | "sampleCount">): string {
  return t("ageing.recipe.line", {
    temp: x10Text(r.targetTempX10),
    tol: x10Text(r.toleranceX10),
    soak: d(r.soakMin),
    hardness: x10Text(r.hardnessMinX10),
    method: t(`ageing.method.${r.hardnessMethod}`),
    samples: r.sampleCount,
  });
}

/** A checkbox row (the gas meter was replaced). */
function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  const ink = useThemeColor("foreground");
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      className="min-h-14 flex-row items-center gap-3 rounded-card border border-hairline bg-surface px-4 py-3"
    >
      <View className={cn("h-6 w-6 items-center justify-center rounded-input border", checked ? "border-primary bg-primary" : "border-control")}>
        {checked ? <Feather name="check" size={16} color={ink} importantForAccessibility="no" /> : null}
      </View>
      <Text className="min-w-0 flex-1 font-sans text-base text-ink">{label}</Text>
    </PressableScale>
  );
}

/** One radio row of a list (oven, recipe, shift, line, reason). */
function ChoiceRow({ title, subtitle, selected, onPress }: { title: string; subtitle?: string; selected: boolean; onPress: () => void }) {
  const ink = useThemeColor("foreground");
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      className={cn(selected && "border-primary")}
      radioChecked={selected}
      trailing={selected ? <Feather name="check-circle" size={22} color={ink} importantForAccessibility="no" /> : undefined}
      onPress={onPress}
    />
  );
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/** Start the cycle (ageing.load): the free oven, the recipe (its set point and soak shown), the shift and the gas meter. */
export function StartSheet({ visible, onClose, batch, onDone }: SheetProps) {
  const { t } = useT();
  const duration = useDuration();
  const refresh = useAgeingRefresh();
  const ovens = useQuery({ ...trpc.ageing.ovens.list.queryOptions({}), enabled: visible });
  const recipes = useQuery({ ...trpc.ageing.recipes.list.queryOptions({}), enabled: visible });
  const settings = useQuery({ ...trpc.company.getSettings.queryOptions(), enabled: visible });
  const [ovenId, setOvenId] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [gas, setGas] = useState("");
  const [reset, setReset] = useState(false);
  const [tried, setTried] = useState(false);
  const start = useMutation(trpc.ageing.batches.start.mutationOptions());
  const write = useKeyedWrite(refresh);

  const freeOvens = (ovens.data?.items ?? []).filter((o) => o.status === "active" && !o.busyBatchId);
  const activeRecipes = (recipes.data?.items ?? []).filter((r) => r.status === "active");
  const shifts = settings.data?.shifts ?? [];

  useEffect(() => {
    if (!visible) return;
    setGas("");
    setReset(false);
    setTried(false);
    write.reset();
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const pick = startDefaults({
      ovens: ovens.data?.items ?? [],
      recipes: recipes.data?.items ?? [],
      shifts,
      settings: settings.data ? { defaultAlloy: settings.data.defaultAlloy, defaultTemper: settings.data.defaultTemper, currentShiftId: settings.data.productionDay.shift?.id ?? null } : undefined,
      current: { ovenId, recipeId, shiftId },
      topUp: batch.reworkOfBatchId !== null,
    });
    if (pick.ovenId !== ovenId) setOvenId(pick.ovenId);
    if (pick.recipeId !== recipeId) setRecipeId(pick.recipeId);
    if (pick.shiftId !== shiftId) setShiftId(pick.shiftId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, ovens.data, recipes.data, settings.data]);

  const gasMilli = gasFromText(gas);
  const blocked = !ovenId || !recipeId || !shiftId;

  const submit = async () => {
    setTried(true);
    if (gasMilli === null || blocked) return;
    const body = { batchId: batch.id, ovenId, recipeId, shiftId, gasStartMilli: gasMilli, meterReset: reset };
    const res = await write.run(body, (clientMutationId) => start.mutateAsync({ ...body, clientMutationId }));
    if (!res) return;
    announce(t("ageing.start.started", { number: batch.number }));
    onDone(res.warning === "gas_backwards" ? { tone: "amber", text: `${t("ageing.start.started", { number: batch.number })} ${t("ageing.gasBackwards")}` } : { tone: "green", text: t("ageing.start.started", { number: batch.number }) });
    await refresh();
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t("ageing.start.title", { number: batch.number })}>
      <Text className="font-sans text-sm text-ink-muted">{t("ageing.start.subtitle", { trolley: batch.trolleyCode })}</Text>
      {ovens.data && freeOvens.length === 0 ? <Note tone="amber">{(ovens.data.items ?? []).some((o) => o.status === "active") ? t("ageing.start.noFreeOven") : t("ageing.empty.noOvenAsk")}</Note> : null}
      <ErrorLine error={ovens.error ?? recipes.error ?? settings.error} />
      <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
        {t("ageing.field.oven")}
      </Text>
      <View accessibilityRole="radiogroup" className="gap-2">
        {freeOvens.map((o) => (
          <ChoiceRow key={o.id} title={o.code} subtitle={o.name ?? undefined} selected={o.id === ovenId} onPress={() => setOvenId(o.id)} />
        ))}
      </View>
      <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
        {t("ageing.field.recipe")}
      </Text>
      {recipes.data && activeRecipes.length === 0 ? <Note tone="amber">{t("ageing.empty.noRecipe")}</Note> : null}
      <View accessibilityRole="radiogroup" className="gap-2">
        {activeRecipes.map((r) => (
          <ChoiceRow key={r.id} title={`${r.alloy} ${r.temper}, ${t(`ageing.recipeKind.${r.kind}`)}`} subtitle={recipeLine(t, duration, r)} selected={r.id === recipeId} onPress={() => setRecipeId(r.id)} />
        ))}
      </View>
      {shifts.length > 0 ? (
        <>
          <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
            {t("ageing.field.shift")}
          </Text>
          <View accessibilityRole="radiogroup" className="gap-2">
            {shifts.map((s) => (
              <ChoiceRow key={s.id} title={s.name} selected={s.id === shiftId} onPress={() => setShiftId(s.id)} />
            ))}
          </View>
        </>
      ) : settings.data ? (
        <Note tone="amber">{t("ageing.empty.noShiftAsk")}</Note>
      ) : null}
      <NumberInput
        label={t("ageing.field.gasStart")}
        hint={t("ageing.start.gasHint")}
        unit="m³"
        value={gas}
        onChangeText={setGas}
        error={tried && gasMilli === null ? t("ageing.start.gasRequired") : null}
      />
      <CheckRow label={t("ageing.start.meterReset")} checked={reset} onChange={setReset} />
      <ErrorLine error={write.error} />
      <Button size="lg" label={t("ageing.action.start")} loading={write.pending} disabled={blocked} onPress={() => void submit()} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Take out
// ---------------------------------------------------------------------------

/** Take the trolley out (ageing.load): the gas meter at the end. The server judges the soak when it lands. */
export function TakeOutSheet({ visible, onClose, batch, onDone }: SheetProps) {
  const { t } = useT();
  const refresh = useAgeingRefresh();
  const [gas, setGas] = useState("");
  const [tried, setTried] = useState(false);
  const out = useMutation(trpc.ageing.batches.out.mutationOptions());
  const write = useKeyedWrite(refresh);
  useEffect(() => {
    if (visible) {
      setGas("");
      setTried(false);
      write.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const gasMilli = gasFromText(gas);
  const submit = async () => {
    setTried(true);
    if (gasMilli === null) return;
    const body = { batchId: batch.id, gasEndMilli: gasMilli };
    const res = await write.run(body, (clientMutationId) => out.mutateAsync({ ...body, clientMutationId }));
    if (!res) return;
    announce(t("ageing.out.done", { number: batch.number }));
    onDone({ tone: "green", text: t("ageing.out.done", { number: batch.number }) });
    await refresh();
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={t("ageing.out.title", { number: batch.number })}>
      <Text className="font-sans text-sm text-ink-muted">{t("ageing.out.subtitle")}</Text>
      {batch.gasStartMilli !== null ? <Text className="font-sans text-sm text-ink-muted">{t("ageing.out.gasStartWas", { gas: gasText(batch.gasStartMilli) })}</Text> : null}
      <NumberInput label={t("ageing.field.gasEnd")} unit="m³" value={gas} onChangeText={setGas} error={tried && gasMilli === null ? t("ageing.start.gasRequired") : null} />
      <ErrorLine error={write.error} />
      <Button size="lg" label={t("ageing.action.takeOut")} loading={write.pending} onPress={() => void submit()} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Temperature reading
// ---------------------------------------------------------------------------

/**
 * A typed temperature reading (ageing.record). Readings that came from the oven's collector are listed on the batch
 * as read-only; this sheet adds a typed one at the time of saving.
 */
export function TempSheet({ visible, onClose, batch, onDone }: SheetProps) {
  const { t } = useT();
  const refresh = useAgeingRefresh();
  const [temp, setTemp] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const save = useMutation(trpc.ageing.batches.temp.mutationOptions());
  const write = useKeyedWrite(refresh);
  useEffect(() => {
    if (visible) {
      setTemp("");
      setNote("");
      setTried(false);
      write.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const x10 = x10FromText(temp);
  const snap = batch.snapshot;
  const submit = async () => {
    setTried(true);
    if (x10 === null) return;
    const body = { batchId: batch.id, tempCX10: x10, ...(note.trim() ? { note: note.trim() } : {}) };
    const res = await write.run(body, (clientMutationId) => save.mutateAsync({ ...body, clientMutationId }));
    if (!res) return;
    announce(t("ageing.readings.saved"));
    onDone({ tone: "green", text: t("ageing.readings.saved") });
    await refresh();
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={t("ageing.readings.addTitle", { number: batch.number })}>
      {snap ? <Text className="font-sans text-sm text-ink-muted">{t("ageing.readings.target", { temp: x10Text(snap.targetTempX10), tol: x10Text(snap.toleranceX10) })}</Text> : null}
      <NumberInput label={t("ageing.readings.temperature")} unit="°C" value={temp} onChangeText={setTemp} error={tried && x10 === null ? t("ageing.readings.tempInvalid") : null} />
      <Field label={`${t("ageing.readings.note")} (${t("common.optional")})`} value={note} onChangeText={setNote} maxLength={500} />
      <ErrorLine error={write.error} />
      <Button size="lg" label={t("ageing.readings.addReading")} loading={write.pending} onPress={() => void submit()} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Hardness
// ---------------------------------------------------------------------------

/**
 * Hardness samples for a line (ageing.record): the method, the samples and a median preview. The server's median
 * and verdict stand once saved; the sheet then moves to the next line still to test. A sample of the other method is
 * kept and not counted (`pass` null).
 */
export function HardnessSheet({ visible, onClose, batch, onDone, rowId }: SheetProps & { rowId?: string }) {
  const { t } = useT();
  const refresh = useAgeingRefresh();
  const snap = batch.snapshot;
  const samples = snap?.sampleCount ?? 3;
  const candidates = batch.rows.filter((r) => r.status === "pending" || r.status === "held");
  const [row, setRow] = useState("");
  const [method, setMethod] = useState<"webster" | "hb">(snap?.hardnessMethod ?? "webster");
  const [texts, setTexts] = useState<string[]>(() => Array.from({ length: samples }, () => ""));
  const [tried, setTried] = useState(false);
  const [last, setLast] = useState<{ section: string; median: number | null; pass: boolean | null } | null>(null);
  const save = useMutation(trpc.ageing.batches.hardness.mutationOptions());
  const write = useKeyedWrite(refresh);

  useEffect(() => {
    if (!visible) return;
    setRow(rowId ?? rowsToTest(batch)[0]?.id ?? candidates[0]?.id ?? "");
    setMethod(snap?.hardnessMethod ?? "webster");
    setTexts(Array.from({ length: samples }, () => ""));
    setTried(false);
    setLast(null);
    write.reset();
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const readings = hardnessReadings(texts);
  const median = readings ? previewMedianX10(readings) : null;
  const target = batch.rows.find((r) => r.id === row);

  const submit = async () => {
    setTried(true);
    if (!readings || !row) return;
    const body = { rowId: row, method, readingsX10: readings };
    const res = await write.run(body, (clientMutationId) => save.mutateAsync({ ...body, clientMutationId }));
    if (!res) return;
    const saved = res.rows.find((r) => r.id === row);
    const left = rowsToTest(res).filter((r) => r.id !== row);
    if (saved) setLast({ section: saved.sectionLabel, median: saved.hardnessReadingX10, pass: saved.hardnessPass });
    await refresh();
    if (left.length > 0) {
      setRow(left[0]!.id);
      setTexts(Array.from({ length: samples }, () => ""));
      setTried(false);
    } else {
      announce(t("ageing.hardness.done"));
      onDone({ tone: "green", text: t("ageing.hardness.done") });
      onClose();
    }
  };

  const methodOptions = [
    { value: "webster" as const, label: t("ageing.method.webster") },
    { value: "hb" as const, label: t("ageing.method.hb") },
  ];
  return (
    <Sheet visible={visible} onClose={onClose} title={t("ageing.hardness.title", { number: batch.number })}>
      {snap ? <Text className="font-sans text-sm text-ink-muted">{t("ageing.hardness.rule", { min: x10Text(snap.hardnessMinX10), method: t(`ageing.method.${snap.hardnessMethod}`), samples })}</Text> : null}
      {last ? (
        <Note tone={last.pass === false ? "red" : "green"}>
          {t("ageing.hardness.saved", { section: last.section, median: x10Text(last.median), result: last.pass === null ? "-" : last.pass ? t("ageing.readings.pass") : t("ageing.readings.fail") })}
        </Note>
      ) : null}
      <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
        {t("ageing.hardness.line")}
      </Text>
      <View accessibilityRole="radiogroup" className="gap-2">
        {candidates.map((r) => (
          <ChoiceRow
            key={r.id}
            title={`${r.sectionLabel}, ${r.lengthMm} mm`}
            subtitle={`${r.pcs} ${t("units.pcs")}${r.hardnessReadingX10 !== null ? `, ${x10Text(r.hardnessReadingX10)}` : ""}`}
            selected={r.id === row}
            onPress={() => setRow(r.id)}
          />
        ))}
      </View>
      <SegmentedControl label={t("ageing.field.method")} options={methodOptions} value={method} onChange={setMethod} />
      {snap && method !== snap.hardnessMethod ? <Note tone="amber">{t("ageing.hardness.otherMethod", { method: t(`ageing.method.${snap.hardnessMethod}`) })}</Note> : null}
      <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
        {t("ageing.hardness.samples")}
      </Text>
      <View className="gap-3">
        {texts.map((text, i) => (
          <NumberInput key={i} label={t("ageing.hardness.sample", { n: i + 1 })} value={text} onChangeText={(v) => setTexts((prev) => prev.map((x, j) => (j === i ? v : x)))} />
        ))}
      </View>
      {tried && !readings ? <Text accessibilityLiveRegion="polite" className="font-sans-medium text-sm text-destructive">{t("ageing.hardness.invalid")}</Text> : null}
      {readings && median !== null ? <Text className="font-sans text-sm text-ink-muted">{t("ageing.hardness.median", { value: x10Text(median) })}</Text> : null}
      {target ? <Text className="font-sans text-sm text-ink-muted">{t("ageing.hardness.forLine", { pcs: target.pcs })}</Text> : null}
      <ErrorLine error={write.error} />
      <Button size="lg" label={t("ageing.hardness.save")} loading={write.pending} disabled={!row} onPress={() => void submit()} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Hold, clear a hold, ask for approval (the server does not key these: its status guards refuse a repeat)
// ---------------------------------------------------------------------------

/** Hold a line, or the whole trolley (ageing.release), with a reason from the plant's own list. */
export function HoldSheet({ visible, onClose, batch, row, onDone }: SheetProps & { row: BatchRow | null }) {
  const { t, locale } = useT();
  const refresh = useAgeingRefresh();
  const reasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "ageing_hold" }), enabled: visible, staleTime: 5 * 60_000 });
  const options = useMemo(() => reasonOptions(t, "ageing_hold", reasons.data, locale), [t, reasons.data, locale]);
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const hold = useMutation(trpc.ageing.batches.hold.mutationOptions());
  const write = useGuardedWrite(refresh);
  useEffect(() => {
    if (visible) {
      setReasonCode("");
      setNote("");
      setTried(false);
      write.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const chosen = (reasons.data ?? []).find((r) => r.code === reasonCode);
  const needsNote = Boolean(chosen && (chosen.requiresNote || chosen.code === "other"));
  const submit = async () => {
    setTried(true);
    if (!chosen || (needsNote && !note.trim())) return;
    const res = await write.run(() => hold.mutateAsync({ ...(row ? { rowId: row.id } : { batchId: batch.id }), reasonCodeId: chosen.id, ...(note.trim() ? { note: note.trim() } : {}) }));
    if (!res) return;
    announce(t("ageing.hold.done"));
    onDone({ tone: "amber", text: t("ageing.hold.done") });
    await refresh();
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={row ? t("ageing.hold.titleLine", { section: row.sectionLabel }) : t("ageing.hold.titleBatch", { number: batch.number })}>
      <Text className="font-sans text-sm text-ink-muted">{t("ageing.hold.subtitle")}</Text>
      <ErrorLine error={reasons.error} />
      <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
        {t("ageing.hold.reason")}
      </Text>
      <View accessibilityRole="radiogroup" className="gap-2">
        {options.map((o) => (
          <ChoiceRow key={o.value} title={o.label} selected={o.value === reasonCode} onPress={() => setReasonCode(o.value)} />
        ))}
      </View>
      {tried && !chosen ? <Text accessibilityLiveRegion="polite" className="font-sans-medium text-sm text-destructive">{t("ageing.hold.reasonRequired")}</Text> : null}
      <Field
        label={needsNote ? t("ageing.hold.note") : `${t("ageing.hold.note")} (${t("common.optional")})`}
        value={note}
        onChangeText={setNote}
        maxLength={500}
        error={tried && needsNote && !note.trim() ? t("ageing.hold.noteRequired") : null}
      />
      <ErrorLine error={write.error} />
      <Button size="lg" variant="danger" label={t("ageing.action.hold")} loading={write.pending} onPress={() => void submit()} />
    </Sheet>
  );
}

/** Clear a hand hold on a line (ageing.release). A failed test clears with a retest or an approval, not here. */
export function UnholdSheet({ row, onClose, onDone }: { row: BatchRow | null; onClose: () => void; onDone: (notice: Notice) => void }) {
  const { t } = useT();
  const refresh = useAgeingRefresh();
  const unhold = useMutation(trpc.ageing.batches.unhold.mutationOptions());
  const write = useGuardedWrite(refresh);
  useEffect(() => {
    if (row) write.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id]);
  const submit = async () => {
    if (!row) return;
    const res = await write.run(() => unhold.mutateAsync({ rowId: row.id }));
    if (!res) return;
    announce(t("ageing.unhold.done"));
    onDone({ tone: "green", text: t("ageing.unhold.done") });
    await refresh();
    onClose();
  };
  return (
    <Sheet visible={row !== null} onClose={onClose} title={t("ageing.unhold.title", { section: row?.sectionLabel ?? "" })}>
      <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("ageing.unhold.body")}</Text>
      <ErrorLine error={write.error} />
      <Button size="lg" label={t("ageing.action.unhold")} loading={write.pending} onPress={() => void submit()} />
    </Sheet>
  );
}

/** Ask a manager to approve releasing a failed or short batch (ageing.release). Approving never releases by itself. */
export function OverrideSheet({ visible, onClose, batch, onDone }: SheetProps) {
  const { t } = useT();
  const refresh = useAgeingRefresh();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const ask = useMutation(trpc.ageing.batches.requestOverride.mutationOptions());
  const write = useGuardedWrite(refresh);
  useEffect(() => {
    if (visible) {
      setReason("");
      setTried(false);
      write.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const submit = async () => {
    setTried(true);
    if (!reason.trim()) return;
    const res = await write.run(() => ask.mutateAsync({ batchId: batch.id, reason: reason.trim() }));
    if (!res) return;
    announce(t("ageing.override.sent"));
    onDone({ tone: "amber", text: t("ageing.override.sent") });
    await refresh();
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={t("ageing.override.title", { number: batch.number })}>
      <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("ageing.override.body")}</Text>
      <Field label={t("ageing.override.reason")} value={reason} onChangeText={setReason} multiline maxLength={500} error={tried && !reason.trim() ? t("ageing.override.reasonRequired") : null} />
      <ErrorLine error={write.error} />
      <Button size="lg" label={t("ageing.action.requestOverride")} loading={write.pending} onPress={() => void submit()} />
    </Sheet>
  );
}
