import { useT } from "@orrn/i18n";
import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/press/textarea";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { shortDate } from "./die-room-model";
import type { CardData } from "./types";
import { useRefreshDieRoom, useRefusal } from "./use-die-room";
import { canLogWork, todayYmd, workInput, workKindLabel, type WorkDraft } from "./work-model";

/**
 * FP-DR-18: the copy's work log (polish, correction, inspection, cleaning, other), newest first,
 * and "Log work" for the die room. A correction may send the copy back on trial. No stock moves.
 */
export function WorkPanel({ card }: { card: CardData }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const status = card.instance.status;

  return (
    <div className="flex flex-col gap-4" data-testid="work-panel">
      <Can do="die.card">
        <div className="flex flex-wrap items-center gap-2">
          {canLogWork(status) ? (
            <Button onClick={() => setOpen(true)} data-testid="work-add">
              {t("dieRoom.work.add")}
            </Button>
          ) : (
            <p className="m-0 text-[14px] text-muted-foreground">{t("dieRoom.work.offRack")}</p>
          )}
        </div>
      </Can>
      {card.work.length === 0 ? (
        <EmptyState title={t("dieRoom.work.empty")} body={t("dieRoom.work.emptyBody")} />
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0" data-testid="work-timeline">
          {card.work.map((row) => (
            <li key={row.id} data-testid="work-row">
              <Card>
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                  <CardTitle>{workKindLabel(t, row.kindCode, row.label)}</CardTitle>
                  <span className="text-[14px] text-muted-foreground tabular-nums">{shortDate(row.workedAt)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {row.hardness != null ? (
                    <span className="font-mono text-[14px] tabular-nums">{t("dieRoom.work.hardness", { hv: row.hardness })}</span>
                  ) : null}
                  {row.setOnTrial ? <Badge tone="warning">{t("dieRoom.work.sentOnTrial")}</Badge> : null}
                  {row.actorName ? <span className="text-[13px] text-muted-foreground">{t("dieRoom.work.by", { name: row.actorName })}</span> : null}
                </div>
                {row.note ? <p className="m-0 text-[14px] leading-6 break-words">{row.note}</p> : null}
              </Card>
            </li>
          ))}
        </ol>
      )}
      <Can do="die.card">
        <WorkSheet open={open} onOpenChange={setOpen} card={card} />
      </Can>
    </div>
  );
}

const ERROR_KEYS = {
  kind: "dieRoom.work.kind",
  note: "dieRoom.work.noteRequired",
  hv: "dieRoom.work.hvInvalid",
  day: "dieRoom.work.dayInvalid",
} as const;

function WorkSheet({ open, onOpenChange, card }: { open: boolean; onOpenChange(open: boolean): void; card: CardData }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const kinds = useQuery({ ...trpc.dieInstance.work.kinds.queryOptions(), enabled: open });
  const today = todayYmd();
  const empty: WorkDraft = { kindId: "", code: "", requiresNote: false, day: today, hv: "", note: "", backOnTrial: false };
  const [draft, setDraft] = useState<WorkDraft>(empty);
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    ...trpc.dieInstance.work.add.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t("dieRoom.work.saved", { code: card.instance.code }));
      setDraft(empty);
      setError(null);
      onOpenChange(false);
    },
    onError: (e) => setError(refusal(e)),
  });

  const pick = (id: string) => {
    const k = kinds.data?.find((x) => x.id === id);
    setDraft((d) => ({ ...d, kindId: id, code: k?.code ?? "", requiresNote: k?.requiresNote ?? false, backOnTrial: k?.code === "correct" ? d.backOnTrial : false }));
  };

  const submit = () => {
    const res = workInput(draft, card.instance.id, today);
    if (!res.ok) {
      setError(t(ERROR_KEYS[res.error]));
      return;
    }
    setError(null);
    add.mutate(res.input);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("dieRoom.work.title", { code: card.instance.code })}
      description={t("dieRoom.work.body")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={add.isPending} data-testid="work-save">
            {t("dieRoom.work.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("dieRoom.work.kind")} id="work-kind">
          <NativeSelect id="work-kind" value={draft.kindId} onChange={(e) => pick(e.currentTarget.value)} data-testid="work-kind">
            <option value="" disabled>
              {t("dieRoom.work.kind")}
            </option>
            {(kinds.data ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                {workKindLabel(t, k.code, k.label)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("dieRoom.work.day")} id="work-day">
          <TextInput id="work-day" type="date" max={today} value={draft.day} onChange={(e) => setDraft((d) => ({ ...d, day: e.currentTarget.value }))} />
        </Field>
        <Field label={t("dieRoom.work.hv")} hint={t("common.optional")}>
          <NumberInput value={draft.hv} onValueChange={(v) => setDraft((d) => ({ ...d, hv: v }))} decimal={false} />
        </Field>
        <Field label={t("dieRoom.work.note")} hint={draft.requiresNote || draft.code === "other" ? undefined : t("common.optional")}>
          <FieldTextArea value={draft.note} maxLength={500} onChange={(e) => setDraft((d) => ({ ...d, note: e.currentTarget.value }))} data-testid="work-note" />
        </Field>
        {draft.code === "correct" ? (
          <div className="flex items-start gap-3">
            <Checkbox
              id="work-trial"
              checked={draft.backOnTrial}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, backOnTrial: v === true }))}
              className="mt-0.5"
              disabled={card.instance.status !== "available"}
            />
            <div className="flex min-w-0 flex-col">
              <label htmlFor="work-trial" className="text-[15px] leading-5 font-semibold">
                {t("dieRoom.work.backOnTrial")}
              </label>
              <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("dieRoom.work.backOnTrialHint")}</p>
            </div>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
