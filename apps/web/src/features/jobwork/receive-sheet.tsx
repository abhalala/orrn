import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Plus, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PlantInput } from "@/shared/components/plant-input";
import { useFmt } from "@/shared/lib/fmt";
import { kgWithUnit, rateText, rupeeScreen } from "@/shared/lib/fmt-text";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { canonicalToDraft, LENGTH_MM, MASS_KG } from "@/shared/lib/plant-input";
import { trpc } from "@/shared/utils/trpc";

import { useJobworkInvalidate, useSeesCost, useYards, type StepDetail } from "./hooks";
import {
  costPreview,
  defaultMode,
  EMPTY_OUTPUT,
  EMPTY_SAME,
  gramsOrZero,
  isCoat,
  needsYard,
  openInputs,
  paiseDraft,
  paiseOf,
  pcsOrZero,
  percentOfBp,
  previewNew,
  previewSame,
  receivePayload,
  refusalKeyOf,
  type InputRow,
  type OutputDraft,
  type ReturnPreview,
  type RowProblem,
  type SameDraft,
} from "./model";
import { FieldSelect, FormSheet, Panel } from "./ui";

const PROBLEM_KEY: Record<RowProblem, "jw.error.rowWeight" | "jw.error.rowRejectPcs" | "jw.error.rowRejectKg" | "jw.error.rowRejectsAll" | "jw.error.rowLength" | "jw.error.rowPcs"> = {
  weight: "jw.error.rowWeight",
  rejectPcs: "jw.error.rowRejectPcs",
  rejectKg: "jw.error.rowRejectKg",
  rejectsAll: "jw.error.rowRejectsAll",
  length: "jw.error.rowLength",
  pcs: "jw.error.rowPcs",
};

/**
 * Receive a step (job work and the finishing line: `process.steps.receive`; the draw bench and fabrication have their own).
 * Mode same: each bundle that came back with its weight after the process and its rejects; mode new: the inputs are used up
 * and the output lines become new bundles. The figures under the form are the domain's own (`returnFigures`, `returnRefusal`),
 * so a return the server would refuse says why before the tap.
 */
