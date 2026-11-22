import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { kgWithUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { readUnitEntry, unitEntryText, unitProblemText } from "@/shared/lib/unit-input";
import { trpc } from "@/shared/utils/trpc";

import { blocksIssue, inspectionInput, type InspectionResult } from "./card-toolroom-model";
import { useRefreshDieRoom, useRefusal } from "./use-die-room";

export type ToolRoomCopy = {
  category: { id: string; name: string; expectedLifeG: number | null } | null;
  inspection: InspectionResult | null;
  producedG: number;
  seesCost: boolean;
  costPaise: number | null;
  costPerKgPaise: number | null;
};

/**
 * The block's look, from data alone: category and expected life, kg made, the receive inspection and
 * (for people who see money) cost and cost per kg. Buttons come in as slots, already gated by the caller.
 */
export function ToolRoomView({ data, recordAction, costAction }: { data: ToolRoomCopy; recordAction?: ReactNode; costAction?: ReactNode }) {
  const { t } = useT();
  const fmt = useFmt();
  const failed = blocksIssue(data.inspection);
  return (
    <Card className="min-w-0" data-testid="toolroom-block">
      <CardTitle>{t("adm.floor.title")}</CardTitle>
      <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-[12px] font-medium text-muted-foreground">{t("adm.kindOne.die_category")}</dt>
          <dd className="m-0 text-[14px] break-words" data-testid="toolroom-category">
            {data.category ? data.category.name : t("adm.floor.copy.noCategory")}
          </dd>
        </div>
        {data.category?.expectedLifeG != null ? (
          <div className="min-w-0">
            <dd className="m-0 text-[14px] tabular-nums" data-testid="toolroom-life">
              {t("adm.floor.copy.life", { life: kgWithUnit(fmt, data.category.expectedLifeG) })}
            </dd>
          </div>
        ) : null}
        <div className="min-w-0">
          <dd className="m-0 text-[14px] tabular-nums">{t("adm.floor.copy.made", { made: kgWithUnit(fmt, data.producedG) })}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[12px] font-medium text-muted-foreground">{t("adm.floor.copy.inspection")}</dt>
          <dd className="m-0">
            <Chip tone={failed ? "red" : data.inspection === "pass" ? "green" : "neutral"} truncate={false}>
              {t(`adm.inspection.${data.inspection ?? "none"}`)}
            </Chip>
          </dd>
        </div>
        {data.seesCost ? (
          <>
            <div className="min-w-0">
              <dt className="text-[12px] font-medium text-muted-foreground">{t("adm.floor.copy.cost")}</dt>
              <dd className="m-0 font-mono text-[14px] tabular-nums" data-testid="toolroom-cost">
                {data.costPaise == null ? t("adm.floor.copy.noCost") : fmt.q("order.amount", data.costPaise)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[12px] font-medium text-muted-foreground">{t("adm.floor.copy.costPerKg")}</dt>
              <dd className="m-0 font-mono text-[14px] tabular-nums" data-testid="toolroom-cost-kg">
                {data.costPerKgPaise == null ? t("adm.floor.copy.noRun") : fmt.q("order.rate", data.costPerKgPaise)}
              </dd>
            </div>
          </>
        ) : null}
      </dl>
      {failed ? (
        <p role="alert" data-testid="toolroom-failed" className="m-0 rounded-card border border-border bg-tone-red-tint px-4 py-3 text-[15px] leading-6 font-semibold text-tone-red-ink">
          {t("adm.floor.copy.failedBlock")}
        </p>
      ) : null}
      {recordAction || costAction ? (
        <div className="flex flex-wrap gap-2">
          {recordAction}
          {costAction}
        </div>
      ) : null}
    </Card>
  );
}

/** The die card's Tool room block: reads `toolRoom.copy` and offers Record inspection and (managers) Edit cost. */
export function ToolRoomBlock({ copyId, code }: { copyId: string; code: string }) {
  const { t } = useT();
  const [recording, setRecording] = useState(false);
  const [costing, setCosting] = useState(false);
  const query = useQuery({ ...trpc.toolRoom.copy.queryOptions({ dieInstanceId: copyId }), meta: INLINE_ERROR_META });
  if (!query.data) {
    return query.isError ? (
      <p role="alert" className="m-0 text-[14px] text-destructive">
        {t("errors.generic")}
      </p>
    ) : null;
  }
  const data = query.data;
  return (
    <>
      <ToolRoomView
        data={data}
        recordAction={
          <Can do={["die.card", "die.maker", "masters.publish"]}>
            <Button variant="secondary" onClick={() => setRecording(true)} data-testid="toolroom-record">
              {t("adm.floor.copy.record")}
            </Button>
          </Can>
        }
        costAction={
          data.seesCost ? (
            <Can do="masters.publish">
              <Button variant="secondary" onClick={() => setCosting(true)} data-testid="toolroom-edit-cost">
                {t("adm.floor.copy.editCost")}
              </Button>
            </Can>
          ) : null
        }
      />
      <Can do={["die.card", "die.maker", "masters.publish"]}>
        {recording ? <InspectionSheet open onOpenChange={setRecording} copyId={copyId} code={code} /> : null}
      </Can>
      <Can do="masters.publish">
        {costing ? <CostSheet open onOpenChange={setCosting} copyId={copyId} code={code} costPaise={data.costPaise} /> : null}
      </Can>
    </>
  );
}

function useAfterToolRoomWrite() {
  const queryClient = useQueryClient();
  const refresh = useRefreshDieRoom();
  return async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: trpc.toolRoom.pathKey() }), refresh()]);
  };
}

