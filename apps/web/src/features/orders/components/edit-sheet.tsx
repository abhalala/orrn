import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { orderErrorLines } from "../errors";

/** Edit the PO number, expected date and note of an order (`orders.update`; an edit never moves the status). */
export function EditSheet({
  open,
  onOpenChange,
  order,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  order: { id: string; serverSeq: number; poNumber: string | null; expectedDate?: string | null; note: string | null };
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [po, setPo] = useState("");
  const [note, setNote] = useState("");
  const [expected, setExpected] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setPo(order.poNumber ?? "");
      setNote(order.note ?? "");
      setExpected(order.expectedDate ?? "");
      setErrors([]);
    }
  }, [open, order.poNumber, order.note, order.expectedDate]);

  const save = useMutation({
    mutationFn: () =>
      trpcClient.orders.update.mutate({
        id: order.id,
        serverSeq: order.serverSeq,
        poNumber: po.trim() || null,
        expectedDate: expected || null,
        note: note.trim() || null,
      }),
    onSuccess: async () => {
      toast.success(t("orders.edit.saved"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.orders.get.queryKey({ id: order.id }) }),
        queryClient.invalidateQueries({ queryKey: trpc.orders.list.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.orders.timeline.queryKey() }),
      ]);
      onOpenChange(false);
    },
    onError: (error) => setErrors(orderErrorLines(t, error)),
  });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("orders.edit.title")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => {
              setErrors([]);
              save.mutate();
            }}
            disabled={save.isPending}
          >
            {save.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("orders.poNumber")}>
          <TextInput value={po} onChangeText={setPo} autoComplete="off" />
        </Field>
        <Field label={t("orders.expectedDate")}>
          <TextInput type="date" value={expected} onChangeText={setExpected} />
        </Field>
        <Field label={t("common.note")}>
          <FieldTextArea value={note} onChangeText={setNote} rows={3} />
        </Field>
        {errors.length > 0 ? (
          <div role="alert" className="flex flex-col gap-1">
            {errors.map((e) => (
              <p key={e} className="m-0 text-[14px] font-medium leading-5 text-destructive">
                {e}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
