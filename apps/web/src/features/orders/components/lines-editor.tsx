import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { FormActions } from "@orrn/ui/components/form-actions";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useLengthUnit } from "@/shared/lib/length";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { orderErrorLines } from "../errors";
import { useFloor, useShowRates } from "../hooks";
import { draftFromLine, lineProblems, newLine, toLineEditInput, type LineDraft, type LineProblems, type StoredLine, type StoredLineDetail } from "../line-model";
import { LineEditor } from "./line-editor";

let editSeq = 0;
const editKey = () => `edit-${(editSeq += 1)}`;

/**
 * Edit the lines of a booking or a confirmed order (FP-OP-02, review I-1): add, remove and change
 * lines and save the whole set with `orders.update` (existing lines by id). The quote of a saved
 * line is on the basis it was locked with (`orders.quote` `lineId`), as the save keeps it. The
 * server refuses a change to a line on a released press plan and a kg below what is dispatched;
 * those refusals come back as sentences.
 */
export function LinesEditor({
  order,
  lines,
  details,
  onDone,
}: {
  order: { id: string; serverSeq: number; customerId: string };
  lines: readonly StoredLine[];
  details: readonly (StoredLineDetail & { lineId: string })[];
  onDone(): void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const { unit } = useLengthUnit();
  const floor = useFloor();
  const showRates = useShowRates();
  const [drafts, setDrafts] = useState<LineDraft[]>(() => {
    const byId = new Map(details.map((d) => [d.lineId, d]));
    return lines.map((l) => {
      const d = byId.get(l.lineId);
      return draftFromLine(editKey(), l, d ?? { dieInstanceId: null, tierRank: null, qtyBasis: null, weightBasis: null, alloy: null, temper: null }, unit, showRates);
    });
  });
  const [tried, setTried] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const problems: Record<string, LineProblems> = {};
  for (const l of drafts) problems[l.key] = lineProblems(l, unit);
  const complete = drafts.length > 0 && drafts.every((l) => Object.keys(problems[l.key]!).length === 0);

  const save = useMutation({
    mutationFn: () =>
      trpcClient.orders.update.mutate({
        id: order.id,
        serverSeq: order.serverSeq,
        lines: drafts.map((d) => toLineEditInput(d, unit, showRates)),
      }),
    onSuccess: async () => {
      toast.success(t("orders.edit.linesSaved"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.orders.get.queryKey({ id: order.id }) }),
        queryClient.invalidateQueries({ queryKey: trpc.orders.list.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.orders.timeline.queryKey() }),
      ]);
      onDone();
    },
    onError: (error) => setErrors(orderErrorLines(t, error)),
  });

  function patch(key: string, p: Partial<LineDraft>) {
    setDrafts((cur) => cur.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={t("orders.edit.linesTitle")} data-lines-editor="">
      <h2 className="m-0 text-[15px] font-semibold">{t("orders.edit.linesTitle")}</h2>
      <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("orders.edit.linesHint")}</p>
      {drafts.map((line, i) => (
        <LineEditor
          key={line.key}
          line={line}
          index={i}
          count={drafts.length}
          unit={unit}
          customerId={order.customerId}
          dieBands={floor.dieBands}
          showRates={showRates}
          problems={tried ? problems[line.key] : undefined}
          onChange={(p) => patch(line.key, p)}
          onRemove={() => setDrafts((cur) => cur.filter((l) => l.key !== line.key))}
          stockPrompt={false}
        />
      ))}
      <div>
        <Button variant="secondary" onClick={() => setDrafts((cur) => [...cur, newLine(editKey())])}>
          <Plus aria-hidden="true" strokeWidth={2} />
          {t("orders.form.addLine")}
        </Button>
      </div>
      {errors.length > 0 ? (
        <div role="alert" data-lines-error="" className="flex flex-col gap-1 rounded-card border border-destructive/40 px-3 py-3">
          {errors.map((e) => (
            <p key={e} className="m-0 text-[14px] font-medium leading-5 text-destructive">
              {e}
            </p>
          ))}
        </div>
      ) : null}
      <FormActions>
        <Button variant="secondary" onClick={onDone} disabled={save.isPending}>
          {t("common.cancel")}
        </Button>
        <Button
          onClick={() => {
            setTried(true);
            setErrors([]);
            if (complete) save.mutate();
          }}
          disabled={save.isPending}
        >
          {save.isPending ? t("common.saving") : t("orders.detail.saveLines")}
        </Button>
      </FormActions>
    </section>
  );
}