export function ReceiveSheet({ data, open, onOpenChange }: { data: StepDetail; open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const fmt = useFmt();
  const seesCost = useSeesCost();
  const invalidate = useJobworkInvalidate();
  const step = data.step;
  const kind = step.kind;
  const coat = isCoat(step.process);
  const inputs = useMemo(() => data.inputs as InputRow[], [data.inputs]);
  const stillOut = openInputs(inputs);
  const yards = useYards(open);

  const [mode, setMode] = useState<"same" | "new">(defaultMode(kind));
  const [same, setSame] = useState<Record<string, SameDraft>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<OutputDraft[]>([EMPTY_OUTPUT]);
  const [reject, setReject] = useState("");
  const [rejectPcs, setRejectPcs] = useState("");
  const [scrap, setScrap] = useState("");
  const [locationId, setLocationId] = useState("");
  const [vendorDocNo, setVendorDocNo] = useState("");
  const [rate, setRate] = useState("");
  const [minutes, setMinutes] = useState("");
  const [passes, setPasses] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  // Draw bench and fabrication make a new size: their output may be any active section, found by search.
  const [sectionSearch, setSectionSearch] = useState("");
  const [extraDies, setExtraDies] = useState<{ id: string; code: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    setMode(defaultMode(kind));
    setSame({});
    setPicked(openInputs(inputs).map((i) => i.bundleId));
    setOutputs([EMPTY_OUTPUT]);
    setReject("");
    setRejectPcs("");
    setScrap("");
    setLocationId("");
    setVendorDocNo("");
    setRate(paiseDraft(step.ratePaisePerKg));
    setMinutes("");
    setPasses(step.passes ? String(step.passes) : "");
    setNote("");
    setSectionSearch("");
    setExtraDies([]);
    setTried(false);
    // Only when the sheet opens (or the step changes under it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step.id]);
  useEffect(() => {
    if (open && !locationId && yards.yards.length === 1) setLocationId(yards.yards[0]!.id);
  }, [open, locationId, yards.yards]);

  const dies = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of inputs) if (!seen.has(i.dieId)) seen.set(i.dieId, i.sectionCode);
    return [...seen].map(([id, code]) => ({ id, code }));
  }, [inputs]);
  const anySection = mode === "new" && (kind === "draw" || kind === "fabricate");
  const searchText = sectionSearch.trim();
  const found = useQuery({
    ...trpc.die.list.queryOptions({ search: searchText, status: "active", limit: 20, offset: 0 }),
    enabled: open && anySection && searchText.length >= 2,
    staleTime: 30_000,
  });
  const dieOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of [...dies, ...extraDies]) if (!seen.has(d.id)) seen.set(d.id, d.code);
    for (const d of found.data?.items ?? []) if (!seen.has(d.id)) seen.set(d.id, d.sectionCode);
    return [...seen].map(([id, code]) => ({ id, code }));
  }, [dies, extraDies, found.data]);
  const pickDie = (n: number, dieId: string) => {
    const hit = dieOptions.find((d) => d.id === dieId);
    if (hit && !dies.some((d) => d.id === dieId)) setExtraDies((x) => (x.some((d) => d.id === dieId) ? x : [...x, hit]));
    setOut(n, { dieId });
  };
  const sameRes = useMemo(() => previewSame({ inputs: stillOut, drafts: same, scrapDraft: scrap, coat }), [stillOut, same, scrap, coat]);
  const newRes = useMemo(() => previewNew({ inputs, picked, outputs, rejectDraft: reject, scrapDraft: scrap, coat }), [inputs, picked, outputs, reject, scrap, coat]);
  const preview: ReturnPreview = mode === "same" ? sameRes.preview : newRes.preview;
  const wantsYard = needsYard(kind, mode);
  const yardMissing = wantsYard && !locationId;
  const rejectPcsN = pcsOrZero(rejectPcs);
  const rejectPcsBad = mode === "new" && rejectPcsN === null;
  // More than one section among the inputs: each new bundle must say which one it is.
  const dieMissing = mode === "new" && dies.length > 1 && newRes.lines.some((l) => !l.dieId);
  const canSave = preview.ready && !yardMissing && !rejectPcsBad && !dieMissing;
  const cost = costPreview(seesCost ? paiseOf(rate) : null, preview.figures);

  const onSuccess = async () => {
    toast.success(t("jw.receive.done", { number: step.number }));
    await invalidate();
    onOpenChange(false);
  };
  const viaSteps = useOnceMutation(trpc.process.steps.receive.mutationOptions({ onSuccess }));
  const viaDraw = useOnceMutation(trpc.drawbench.receive.mutationOptions({ onSuccess }));
  const viaFab = useOnceMutation(trpc.fabrication.receive.mutationOptions({ onSuccess }));
  const m = kind === "draw" ? viaDraw : kind === "fabricate" ? viaFab : viaSteps;

  const submit = () => {
    setTried(true);
    if (!canSave) return;
    const scrapG = gramsOrZero(scrap) ?? 0;
    const body = receivePayload(
      { id: step.id, mode, locationId, vendorDocNo, rateDraft: seesCost ? rate : "", minutes, passes, note },
      {
        same: sameRes.lines,
        output: newRes.lines,
        closingIds: newRes.closingIds,
        scrapG,
        rejectG: gramsOrZero(reject) ?? 0,
        rejectPcs: rejectPcsN ?? 0,
      },
      wantsYard,
    );
    if (kind === "draw") viaDraw.mutate(body);
    else if (kind === "fabricate") viaFab.mutate(body);
    else viaSteps.mutate(body);
  };

  const setRow = (id: string, patch: Partial<SameDraft>) => setSame((s) => ({ ...s, [id]: { ...(s[id] ?? EMPTY_SAME), ...patch } }));
  const setOut = (n: number, patch: Partial<OutputDraft>) => setOutputs((o) => o.map((x, i) => (i === n ? { ...x, ...patch } : x)));

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("jw.receive.title", { number: step.number })}
      description={t("jw.receive.subtitle")}
      busy={m.isPending}
      error={m.error}
      submitLabel={t("jw.action.receive")}
      submitDisabled={tried && !canSave}
      testId="receive-form"
      onSubmit={submit}
    >
      <SegmentedControl
        value={mode}
        onChange={setMode}
        label={t("jw.receive.mode")}
        options={[
          { value: "same", label: t("jw.mode.same") },
          { value: "new", label: t("jw.mode.new") },
        ]}
      />
      <p className="m-0 text-[14px] leading-6 text-muted-foreground">{mode === "same" ? t("jw.receive.sameHint") : t("jw.receive.newHint")}</p>

      {mode === "same" ? (
        <div className="flex min-w-0 flex-col gap-3" data-testid="same-rows">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 text-[14px] font-semibold">{t("jw.receive.stillOut", { count: stillOut.length })}</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => setSame(Object.fromEntries(stillOut.map((i) => [i.bundleId, { ...(same[i.bundleId] ?? EMPTY_SAME), weight: canonicalToDraft(MASS_KG, i.weightG) }])))} data-testid="fill-sent">
              {t("jw.receive.fillSent")}
            </Button>
          </div>
          {stillOut.map((i) => {
            const d = same[i.bundleId] ?? EMPTY_SAME;
            const problem = sameRes.preview.rowProblems[i.bundleId];
            return (
              <Panel key={i.bundleId} className="flex min-w-0 flex-col gap-3 p-3 sm:p-3" data-testid="same-row" data-serial={i.serial}>
                <p className="m-0 flex flex-wrap items-baseline justify-between gap-x-3 text-[14px]">
                  <span className="font-mono text-[15px] font-semibold">{i.serial}</span>
                  <span className="text-muted-foreground">
                    {t("jw.receive.sent", { pcs: i.pcs, weight: kgWithUnit(fmt, i.weightG) })}
                  </span>
                </p>
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label={t("jw.receive.cameBack")} error={tried && problem === "weight" ? t(PROBLEM_KEY.weight) : undefined}>
                    <PlantInput spec={MASS_KG} value={d.weight} onValueChange={(weight) => setRow(i.bundleId, { weight })} data-testid="row-weight" />
                  </Field>
                  <Field label={t("jw.receive.rejectPcs")} error={tried && (problem === "rejectPcs" || problem === "rejectsAll") ? t(PROBLEM_KEY[problem]) : undefined}>
                    <NumberInput value={d.rejectPcs} decimal={false} onValueChange={(rejectPcs) => setRow(i.bundleId, { rejectPcs })} data-testid="row-reject-pcs" />
                  </Field>
                  <Field label={t("jw.receive.rejectWeight")} error={tried && problem === "rejectKg" ? t(PROBLEM_KEY.rejectKg) : undefined}>
                    <PlantInput spec={MASS_KG} value={d.rejectKg} onValueChange={(rejectKg) => setRow(i.bundleId, { rejectKg })} data-testid="row-reject-kg" />
                  </Field>
                </div>
              </Panel>
            );
          })}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-4" data-testid="new-rows">
          <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-[14px] font-semibold">{t("jw.receive.usedUp")}</legend>
            {stillOut.map((i) => (
              <label key={i.bundleId} className="flex min-h-11 items-center gap-3 text-[15px]">
                <Checkbox
                  checked={picked.includes(i.bundleId)}
                  onCheckedChange={() => setPicked((p) => (p.includes(i.bundleId) ? p.filter((x) => x !== i.bundleId) : [...p, i.bundleId]))}
                  aria-label={i.serial}
                />
                <span className="font-mono font-semibold">{i.serial}</span>
                <span className="text-[13px] text-muted-foreground">{t("jw.receive.sent", { pcs: i.pcs, weight: kgWithUnit(fmt, i.weightG) })}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex min-w-0 flex-col gap-3">
            <p className="m-0 text-[14px] font-semibold">{t("jw.receive.outputs")}</p>
            {anySection ? (
              <Field label={t("jw.receive.findSection")} hint={t("jw.receive.findSectionHint")}>
                <TextInput value={sectionSearch} maxLength={60} onChange={(e) => setSectionSearch(e.currentTarget.value)} data-testid="output-section-search" />
              </Field>
            ) : null}
            {outputs.map((o, n) => {
              const problem = newRes.preview.rowProblems[`out-${n}`];
              return (
                <Panel key={n} className="flex min-w-0 flex-col gap-3 p-3 sm:p-3" data-testid="output-row">
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                    {dies.length > 1 || anySection ? (
                      <Field label={t("jw.receive.section")} className="sm:col-span-2" error={tried && !o.dieId && newRes.lines.length > 0 ? t("jw.error.section") : undefined}>
                        <FieldSelect value={o.dieId} onChange={(e) => pickDie(n, e.currentTarget.value)} data-testid="output-die">
                          <option value="">{dies.length === 1 ? t("jw.receive.sameSection", { section: dies[0]!.code }) : t("jw.receive.pickSection")}</option>
                          {dieOptions.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.code}
                            </option>
                          ))}
                        </FieldSelect>
                      </Field>
                    ) : null}
                    <Field label={t("jw.receive.length")} error={tried && problem === "length" ? t(PROBLEM_KEY.length) : undefined}>
                      <PlantInput spec={LENGTH_MM} value={o.length} onValueChange={(length) => setOut(n, { length })} data-testid="output-length" />
                    </Field>
                    <Field label={t("jw.receive.pcs")} error={tried && problem === "pcs" ? t(PROBLEM_KEY.pcs) : undefined}>
                      <NumberInput value={o.pcs} decimal={false} onValueChange={(pcs) => setOut(n, { pcs })} data-testid="output-pcs" />
                    </Field>
                    <Field label={t("jw.receive.weight")} error={tried && problem === "weight" ? t(PROBLEM_KEY.weight) : undefined} className="sm:col-span-2">
                      <PlantInput spec={MASS_KG} value={o.weight} onValueChange={(weight) => setOut(n, { weight })} data-testid="output-weight" />
                    </Field>
                  </div>
                  {outputs.length > 1 ? (
                    <div>
                      <Button type="button" variant="secondary" size="sm" onClick={() => setOutputs((x) => x.filter((_, i) => i !== n))}>
                        <X aria-hidden="true" className="size-4" />
                        {t("jw.action.removeLine")}
                      </Button>
                    </div>
                  ) : null}
                </Panel>
              );
            })}
            <div>
              <Button type="button" variant="secondary" onClick={() => setOutputs((x) => [...x, { ...EMPTY_OUTPUT, dieId: x[x.length - 1]?.dieId ?? "" }])} data-testid="add-output">
                <Plus aria-hidden="true" className="size-4" />
                {t("jw.action.addLine")}
              </Button>
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("jw.receive.rejectWeight")} error={tried && newRes.preview.rejectBad ? t(PROBLEM_KEY.rejectKg) : undefined}>
              <PlantInput spec={MASS_KG} value={reject} onValueChange={setReject} data-testid="new-reject-kg" />
            </Field>
            <Field label={t("jw.receive.rejectPcs")} error={tried && rejectPcsBad ? t(PROBLEM_KEY.rejectPcs) : undefined}>
              <NumberInput value={rejectPcs} decimal={false} onValueChange={setRejectPcs} data-testid="new-reject-pcs" />
            </Field>
          </div>
        </div>
      )}

      <Field label={t("jw.receive.scrap")} hint={t("jw.receive.scrapHint")} error={tried && preview.scrapBad ? t(PROBLEM_KEY.weight) : undefined}>
        <PlantInput spec={MASS_KG} value={scrap} onValueChange={setScrap} data-testid="receive-scrap" />
      </Field>

      {wantsYard ? (
        <Field label={t("jw.receive.yard")} hint={t("jw.receive.yardHint")} error={tried && yardMissing ? t("jw.error.yard") : undefined} required>
          <FieldSelect value={locationId} onChange={(e) => setLocationId(e.currentTarget.value)} data-testid="receive-yard">
            <option value="">{t("jw.receive.pickYard")}</option>
            {yards.yards.map((y) => (
              <option key={y.id} value={y.id}>
                {y.code}
                {y.name && y.name !== y.code ? ` · ${y.name}` : ""}
              </option>
            ))}
          </FieldSelect>
        </Field>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {kind === "jobwork" ? (
          <Field label={t("jw.receive.vendorDoc")} hint={t("jw.receive.vendorDocHint")}>
            <TextInput value={vendorDocNo} maxLength={40} onChange={(e) => setVendorDocNo(e.currentTarget.value)} data-testid="receive-doc" />
          </Field>
        ) : null}
        {seesCost ? (
          <Field label={t("jw.rate.label")} hint={t("jw.rate.receiveHint")}>
            <NumberInput value={rate} suffix="₹" onValueChange={setRate} data-testid="receive-rate" />
          </Field>
        ) : null}
        {kind !== "jobwork" ? (
          <Field label={t("jw.receive.minutes")}>
            <NumberInput value={minutes} decimal={false} onValueChange={setMinutes} data-testid="receive-minutes" />
          </Field>
        ) : null}
        {kind === "draw" ? (
          <Field label={t("jw.field.passes")}>
            <NumberInput value={passes} decimal={false} onValueChange={setPasses} data-testid="receive-passes" />
          </Field>
        ) : null}
      </div>
      <Field label={t("jw.field.note")}>
        <TextInput value={note} maxLength={500} onChange={(e) => setNote(e.currentTarget.value)} />
      </Field>

      <Figures preview={preview} cost={cost} coat={coat} />
    </FormSheet>
  );
}

