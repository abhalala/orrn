import { fabricationOps, finishProcesses, type ProcessKind } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { useNavigate } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StickyBar } from "@/shared/components/sticky-bar";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { trpc } from "@/shared/utils/trpc";

import { useJobworkInvalidate } from "./hooks";
import { startPayload, startProblems, toggleOp, type BundlePick, type ChemicalRow, type StartDraft } from "./model";
import { BundlePicker } from "./picker";
import { FieldSelect, Panel, RefusalNote } from "./ui";

type InHouseKind = Exclude<ProcessKind, "jobwork">;

/** Anodise, powder coat, PVD and other happen on the line; machining is job work only (the server refuses it here). */
const LINE_PROCESSES = finishProcesses.filter((p) => p !== "machining");

const EMPTY: StartDraft = { process: "anodise", finishCode: "", batchNo: "", chemicals: [], passes: "", outSize: "", ops: [], note: "", picks: [] };

/**
 * Start an in-house step (rows 54, 55, 56): bundles stay where they are and go on hold until the step is received. The finishing
 * line names its process, batch and chemicals; the draw bench its passes and out size; fabrication its operations.
 */
export function StartForm({ kind, onCancel }: { kind: InHouseKind; onCancel?: () => void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const invalidate = useJobworkInvalidate();
  const [draft, setDraft] = useState<StartDraft>(EMPTY);
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<StartDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const problems = startProblems(kind, draft);

  const done = async (res: { id: string; number: string }) => {
    toast.success(t("jw.start.started", { number: res.number }));
    await invalidate();
    void navigate({ to: "/jobwork/$id", params: { id: res.id } });
  };
  const finish = useOnceMutation(trpc.process.steps.start.mutationOptions({ onSuccess: done }));
  const draw = useOnceMutation(trpc.drawbench.start.mutationOptions({ onSuccess: done }));
  const fab = useOnceMutation(trpc.fabrication.start.mutationOptions({ onSuccess: done }));
  const m = kind === "finish" ? finish : kind === "draw" ? draw : fab;
  const busy = m.isPending;

  const submit = () => {
    setTried(true);
    if (problems.length > 0) return;
    const body = startPayload(kind, draft);
    if (kind === "finish") finish.mutate({ ...body, process: draft.process as (typeof finishProcesses)[number] });
    else if (kind === "draw") draw.mutate(body);
    else fab.mutate(body);
  };
  const chemicals = draft.chemicals;
  const setChem = (i: number, patch: Partial<ChemicalRow>) => set({ chemicals: chemicals.map((c, n) => (n === i ? { ...c, ...patch } : c)) });

  return (
    <form
      noValidate
      className="flex min-w-0 flex-col gap-5"
      data-testid={`start-form-${kind}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) submit();
      }}
    >
      <Panel className="flex min-w-0 flex-col gap-4">
        {kind === "finish" ? (
          <>
            <Field label={t("jw.field.process")}>
              <FieldSelect value={draft.process} onChange={(e) => set({ process: e.currentTarget.value })} data-testid="start-process">
                {LINE_PROCESSES.map((p) => (
                  <option key={p} value={p}>
                    {t(`jw.process.${p}`)}
                  </option>
                ))}
              </FieldSelect>
            </Field>
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t("jw.field.finishCode")} hint={t("jw.field.finishCodeHint")}>
                <TextInput value={draft.finishCode} maxLength={40} onChange={(e) => set({ finishCode: e.currentTarget.value })} data-testid="start-finish-code" />
              </Field>
              <Field label={t("jw.field.batchNo")}>
                <TextInput value={draft.batchNo} maxLength={40} onChange={(e) => set({ batchNo: e.currentTarget.value })} data-testid="start-batch" />
              </Field>
            </div>
            <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
              <legend className="mb-1 p-0 text-[14px] font-semibold">{t("jw.field.chemicals")}</legend>
              {chemicals.map((c, i) => (
                <div key={i} className="grid min-w-0 grid-cols-[1fr_7rem_auto] items-end gap-2" data-testid="chemical-row">
                  <Field label={t("jw.field.chemicalName")} error={tried && !c.name.trim() && c.qty.trim() ? t("jw.error.chemicalName") : undefined}>
                    <TextInput value={c.name} maxLength={60} onChange={(e) => setChem(i, { name: e.currentTarget.value })} />
                  </Field>
                  <Field label={t("jw.field.chemicalQty")}>
                    <TextInput value={c.qty} maxLength={30} onChange={(e) => setChem(i, { qty: e.currentTarget.value })} />
                  </Field>
                  <Button type="button" variant="secondary" size="icon" aria-label={t("jw.action.removeChemical")} onClick={() => set({ chemicals: chemicals.filter((_, n) => n !== i) })}>
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              ))}
              <div>
                <Button type="button" variant="secondary" disabled={chemicals.length >= 20} onClick={() => set({ chemicals: [...chemicals, { name: "", qty: "" }] })} data-testid="add-chemical">
                  <Plus aria-hidden="true" className="size-4" />
                  {t("jw.action.addChemical")}
                </Button>
              </div>
            </fieldset>
          </>
        ) : null}
        {kind === "draw" ? (
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("jw.field.passes")} error={tried && problems.includes("passes") ? t("jw.error.passes") : undefined}>
              <NumberInput value={draft.passes} decimal={false} onValueChange={(passes) => set({ passes })} data-testid="start-passes" />
            </Field>
            <Field label={t("jw.field.outSize")} hint={t("jw.field.outSizeHint")}>
              <TextInput value={draft.outSize} maxLength={80} onChange={(e) => set({ outSize: e.currentTarget.value })} data-testid="start-out-size" />
            </Field>
          </div>
        ) : null}
        {kind === "fabricate" ? (
          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" data-testid="start-ops">
            <legend className="mb-1 p-0 text-[14px] font-semibold">{t("jw.field.ops")}</legend>
            {fabricationOps.map((op) => (
              <label key={op} className="flex min-h-11 items-center gap-3 text-[15px]">
                <Checkbox checked={draft.ops.includes(op)} onCheckedChange={() => set({ ops: toggleOp(fabricationOps, draft.ops, op) })} aria-label={t(`jw.op.${op}`)} />
                <span>{t(`jw.op.${op}`)}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <Field label={t("jw.field.note")}>
          <TextInput value={draft.note} maxLength={500} onChange={(e) => set({ note: e.currentTarget.value })} data-testid="start-note" />
        </Field>
      </Panel>
      <Panel>
        <BundlePicker picks={draft.picks} onChange={(picks: BundlePick[]) => set({ picks })} error={tried && problems.includes("bundles") ? t("jw.error.bundles") : tried && problems.includes("tooMany") ? t("jw.error.tooMany") : undefined} />
      </Panel>
      <RefusalNote error={m.error} />
      <StickyBar className="sticky bottom-0 z-10 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        {onCancel ? (
          <Button type="button" variant="secondary" size="lg" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button type="submit" size="lg" loading={busy} data-testid="start-submit">
          {t("jw.action.start")}
        </Button>
      </StickyBar>
    </form>
  );
}
