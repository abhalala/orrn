import type { QaCheckKind, QaStage, QaSubjectType } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { trpc } from "@/shared/utils/trpc";

import { useQaInvalidate } from "./hooks";
import { dimensionsFromDrafts, draftsFromPlan, emptyDimension, kindTakesResult, optional, subjectsFor, tenthsFrom, wholeFrom, type DimensionDraft } from "./model";
import { QA_KINDS, QA_STAGE_LIST } from "./search";
import { QaFormSheet, QaSelect } from "./ui";

export type CheckPreset = {
  kind?: QaCheckKind;
  subjectType?: QaSubjectType;
  subject?: { id: string; number: string };
  stage?: QaStage;
  stationId?: string;
};

type Reading = { name: string; value: string };

/**
 * Record one check (rows 22 to 27, 39). The person finds what the check is on by the number on the
 * paper, then types readings. Dimensions and mechanical tests send values only: the server works out
 * pass or fail against the tolerance or the temper and flags what is out.
 */
export function CheckSheet({ open, onOpenChange, preset }: { open: boolean; onOpenChange(o: boolean): void; preset?: CheckPreset }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const invalidate = useQaInvalidate();
  const [kind, setKind] = useState<QaCheckKind>("incoming");
  const [subjectType, setSubjectType] = useState<QaSubjectType>("purchase_lot");
  const [number, setNumber] = useState("");
  const [subject, setSubject] = useState<{ id: string; number: string } | null>(null);
  const [findState, setFindState] = useState<"idle" | "busy" | "none">("idle");
  const [result, setResult] = useState<"pass" | "fail" | "">("");
  const [stage, setStage] = useState<QaStage>("pack");
  const [stationId, setStationId] = useState("");
  const [instrumentId, setInstrumentId] = useState("");
  const [temperId, setTemperId] = useState("");
  const [dims, setDims] = useState<DimensionDraft[]>([emptyDimension()]);
  const [mech, setMech] = useState({ tensile: "", yield: "", elongation: "", hardness: "" });
  const [readings, setReadings] = useState<Reading[]>([]);
  const [standard, setStandard] = useState("");
  const [operator, setOperator] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    const k = preset?.kind ?? "incoming";
    setKind(k);
    setSubjectType(preset?.subjectType ?? subjectsFor(k)[0]!);
    setSubject(preset?.subject ?? null);
    setNumber(preset?.subject?.number ?? "");
    setFindState("idle");
    setResult("");
    setStage(preset?.stage ?? "pack");
    setStationId(preset?.stationId ?? "");
    setInstrumentId("");
    setTemperId("");
    setDims([emptyDimension()]);
    setMech({ tensile: "", yield: "", elongation: "", hardness: "" });
    setReadings([]);
    setStandard("");
    setOperator("");
    setNote("");
    setTried(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const stations = useQuery({ ...trpc.qa.stations.list.queryOptions(), enabled: open });
  const instruments = useQuery({ ...trpc.qa.instruments.list.queryOptions(), enabled: open });
  const tempers = useQuery({ ...trpc.qa.tempers.list.queryOptions(), enabled: open && kind === "mechanical" });
  // A dimension check on a run starts from the run's quality plan.
  const run = useQuery({ ...trpc.qa.run.queryOptions({ runId: subject?.id ?? "" }), enabled: open && kind === "dimension" && subjectType === "press_run" && Boolean(subject) });
  const planDims = run.data?.plan?.dimensions;
  useEffect(() => {
    if (planDims && planDims.length > 0) setDims(draftsFromPlan(planDims));
  }, [planDims]);

  const record = useMutation(
    trpc.qa.checks.record.mutationOptions({
      onSuccess: async (r) => {
        toast.success(`${t("qa.sheet.recorded")}: ${r.result === "pass" ? t("qa.result.pass") : t("qa.result.fail")}`);
        await invalidate();
        onOpenChange(false);
      },
    }),
  );

  const pickKind = (k: QaCheckKind) => {
    setKind(k);
    if (!subjectsFor(k).includes(subjectType)) {
      setSubjectType(subjectsFor(k)[0]!);
      setSubject(null);
    }
  };

  const find = async () => {
    if (!number.trim()) return;
    setFindState("busy");
    try {
      const hit = await queryClient.fetchQuery(trpc.qa.findSubject.queryOptions({ subjectType, number: number.trim() }));
      setSubject(hit);
      setFindState(hit ? "idle" : "none");
    } catch {
      setSubject(null);
      setFindState("none");
    }
  };

  const dimRows = kind === "dimension" ? dimensionsFromDrafts(dims) : [];
  const m = {
    tensile: optional(mech.tensile, wholeFrom),
    yield: optional(mech.yield, wholeFrom),
    elongation: optional(mech.elongation, tenthsFrom),
    hardness: optional(mech.hardness, tenthsFrom),
  };
  const mechBad = Object.values(m).some((x) => x.bad);

  const submit = () => {
    setTried(true);
    if (!subject) return;
    if (kindTakesResult(kind) && !result) return;
    if (kind === "dimension" && (dimRows === null || dimRows.length === 0)) return;
    if (kind === "mechanical" && mechBad) return;
    const cleanReadings = readings.filter((r) => r.name.trim() && r.value.trim()).map((r) => ({ name: r.name.trim(), value: r.value.trim() }));
    record.mutate({
      kind,
      subjectType,
      subjectId: subject.id,
      ...(kindTakesResult(kind) && result ? { result } : {}),
      ...(kind === "clearance" ? { stage } : {}),
      ...(stationId ? { stationId } : {}),
      ...(instrumentId ? { instrumentId } : {}),
      ...(kind === "mechanical" && temperId ? { temperId } : {}),
      ...(kind === "dimension" && dimRows ? { dimensions: dimRows } : {}),
      ...(kind === "mechanical" ? { mechanical: { tensileMpa: m.tensile.value, yieldMpa: m.yield.value, elongationX10: m.elongation.value, hardnessX10: m.hardness.value } } : {}),
      ...((kind === "first_piece" || kind === "in_process") && cleanReadings.length ? { readings: cleanReadings } : {}),
      ...(kind === "ultrasonic" && standard.trim() ? { standard: standard.trim() } : {}),
      ...(operator.trim() ? { operatorName: operator.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <QaFormSheet open={open} onOpenChange={onOpenChange} title={t("qa.sheet.title")} busy={record.isPending} error={record.error} submitLabel={t("qa.sheet.save")} testId="qa-check-form" onSubmit={submit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("qa.sheet.kind")}>
          <QaSelect value={kind} onChange={(e) => pickKind(e.currentTarget.value as QaCheckKind)} data-testid="qa-check-kind">
            {QA_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`qa.kind.${k}`)}
              </option>
            ))}
          </QaSelect>
        </Field>
        <Field label={t("qa.sheet.subjectType")}>
          <QaSelect
            value={subjectType}
            onChange={(e) => {
              setSubjectType(e.currentTarget.value as QaSubjectType);
              setSubject(null);
              setFindState("idle");
            }}
            data-testid="qa-check-subject-type"
          >
            {subjectsFor(kind).map((s) => (
              <option key={s} value={s}>
                {t(`qa.subject.${s}`)}
              </option>
            ))}
          </QaSelect>
        </Field>
      </div>
      <Field
        label={t("qa.sheet.number")}
        hint={subject ? t("qa.sheet.found", { number: subject.number }) : t("qa.sheet.numberHint")}
        error={findState === "none" ? t("qa.sheet.notFound") : tried && !subject ? t("qa.sheet.needSubject") : undefined}
      >
        <div className="flex gap-2">
          <TextInput
            value={number}
            maxLength={64}
            autoComplete="off"
            className="font-mono"
            onChange={(e) => {
              setNumber(e.currentTarget.value);
              setSubject(null);
              setFindState("idle");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void find();
              }
            }}
            data-testid="qa-check-number"
          />
          <Button variant="secondary" onClick={() => void find()} loading={findState === "busy"} data-testid="qa-check-find">
            {t("qa.sheet.find")}
          </Button>
        </div>
      </Field>

      {kindTakesResult(kind) ? (
        <Field label={t("qa.sheet.result")} error={tried && !result ? t("qa.refusal.resultNeeded") : undefined}>
          <SegmentedControl<"pass" | "fail" | "">
            label={t("qa.sheet.result")}
            value={result}
            options={[
              { value: "pass", label: t("qa.result.pass") },
              { value: "fail", label: t("qa.result.fail") },
            ]}
            onChange={setResult}
          />
        </Field>
      ) : null}

      {kind === "clearance" ? (
        <Field label={t("qa.sheet.stage")}>
          <QaSelect value={stage} onChange={(e) => setStage(e.currentTarget.value as QaStage)} data-testid="qa-check-stage">
            {QA_STAGE_LIST.map((s) => (
              <option key={s} value={s}>
                {t(`qa.stage.${s}`)}
              </option>
            ))}
          </QaSelect>
        </Field>
      ) : null}

      {kind === "dimension" ? <DimensionRows rows={dims} onChange={setDims} bad={tried && (dimRows === null || dimRows.length === 0)} /> : null}

      {kind === "mechanical" ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("qa.sheet.mech.tensile")} error={tried && m.tensile.bad ? t("qa.sheet.dims.bad") : undefined}>
              <NumberInput decimal={false} value={mech.tensile} onValueChange={(v) => setMech((s) => ({ ...s, tensile: v }))} data-testid="qa-mech-tensile" />
            </Field>
            <Field label={t("qa.sheet.mech.yield")} error={tried && m.yield.bad ? t("qa.sheet.dims.bad") : undefined}>
              <NumberInput decimal={false} value={mech.yield} onValueChange={(v) => setMech((s) => ({ ...s, yield: v }))} data-testid="qa-mech-yield" />
            </Field>
            <Field label={t("qa.sheet.mech.elongation")} error={tried && m.elongation.bad ? t("qa.sheet.dims.bad") : undefined}>
              <NumberInput value={mech.elongation} onValueChange={(v) => setMech((s) => ({ ...s, elongation: v }))} data-testid="qa-mech-elongation" />
            </Field>
            <Field label={t("qa.sheet.mech.hardness")} error={tried && m.hardness.bad ? t("qa.sheet.dims.bad") : undefined}>
              <NumberInput value={mech.hardness} onValueChange={(v) => setMech((s) => ({ ...s, hardness: v }))} data-testid="qa-mech-hardness" />
            </Field>
          </div>
          <Field label={t("qa.sheet.mech.temper")}>
            <QaSelect value={temperId} onChange={(e) => setTemperId(e.currentTarget.value)} data-testid="qa-mech-temper">
              <option value="">{t("qa.sheet.mech.temperPlan")}</option>
              {(tempers.data?.items ?? []).map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {tp.alloy ? `${tp.alloy} ${tp.code}` : tp.code}
                </option>
              ))}
            </QaSelect>
          </Field>
        </>
      ) : null}

      {kind === "first_piece" || kind === "in_process" ? <ReadingRows rows={readings} onChange={setReadings} /> : null}

      {kind === "ultrasonic" ? (
        <Field label={t("qa.sheet.standard")}>
          <TextInput value={standard} maxLength={80} onChange={(e) => setStandard(e.currentTarget.value)} data-testid="qa-check-standard" />
        </Field>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("qa.sheet.station")}>
          <QaSelect value={stationId} onChange={(e) => setStationId(e.currentTarget.value)}>
            <option value="">{t("qa.sheet.none")}</option>
            {(stations.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} {s.name}
              </option>
            ))}
          </QaSelect>
        </Field>
        <Field label={t("qa.sheet.instrument")}>
          <QaSelect value={instrumentId} onChange={(e) => setInstrumentId(e.currentTarget.value)}>
            <option value="">{t("qa.sheet.none")}</option>
            {(instruments.data?.items ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} {i.name}
              </option>
            ))}
          </QaSelect>
        </Field>
      </div>
      <Field label={t("qa.sheet.operator")}>
        <TextInput value={operator} maxLength={80} onChange={(e) => setOperator(e.currentTarget.value)} />
      </Field>
      <Field label={t("qa.sheet.note")}>
        <FieldTextArea value={note} maxLength={500} onChange={(e) => setNote(e.currentTarget.value)} />
      </Field>
    </QaFormSheet>
  );
}

