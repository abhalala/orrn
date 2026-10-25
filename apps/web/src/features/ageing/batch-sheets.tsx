import { useT } from "@orrn/i18n";
import { Dialog } from "@orrn/ui/components/dialog";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { reasonOptions } from "@/features/press/reason-label";
import { kgFromG } from "@/features/press/model";
import { trpc } from "@/shared/utils/trpc";

import { useActionKey, useAgeingInvalidate, useDuration, useShifts, type Batch, type BatchRow, type Recipe } from "./hooks";
import {
  gasFromText,
  hardnessReadings,
  localInputValue,
  msFromLocalInput,
  previewMedianX10,
  rowsToTest,
  wholeFromText,
  x10FromText,
  x10Text,
} from "./model";
import { FormSheet, RefusalNote, FieldSelect as NativeSelect } from "./ui";

type SheetProps = { open: boolean; onOpenChange(open: boolean): void; batch: Batch };

/** The recipe a cycle will use, in one line: set point, soak and the hardness it must reach. */
export function recipeLine(t: ReturnType<typeof useT>["t"], d: (min: number) => string, r: Pick<Recipe, "targetTempX10" | "toleranceX10" | "soakMin" | "hardnessMinX10" | "hardnessMethod" | "sampleCount">): string {
  return t("ageing.recipe.line", {
    temp: x10Text(r.targetTempX10),
    tol: x10Text(r.toleranceX10),
    soak: d(r.soakMin),
    hardness: x10Text(r.hardnessMinX10),
    method: t(`ageing.method.${r.hardnessMethod}`),
    samples: r.sampleCount,
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export function StartSheet({ open, onOpenChange, batch }: SheetProps) {
  const { t } = useT();
  const duration = useDuration();
  const invalidate = useAgeingInvalidate();
  const key = useActionKey();
  const { settings, shifts } = useShifts();
  const ovens = useQuery({ ...trpc.ageing.ovens.list.queryOptions({}), enabled: open });
  const recipes = useQuery({ ...trpc.ageing.recipes.list.queryOptions({}), enabled: open });
  const activeOvens = (ovens.data?.items ?? []).filter((o) => o.status === "active");
  const freeOvens = activeOvens.filter((o) => !o.busyBatchId);
  const activeRecipes = (recipes.data?.items ?? []).filter((r) => r.status === "active");
  const [ovenId, setOvenId] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [gas, setGas] = useState("");
  const [reset, setReset] = useState(false);
  const [inAt, setInAt] = useState("");
  const [tried, setTried] = useState(false);

  const defaults = settings.data;
  const wantTopUp = batch.reworkOfBatchId !== null;
  useEffect(() => {
    if (!open) return;
    setTried(false);
    setGas("");
    setReset(false);
    setInAt("");
    key.reset();
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (!ovenId || !freeOvens.some((o) => o.id === ovenId)) setOvenId(freeOvens[0]?.id ?? "");
    if (!shiftId || !shifts.some((s) => s.id === shiftId)) setShiftId(defaults?.productionDay?.shift?.id ?? shifts[0]?.id ?? "");
    // The plant's default alloy and temper pick the recipe, so wait until the settings are in.
    if (defaults && (!recipeId || !activeRecipes.some((r) => r.id === recipeId))) {
      const kind = wantTopUp ? "top_up" : "full";
      const pick = activeRecipes.find((r) => r.kind === kind && r.alloy === defaults?.defaultAlloy && r.temper === defaults?.defaultTemper) ?? activeRecipes.find((r) => r.kind === kind) ?? activeRecipes[0];
      setRecipeId(pick?.id ?? "");
    }
  }, [open, ovens.data, recipes.data, settings.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const recipe = activeRecipes.find((r) => r.id === recipeId) ?? null;
  const gasMilli = gasFromText(gas);
  const inMs = inAt ? msFromLocalInput(inAt) : null;
  const gasError = tried && gasMilli === null ? t("ageing.start.gasRequired") : undefined;
  const inError = tried && inAt && inMs === null ? t("ageing.start.timeInvalid") : undefined;
  const blocked = !ovenId || !recipeId || !shiftId;

  const start = useMutation(
    trpc.ageing.batches.start.mutationOptions({
      onSuccess: async (res) => {
        key.reset();
        if (res.warning === "gas_backwards") toast.warning(t("ageing.gasBackwards"));
        toast.success(t("ageing.start.started", { number: batch.number }));
        await invalidate();
        onOpenChange(false);
      },
    }),
  );

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("ageing.start.title", { number: batch.number })}
      description={t("ageing.start.subtitle", { trolley: batch.trolleyCode })}
      busy={start.isPending}
      error={start.error}
      submitLabel={t("ageing.action.start")}
      submitDisabled={blocked}
      testId="start-form"
      onSubmit={() => {
        setTried(true);
        if (gasMilli === null || blocked || (inAt && inMs === null)) return;
        start.mutate({ batchId: batch.id, ovenId, recipeId, shiftId, gasStartMilli: gasMilli, meterReset: reset, ...(inMs !== null ? { inAt: inMs } : {}), clientMutationId: key.get() });
      }}
    >
      {ovens.data && freeOvens.length === 0 ? <p className="m-0 text-[14px] font-medium text-tone-amber-ink">{activeOvens.length === 0 ? t("ageing.empty.noOven") : t("ageing.start.noFreeOven")}</p> : null}
      <Field label={t("ageing.field.oven")}>
        <NativeSelect value={ovenId} onChange={(e) => setOvenId(e.currentTarget.value)} data-testid="start-oven">
          {freeOvens.map((o) => (
            <option key={o.id} value={o.id}>
              {o.code}
              {o.name ? ` · ${o.name}` : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("ageing.field.recipe")} hint={recipe ? recipeLine(t, duration, recipe) : activeRecipes.length === 0 ? t("ageing.empty.noRecipe") : undefined}>
        <NativeSelect value={recipeId} onChange={(e) => setRecipeId(e.currentTarget.value)} data-testid="start-recipe">
          {activeRecipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.alloy} {r.temper} · {t(`ageing.recipeKind.${r.kind}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("ageing.field.shift")}>
        <NativeSelect value={shiftId} onChange={(e) => setShiftId(e.currentTarget.value)} data-testid="start-shift">
          {shifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("ageing.field.gasStart")} error={gasError} hint={t("ageing.start.gasHint")}>
        <NumberInput value={gas} onValueChange={setGas} suffix="m³" className="h-14 text-[22px]" data-testid="start-gas" />
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-[15px]">
        <input type="checkbox" checked={reset} onChange={(e) => setReset(e.currentTarget.checked)} className="size-5 accent-[var(--color-foreground)]" />
        <span>{t("ageing.start.meterReset")}</span>
      </label>
      <Field label={t("ageing.start.inAt")} hint={t("ageing.start.inAtHint")} error={inError}>
        <TextInput type="datetime-local" value={inAt} max={localInputValue(Date.now())} onChange={(e) => setInAt(e.currentTarget.value)} data-testid="start-in-at" />
      </Field>
    </FormSheet>
  );
}

// ---------------------------------------------------------------------------
// Take out
// ---------------------------------------------------------------------------

export function TakeOutSheet({ open, onOpenChange, batch }: SheetProps) {
  const { t } = useT();
  const invalidate = useAgeingInvalidate();
  const key = useActionKey();
  const [gas, setGas] = useState("");
  const [outAt, setOutAt] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setGas("");
      setOutAt("");
      setTried(false);
      key.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const gasMilli = gasFromText(gas);
  const outMs = outAt ? msFromLocalInput(outAt) : null;
  const out = useMutation(
    trpc.ageing.batches.out.mutationOptions({
      onSuccess: async () => {
        key.reset();
        toast.success(t("ageing.out.done", { number: batch.number }));
        await invalidate();
        onOpenChange(false);
      },
    }),
  );
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("ageing.out.title", { number: batch.number })}
      description={t("ageing.out.subtitle")}
      busy={out.isPending}
      error={out.error}
      submitLabel={t("ageing.action.takeOut")}
      testId="out-form"
      onSubmit={() => {
        setTried(true);
        if (gasMilli === null || (outAt && outMs === null)) return;
        out.mutate({ batchId: batch.id, gasEndMilli: gasMilli, ...(outMs !== null ? { outAt: outMs } : {}), clientMutationId: key.get() });
      }}
    >
      {batch.gasStartMilli !== null ? <p className="m-0 text-[14px] text-muted-foreground">{t("ageing.out.gasStartWas", { gas: (batch.gasStartMilli / 1000).toFixed(3) })}</p> : null}
      <Field label={t("ageing.field.gasEnd")} error={tried && gasMilli === null ? t("ageing.start.gasRequired") : undefined}>
        <NumberInput value={gas} onValueChange={setGas} suffix="m³" className="h-14 text-[22px]" data-testid="out-gas" />
      </Field>
      <Field label={t("ageing.out.outAt")} hint={t("ageing.out.outAtHint")} error={tried && outAt && outMs === null ? t("ageing.start.timeInvalid") : undefined}>
        <TextInput type="datetime-local" value={outAt} max={localInputValue(Date.now())} onChange={(e) => setOutAt(e.currentTarget.value)} />
      </Field>
    </FormSheet>
  );
}

// ---------------------------------------------------------------------------
// Temperature reading
// ---------------------------------------------------------------------------

export function TempSheet({ open, onOpenChange, batch }: SheetProps) {
  const { t } = useT();
  const invalidate = useAgeingInvalidate();
  const key = useActionKey();
  const [temp, setTemp] = useState("");
  const [at, setAt] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setTemp("");
      setAt("");
      setNote("");
      setTried(false);
      key.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const x10 = x10FromText(temp);
  const atMs = at ? msFromLocalInput(at) : null;
  const save = useMutation(
    trpc.ageing.batches.temp.mutationOptions({
      onSuccess: async () => {
        key.reset();
        toast.success(t("ageing.readings.saved"));
        await invalidate();
        onOpenChange(false);
      },
    }),
  );
  const snap = batch.snapshot;
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("ageing.readings.addTitle", { number: batch.number })}
      description={snap ? t("ageing.readings.target", { temp: x10Text(snap.targetTempX10), tol: x10Text(snap.toleranceX10) }) : undefined}
      busy={save.isPending}
      error={save.error}
      submitLabel={t("ageing.readings.addReading")}
      testId="temp-form"
      onSubmit={() => {
        setTried(true);
        if (x10 === null || (at && atMs === null)) return;
        save.mutate({ batchId: batch.id, tempCX10: x10, ...(atMs !== null ? { at: atMs } : {}), ...(note.trim() ? { note: note.trim() } : {}), clientMutationId: key.get() });
      }}
    >
      <Field label={t("ageing.readings.temperature")} error={tried && x10 === null ? t("ageing.readings.tempInvalid") : undefined}>
        <NumberInput value={temp} onValueChange={setTemp} suffix="°C" className="h-14 text-[22px]" data-testid="temp-input" />
      </Field>
      <Field label={t("ageing.readings.at")} hint={t("ageing.readings.atHint")} error={tried && at && atMs === null ? t("ageing.start.timeInvalid") : undefined}>
        <TextInput type="datetime-local" value={at} max={localInputValue(Date.now())} onChange={(e) => setAt(e.currentTarget.value)} />
      </Field>
      <Field label={t("ageing.readings.note")} hint={t("common.optional")}>
        <TextInput value={note} maxLength={500} onChange={(e) => setNote(e.currentTarget.value)} />
      </Field>
    </FormSheet>
  );
}

// ---------------------------------------------------------------------------
// Hardness
// ---------------------------------------------------------------------------

export function HardnessSheet({ open, onOpenChange, batch, rowId }: SheetProps & { rowId?: string }) {
  const { t } = useT();
  const invalidate = useAgeingInvalidate();
  const key = useActionKey();
  const snap = batch.snapshot;
  const samples = snap?.sampleCount ?? 3;
  const candidates = batch.rows.filter((r) => r.status === "pending" || r.status === "held");
  const [row, setRow] = useState("");
  const [method, setMethod] = useState<"webster" | "hb">(snap?.hardnessMethod ?? "webster");
  const [texts, setTexts] = useState<string[]>(() => Array.from({ length: samples }, () => ""));
  const [tried, setTried] = useState(false);
  const [last, setLast] = useState<{ row: BatchRow; pass: boolean | null; median: number | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    const first = rowId ?? rowsToTest(batch)[0]?.id ?? candidates[0]?.id ?? "";
    setRow(first);
    setMethod(snap?.hardnessMethod ?? "webster");
    setTexts(Array.from({ length: samples }, () => ""));
    setTried(false);
    setLast(null);
    key.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const readings = hardnessReadings(texts);
  const median = readings ? previewMedianX10(readings) : null;
  const target = batch.rows.find((r) => r.id === row);
  const save = useMutation(
    trpc.ageing.batches.hardness.mutationOptions({
      onSuccess: async (res) => {
        key.reset();
        await invalidate();
        const saved = res.rows.find((r) => r.id === row);
        const left = rowsToTest(res).filter((r) => r.id !== row);
        if (saved) setLast({ row: saved, pass: saved.hardnessPass, median: saved.hardnessReadingX10 });
        if (left.length > 0) {
          setRow(left[0]!.id);
          setTexts(Array.from({ length: samples }, () => ""));
          setTried(false);
        } else {
          toast.success(t("ageing.hardness.done"));
          onOpenChange(false);
        }
      },
    }),
  );

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("ageing.hardness.title", { number: batch.number })}
      description={snap ? t("ageing.hardness.rule", { min: x10Text(snap.hardnessMinX10), method: t(`ageing.method.${snap.hardnessMethod}`), samples }) : undefined}
      busy={save.isPending}
      error={save.error}
      submitLabel={t("ageing.hardness.save")}
      submitDisabled={!row}
      testId="hardness-form"
      onSubmit={() => {
        setTried(true);
        if (!readings || !row) return;
        save.mutate({ rowId: row, method, readingsX10: readings, clientMutationId: key.get() });
      }}
    >
      {last ? (
        <p role="status" data-testid="hardness-last" className="m-0 rounded-card bg-tone-green-tint px-4 py-3 text-[14px] font-medium text-tone-green-ink">
          {t("ageing.hardness.saved", { section: last.row.sectionLabel, median: x10Text(last.median), result: last.pass ? t("ageing.readings.pass") : t("ageing.readings.fail") })}
        </p>
      ) : null}
      <Field label={t("ageing.hardness.line")}>
        <NativeSelect value={row} onChange={(e) => setRow(e.currentTarget.value)} data-testid="hardness-row">
          {candidates.map((r) => (
            <option key={r.id} value={r.id}>
              {r.sectionLabel} · {r.lengthMm} mm · {r.pcs} {t("units.pcs")}
              {r.hardnessReadingX10 !== null ? ` · ${x10Text(r.hardnessReadingX10)}` : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("ageing.field.method")}>
        <NativeSelect value={method} onChange={(e) => setMethod(e.currentTarget.value as "webster" | "hb")} data-testid="hardness-method">
          <option value="webster">{t("ageing.method.webster")}</option>
          <option value="hb">{t("ageing.method.hb")}</option>
        </NativeSelect>
      </Field>
      {method !== (snap?.hardnessMethod ?? method) ? <p className="m-0 text-[14px] text-tone-amber-ink">{t("ageing.hardness.otherMethod", { method: t(`ageing.method.${snap!.hardnessMethod}`) })}</p> : null}
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-[14px] font-semibold">{t("ageing.hardness.samples")}</legend>
        <div className="grid grid-cols-3 gap-3">
          {texts.map((text, i) => (
            <NumberInput
              key={i}
              value={text}
              onValueChange={(v) => setTexts((prev) => prev.map((x, j) => (j === i ? v : x)))}
              aria-label={t("ageing.hardness.sample", { n: i + 1 })}
              className="h-14 text-[20px]"
              data-testid={`hardness-sample-${i + 1}`}
            />
          ))}
        </div>
        {tried && !readings ? <p role="alert" className="m-0 text-[13px] font-medium text-destructive">{t("ageing.hardness.invalid")}</p> : null}
        {readings && median !== null ? <p className="m-0 text-[13px] text-muted-foreground" data-testid="hardness-median">{t("ageing.hardness.median", { value: x10Text(median) })}</p> : null}
      </fieldset>
      {target ? <p className="m-0 text-[13px] text-muted-foreground">{t("ageing.hardness.forLine", { pcs: target.pcs })}</p> : null}
    </FormSheet>
  );
}

// ---------------------------------------------------------------------------
// Hold, discard, split, override
// ---------------------------------------------------------------------------

export function HoldSheet({ open, onOpenChange, batch, row }: SheetProps & { row: BatchRow | null }) {
  const { t, locale } = useT();
  const invalidate = useAgeingInvalidate();
  const reasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "ageing_hold" }), enabled: open, staleTime: 5 * 60_000 });
  const options = useMemo(() => reasonOptions(t, "ageing_hold", reasons.data, locale), [t, reasons.data, locale]);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setReasonId("");
      setNote("");
      setTried(false);
    }
  }, [open]);
  const chosen = (reasons.data ?? []).find((r) => r.id === reasonId);
  const needsNote = Boolean(chosen && (chosen.requiresNote || chosen.code === "other"));
  const hold = useMutation(
    trpc.ageing.batches.hold.mutationOptions({
      onSuccess: async () => {
        toast.success(t("ageing.hold.done"));
        await invalidate();
        onOpenChange(false);
      },
    }),
  );
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("ageing.hold.titleLine", { section: row.sectionLabel }) : t("ageing.hold.titleBatch", { number: batch.number })}
      description={t("ageing.hold.subtitle")}
      busy={hold.isPending}
      error={hold.error}
      submitLabel={t("ageing.action.hold")}
      submitTone="danger"
      testId="hold-form"
      onSubmit={() => {
        setTried(true);
        if (!reasonId || (needsNote && !note.trim())) return;
        hold.mutate({ ...(row ? { rowId: row.id } : { batchId: batch.id }), reasonCodeId: reasonId, ...(note.trim() ? { note: note.trim() } : {}) });
      }}
    >
      <Field label={t("ageing.hold.reason")} error={tried && !reasonId ? t("ageing.hold.reasonRequired") : undefined}>
        <NativeSelect value={reasonId} onChange={(e) => setReasonId(e.currentTarget.value)} data-testid="hold-reason">
          <option value="">{t("ageing.hold.pick")}</option>
          {(reasons.data ?? []).map((r, i) => (
            <option key={r.id} value={r.id}>
              {options[i]?.label ?? r.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("ageing.hold.note")} hint={needsNote ? undefined : t("common.optional")} error={tried && needsNote && !note.trim() ? t("ageing.hold.noteRequired") : undefined}>
        <TextInput value={note} maxLength={500} onChange={(e) => setNote(e.currentTarget.value)} data-testid="hold-note" />
      </Field>
    </FormSheet>
  );
}

export function UnholdDialog({ row, onClose }: { row: BatchRow | null; onClose(): void }) {
  const { t } = useT();
  const invalidate = useAgeingInvalidate();
  const unhold = useMutation(
    trpc.ageing.batches.unhold.mutationOptions({
      onSuccess: async () => {
        toast.success(t("ageing.unhold.done"));
        await invalidate();
        onClose();
      },
    }),
  );
  useEffect(() => {
    if (row) unhold.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id]);
  return (
    <Dialog
      open={row !== null}
      onOpenChange={(o) => !o && !unhold.isPending && onClose()}
      title={t("ageing.unhold.title", { section: row?.sectionLabel ?? "" })}
      description={t("ageing.unhold.body")}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={unhold.isPending}>
            {t("common.cancel")}
          </Button>
          <Button loading={unhold.isPending} onClick={() => row && unhold.mutate({ rowId: row.id })} data-testid="unhold-confirm">
            {t("ageing.action.unhold")}
          </Button>
        </>
      }
    >
      <RefusalNote error={unhold.error} />
    </Dialog>
  );
}

export function DiscardSheet({ open, onOpenChange, batch, row }: SheetProps & { row: BatchRow | null }) {
  const { t, locale } = useT();
  const invalidate = useAgeingInvalidate();
  const reasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "ageing_scrap" }), enabled: open, staleTime: 5 * 60_000 });
  const options = useMemo(() => reasonOptions(t, "ageing_scrap", reasons.data, locale), [t, reasons.data, locale]);
  const [pcs, setPcs] = useState("");
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setPcs(row ? String(row.remainingPcs) : "");
      setReasonId("");
      setNote("");
      setTried(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);
  const n = wholeFromText(pcs);
  const chosen = (reasons.data ?? []).find((r) => r.id === reasonId);
  const needsNote = Boolean(chosen && (chosen.requiresNote || chosen.code === "other"));
  const discard = useMutation(
    trpc.ageing.batches.discardRemaining.mutationOptions({
      onSuccess: async () => {
        toast.success(t("ageing.discard.done"));
        await invalidate();
        onOpenChange(false);
      },
    }),
  );
  const over = row !== null && n !== null && n > row.remainingPcs;
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("ageing.discard.title", { section: row?.sectionLabel ?? "" })}
      description={row ? t("ageing.discard.left", { pcs: row.remainingPcs }) : undefined}
      busy={discard.isPending}
      error={discard.error}
      submitLabel={t("ageing.action.discard")}
      submitTone="danger"
      testId="discard-form"
      onSubmit={() => {
        setTried(true);
        if (!row || !n || n < 1 || over || !reasonId || (needsNote && !note.trim())) return;
        discard.mutate({ rowId: row.id, pcs: n, reasonCodeId: reasonId, ...(note.trim() ? { note: note.trim() } : {}) });
      }}
    >
      <Field label={t("ageing.field.pieces")} error={over ? t("ageing.refusal.discardOver", { n: row?.remainingPcs ?? 0 }) : tried && !n ? t("ageing.load.piecesInvalid") : undefined}>
        <NumberInput decimal={false} value={pcs} onValueChange={setPcs} suffix={t("units.pcs")} className="h-14 text-[22px]" data-testid="discard-pcs" />
      </Field>
      <Field label={t("ageing.hold.reason")} error={tried && !reasonId ? t("ageing.hold.reasonRequired") : undefined}>
        <NativeSelect value={reasonId} onChange={(e) => setReasonId(e.currentTarget.value)} data-testid="discard-reason">
          <option value="">{t("ageing.hold.pick")}</option>
          {(reasons.data ?? []).map((r, i) => (
            <option key={r.id} value={r.id}>
              {options[i]?.label ?? r.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("ageing.hold.note")} hint={needsNote ? undefined : t("common.optional")} error={tried && needsNote && !note.trim() ? t("ageing.hold.noteRequired") : undefined}>
        <TextInput value={note} maxLength={500} onChange={(e) => setNote(e.currentTarget.value)} />
      </Field>
      {row ? <p className="m-0 text-[13px] text-muted-foreground">{t("ageing.discard.kg", { kg: kgFromG(Math.floor((row.kgG * (n ?? 0)) / Math.max(1, row.pcs))) })}</p> : null}
      <p className="m-0 text-[13px] text-muted-foreground">{t("ageing.discard.hint", { number: batch.number })}</p>
    </FormSheet>
  );
}

const SPLIT_TOLERANCE_MM = 25;

export function SplitSheet({ open, onOpenChange, batch, row }: SheetProps & { row: BatchRow | null }) {
  const { t } = useT();
  const invalidate = useAgeingInvalidate();
  const [cuts, setCuts] = useState<{ len: string; pcs: string }[]>([
    { len: "", pcs: "" },
    { len: "", pcs: "" },
  ]);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setCuts([
        { len: "", pcs: "" },
        { len: "", pcs: "" },
      ]);
      setTried(false);
    }
  }, [open, row?.id]);
  const parsed = cuts.map((c) => ({ lengthMm: wholeFromText(c.len), pcs: wholeFromText(c.pcs) }));
  const valid = parsed.every((c) => c.lengthMm && c.pcs);
  const total = parsed.reduce((a, c) => a + (c.lengthMm ?? 0) * (c.pcs ?? 0), 0);
  const want = row ? row.pcs * row.lengthMm : 0;
  const sumOk = Math.abs(total - want) <= SPLIT_TOLERANCE_MM;
  const split = useMutation(
    trpc.ageing.batches.split.mutationOptions({
      onSuccess: async () => {
        toast.success(t("ageing.split.done"));
        await invalidate();
        onOpenChange(false);
      },
    }),
  );
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("ageing.split.title", { section: row?.sectionLabel ?? "" })}
      description={row ? t("ageing.split.body", { pcs: row.pcs, mm: row.lengthMm, total: want }) : undefined}
      busy={split.isPending}
      error={split.error}
      submitLabel={t("ageing.action.split")}
      testId="split-form"
      onSubmit={() => {
        setTried(true);
        if (!row || !valid || !sumOk) return;
        split.mutate({ rowId: row.id, cuts: parsed.map((c) => ({ lengthMm: c.lengthMm!, pcs: c.pcs! })) });
      }}
    >
      {cuts.map((c, i) => (
        <div key={i} className="grid grid-cols-2 gap-3">
          <Field label={t("ageing.split.cutLength", { n: i + 1 })}>
            <NumberInput decimal={false} value={c.len} suffix={t("units.mm")} onValueChange={(v) => setCuts((p) => p.map((x, j) => (j === i ? { ...x, len: v } : x)))} className="h-12" data-testid={`split-len-${i + 1}`} />
          </Field>
          <Field label={t("ageing.field.pieces")}>
            <NumberInput decimal={false} value={c.pcs} suffix={t("units.pcs")} onValueChange={(v) => setCuts((p) => p.map((x, j) => (j === i ? { ...x, pcs: v } : x)))} className="h-12" data-testid={`split-pcs-${i + 1}`} />
          </Field>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={cuts.length >= 10} onClick={() => setCuts((p) => [...p, { len: "", pcs: "" }])}>
          {t("ageing.split.addCut")}
        </Button>
      </div>
      <p className={sumOk || !valid ? "m-0 text-[13px] text-muted-foreground" : "m-0 text-[13px] font-medium text-destructive"} data-testid="split-sum">
        {t("ageing.split.sum", { total, want })}
      </p>
      {tried && !valid ? <p role="alert" className="m-0 text-[13px] font-medium text-destructive">{t("ageing.split.invalid")}</p> : null}
      <p className="m-0 text-[13px] text-muted-foreground">{t("ageing.split.hint", { number: batch.number })}</p>
    </FormSheet>
  );
}

export function OverrideSheet({ open, onOpenChange, batch }: SheetProps) {
  const { t } = useT();
  const invalidate = useAgeingInvalidate();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setReason("");
      setTried(false);
    }
  }, [open]);
  const ask = useMutation(
    trpc.ageing.batches.requestOverride.mutationOptions({
      onSuccess: async () => {
        toast.success(t("ageing.override.sent"));
        await invalidate();
        onOpenChange(false);
      },
    }),
  );
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("ageing.override.title", { number: batch.number })}
      description={t("ageing.override.body")}
      busy={ask.isPending}
      error={ask.error}
      submitLabel={t("ageing.action.requestOverride")}
      testId="override-form"
      onSubmit={() => {
        setTried(true);
        if (!reason.trim()) return;
        ask.mutate({ batchId: batch.id, reason: reason.trim() });
      }}
    >
      <Field label={t("ageing.override.reason")} error={tried && !reason.trim() ? t("ageing.override.reasonRequired") : undefined}>
        <TextInput value={reason} maxLength={500} onChange={(e) => setReason(e.currentTarget.value)} data-testid="override-reason" />
      </Field>
    </FormSheet>
  );
}

// ---------------------------------------------------------------------------
// Rework and void
// ---------------------------------------------------------------------------

export function ReworkSheet({ open, onOpenChange, batch }: SheetProps) {
  const { t } = useT();
  const navigate = useNavigate();
  const invalidate = useAgeingInvalidate();
  const trolleys = useQuery({ ...trpc.ageing.trolleys.list.queryOptions({}), enabled: open });
  const recipes = useQuery({ ...trpc.ageing.recipes.list.queryOptions({}), enabled: open });
  const duration = useDuration();
  const free = (trolleys.data?.items ?? []).filter((r) => r.status === "active" && r.openBatchId === null);
  const topUps = (recipes.data?.items ?? []).filter((r) => r.status === "active" && r.kind === "top_up" && r.alloy === batch.snapshot?.alloy && r.temper === batch.snapshot?.temper);
  const [trolleyId, setTrolleyId] = useState("");
  const [recipeId, setRecipeId] = useState("");
  useEffect(() => {
    if (open) {
      setTrolleyId("");
      setRecipeId("");
    }
  }, [open]);
  const rework = useMutation(
    trpc.ageing.batches.rework.mutationOptions({
      onSuccess: async (res) => {
        toast.success(t("ageing.rework.done", { number: res.successor.number }));
        await invalidate();
        onOpenChange(false);
        void navigate({ to: "/ageing/batch/$id", params: { id: res.successor.id } });
      },
    }),
  );
  const recipe = topUps.find((r) => r.id === recipeId);
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("ageing.rework.title", { number: batch.number })}
      description={t("ageing.rework.body", { pcs: batch.totals.heldPcs })}
      busy={rework.isPending}
      error={rework.error}
      submitLabel={t("ageing.action.rework")}
      testId="rework-form"
      onSubmit={() => rework.mutate({ batchId: batch.id, ...(recipeId ? { recipeId } : {}), ...(trolleyId ? { trolleyId } : {}) })}
    >
      <Field label={t("ageing.rework.trolley")} hint={t("ageing.rework.trolleyHint")}>
        <NativeSelect value={trolleyId} onChange={(e) => setTrolleyId(e.currentTarget.value)} data-testid="rework-trolley">
          <option value="">{t("ageing.rework.sameTrolley")}</option>
          {free.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("ageing.rework.recipe")} hint={recipe ? recipeLine(t, duration, recipe) : t("ageing.rework.recipeHint")}>
        <NativeSelect value={recipeId} onChange={(e) => setRecipeId(e.currentTarget.value)} data-testid="rework-recipe">
          <option value="">{t("ageing.rework.defaultRecipe")}</option>
          {topUps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.alloy} {r.temper} · {t(`ageing.recipeKind.${r.kind}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </FormSheet>
  );
}

export function VoidSheet({ open, onOpenChange, batch }: SheetProps) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const invalidate = useAgeingInvalidate();
  const reasons = useQuery({ ...trpc.press.reasons.queryOptions({ kind: "ageing_abort" }), enabled: open, staleTime: 5 * 60_000 });
  const options = useMemo(() => reasonOptions(t, "ageing_abort", reasons.data, locale), [t, reasons.data, locale]);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setReasonId("");
      setNote("");
      setTried(false);
    }
  }, [open]);
  // After take-out the batch needs a reason from the list; a batch still loading may go with a few words.
  const needsReason = batch.status !== "loading";
  const chosen = (reasons.data ?? []).find((r) => r.id === reasonId);
  const needsNote = Boolean(chosen && (chosen.requiresNote || chosen.code === "other"));
  const voidIt = useMutation(
    trpc.ageing.batches.void.mutationOptions({
      onSuccess: async () => {
        toast.success(t("ageing.void.done", { number: batch.number }));
        await invalidate();
        onOpenChange(false);
        void navigate({ to: "/ageing" });
      },
    }),
  );
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("ageing.void.title", { number: batch.number })}
      description={t(batch.reworkOfBatchId && batch.status === "loading" ? "ageing.void.bodyRework" : needsReason ? "ageing.void.bodyAfter" : "ageing.void.bodyLoading")}
      busy={voidIt.isPending}
      error={voidIt.error}
      submitLabel={t("ageing.action.void")}
      submitTone="danger"
      testId="void-form"
      onSubmit={() => {
        setTried(true);
        if (needsReason && !reasonId) return;
        if (needsNote && !note.trim()) return;
        voidIt.mutate({ batchId: batch.id, ...(reasonId ? { reasonCodeId: reasonId } : {}), ...(note.trim() ? { reason: note.trim() } : {}) });
      }}
    >
      <Field label={t("ageing.hold.reason")} error={tried && needsReason && !reasonId ? t("ageing.hold.reasonRequired") : undefined}>
        <NativeSelect value={reasonId} onChange={(e) => setReasonId(e.currentTarget.value)} data-testid="void-reason">
          <option value="">{t("ageing.hold.pick")}</option>
          {(reasons.data ?? []).map((r, i) => (
            <option key={r.id} value={r.id}>
              {options[i]?.label ?? r.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t("ageing.hold.note")} hint={needsNote ? undefined : t("common.optional")} error={tried && needsNote && !note.trim() ? t("ageing.hold.noteRequired") : undefined}>
        <TextInput value={note} maxLength={500} onChange={(e) => setNote(e.currentTarget.value)} data-testid="void-note" />
      </Field>
    </FormSheet>
  );
}