/** The return as the server will book it: kg in, good, rejects, scrap, loss (or gain), yield, and the bill when money is shown. */
function Figures({ preview, cost, coat }: { preview: ReturnPreview; cost: ReturnType<typeof costPreview>; coat: boolean }) {
  const { t } = useT();
  const fmt = useFmt();
  const f = preview.figures;
  if (!f) return <p className="m-0 text-[14px] text-muted-foreground" data-testid="return-figures-empty">{t("jw.receive.figuresEmpty")}</p>;
  const gain = f.lossG < 0;
  const rows: [string, string][] = [
    [t("jw.fig.in"), kgWithUnit(fmt, f.inputG)],
    [t("jw.fig.good"), kgWithUnit(fmt, f.outputG)],
    [t("jw.fig.rejects"), kgWithUnit(fmt, f.rejectG)],
    [t("jw.fig.scrap"), kgWithUnit(fmt, f.scrapG)],
    [gain ? t("jw.fig.gain") : t("jw.fig.loss"), `${kgWithUnit(fmt, Math.abs(f.lossG))} · ${t("jw.fig.percent", { value: percentOfBp(f.lossBp) })}`],
    [t("jw.fig.yield"), t("jw.fig.percent", { value: percentOfBp(f.yieldBp) })],
  ];
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-card bg-muted/40 p-3" data-testid="return-figures" data-loss-g={f.lossG}>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
            <dd className="m-0 text-[15px] font-semibold break-words tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {cost ? (
        <p className="m-0 text-[14px] text-muted-foreground" data-testid="return-cost">
          {t("jw.fig.bill", { amount: rupeeScreen(fmt, cost.amountPaise) })}
          {cost.costPerKgPaise !== null ? ` · ${t("jw.rate.costPerKg", { rate: rateText(fmt, cost.costPerKgPaise) })}` : ""}
        </p>
      ) : null}
      {gain && coat ? <p className="m-0 text-[13px] text-muted-foreground">{t("jw.fig.coatNote")}</p> : null}
      {preview.refusal ? (
        <p role="alert" className="m-0 text-[14px] font-medium text-tone-red-ink" data-testid="return-refusal">
          {t(refusalKeyOf(preview.refusal))}
        </p>
      ) : null}
    </div>
  );
}