function DimensionRows({ rows, onChange, bad }: { rows: DimensionDraft[]; onChange(rows: DimensionDraft[]): void; bad: boolean }) {
  const { t } = useT();
  const set = (i: number, key: keyof DimensionDraft, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" data-testid="qa-dims">
      <legend className="mb-2 text-[15px] font-semibold">{t("qa.sheet.dims.title")}</legend>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-card border border-border p-3 sm:grid-cols-[1.4fr_repeat(4,1fr)_auto]" data-dim-row={i}>
          <Field label={t("qa.sheet.dims.name")} className="col-span-2 sm:col-span-1">
            <TextInput value={r.name} maxLength={40} onChange={(e) => set(i, "name", e.currentTarget.value)} />
          </Field>
          <Field label={t("qa.sheet.dims.nominal")}>
            <NumberInput value={r.nominal} onValueChange={(v) => set(i, "nominal", v)} />
          </Field>
          <Field label={t("qa.sheet.dims.minus")}>
            <NumberInput value={r.minus} onValueChange={(v) => set(i, "minus", v)} />
          </Field>
          <Field label={t("qa.sheet.dims.plus")}>
            <NumberInput value={r.plus} onValueChange={(v) => set(i, "plus", v)} />
          </Field>
          <Field label={t("qa.sheet.dims.measured")}>
            <NumberInput value={r.measured} onValueChange={(v) => set(i, "measured", v)} data-testid={`qa-dim-measured-${i}`} />
          </Field>
          <div className="flex items-end">
            <Button variant="ghost" aria-label={t("qa.sheet.dims.remove")} disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <X aria-hidden="true" />
            </Button>
          </div>
        </div>
      ))}
      {bad ? (
        <p role="alert" className="m-0 text-[14px] font-medium text-tone-red-ink">
          {t("qa.sheet.dims.bad")}
        </p>
      ) : null}
      <div>
        <Button variant="secondary" onClick={() => onChange([...rows, emptyDimension()])} disabled={rows.length >= 20}>
          <Plus aria-hidden="true" />
          {t("qa.sheet.dims.add")}
        </Button>
      </div>
    </fieldset>
  );
}

function ReadingRows({ rows, onChange }: { rows: Reading[]; onChange(rows: Reading[]): void }) {
  const { t } = useT();
  const set = (i: number, key: keyof Reading, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-2 text-[15px] font-semibold">{t("qa.sheet.readings.title")}</legend>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field label={t("qa.sheet.readings.name")}>
            <TextInput value={r.name} maxLength={40} onChange={(e) => set(i, "name", e.currentTarget.value)} />
          </Field>
          <Field label={t("qa.sheet.readings.value")}>
            <TextInput value={r.value} maxLength={40} onChange={(e) => set(i, "value", e.currentTarget.value)} />
          </Field>
          <Button variant="ghost" aria-label={t("qa.sheet.dims.remove")} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
      <div>
        <Button variant="secondary" onClick={() => onChange([...rows, { name: "", value: "" }])} disabled={rows.length >= 20}>
          <Plus aria-hidden="true" />
          {t("qa.sheet.readings.add")}
        </Button>
      </div>
    </fieldset>
  );
}