function InspectionSheet({ open, onOpenChange, copyId, code }: { open: boolean; onOpenChange(open: boolean): void; copyId: string; code: string }) {
  const { t } = useT();
  const refusal = useRefusal();
  const after = useAfterToolRoomWrite();
  const [result, setResult] = useState<InspectionResult>("pass");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const record = useMutation({
    ...trpc.toolRoom.inspections.record.mutationOptions(),
    onSuccess: async () => {
      await after();
      toast.success(t("adm.floor.copy.recorded"));
      setNotes("");
      setResult("pass");
      setError(null);
      onOpenChange(false);
    },
    onError: (e) => setError(refusal(e)),
  });
  const submit = () => {
    const read = inspectionInput(result, notes);
    if (!read.ok) return setError(t("adm.floor.copy.notesNeeded"));
    setError(null);
    record.mutate({ subjectType: "die_copy", subjectId: copyId, ...read.input });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("adm.floor.copy.recordTitle", { code })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={record.isPending} data-testid="toolroom-record-save">
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t("adm.floor.copy.result")}>
          <NativeSelect value={result} onChange={(e) => setResult(e.target.value as InspectionResult)} data-testid="toolroom-result">
            <option value="pass">{t("adm.inspection.pass")}</option>
            <option value="fail">{t("adm.inspection.fail")}</option>
          </NativeSelect>
        </Field>
        <Field label={t("adm.floor.copy.notes")} hint={result === "fail" ? t("adm.floor.copy.notesHint") : t("common.optional")} error={error === t("adm.floor.copy.notesNeeded") ? error : undefined}>
          <TextInput value={notes} onChangeText={setNotes} maxLength={500} autoComplete="off" />
        </Field>
        {error && error !== t("adm.floor.copy.notesNeeded") ? (
          <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

function CostSheet({ open, onOpenChange, copyId, code, costPaise }: { open: boolean; onOpenChange(open: boolean): void; copyId: string; code: string; costPaise: number | null }) {
  const { t } = useT();
  const fmt = useFmt();
  const refusal = useRefusal();
  const after = useAfterToolRoomWrite();
  const [text, setText] = useState(() => unitEntryText(fmt, "order.amount", costPaise));
  const [error, setError] = useState<string | null>(null);
  const set = useMutation({
    ...trpc.toolRoom.cost.set.mutationOptions(),
    onSuccess: async () => {
      await after();
      toast.success(t("adm.floor.copy.costSaved"));
      setError(null);
      onOpenChange(false);
    },
    onError: (e) => setError(refusal(e)),
  });
  const submit = () => {
    const read = readUnitEntry(fmt, "order.amount", text);
    if (read.state === "refused") return setError(unitProblemText(t, fmt, "order.amount", read.problem));
    setError(null);
    set.mutate({ dieInstanceId: copyId, costPaise: read.state === "ok" ? read.value : null });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("adm.floor.copy.costTitle", { code })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={set.isPending} data-testid="toolroom-cost-save">
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t("adm.floor.copy.costField")} hint={t("adm.floor.copy.costHint")} error={error ?? undefined}>
          <TextInput value={text} onChangeText={setText} inputMode="decimal" autoComplete="off" />
        </Field>
      </form>
    </Sheet>
  );
}
