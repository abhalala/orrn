/** A credit note against an issued invoice: goods returned or a rate difference, as weight lines or plain amounts. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { Select } from "@orrn/ui/components/select";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import { creditLinesFromBoxes, type CreditBox } from "./model";
import { errorText } from "./ui";

const BLANK: CreditBox = { kind: "weight", description: "", kgText: "", rateText: "", amountText: "", hsnId: "" };
type Reason = "return" | "rate_difference" | "other";

export function CreditNoteSheet({ invoiceId, open, onOpenChange }: { invoiceId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [reason, setReason] = useState<Reason>("return");
  const [note, setNote] = useState("");
  const [boxes, setBoxes] = useState<CreditBox[]>([BLANK]);
  const [tried, setTried] = useState(false);
  const hsn = useQuery({ ...trpc.billing.hsn.list.queryOptions(), enabled: open });
  const hsnOptions = (hsn.data ?? []).filter((h) => h.active).map((h) => ({ value: h.id, label: `${h.code} ${h.description}` }));

  useEffect(() => {
    if (open) {
      setReason("return");
      setNote("");
      setBoxes([BLANK]);
      setTried(false);
    }
  }, [open]);

  const make = useMutation({
    ...trpc.billing.invoices.createCreditDraft.mutationOptions(),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: trpc.billing.invoices.list.queryKey() });
      await qc.invalidateQueries({ queryKey: trpc.billing.invoices.get.queryKey({ id: invoiceId }) });
      toast.success(t("bill.credit.saved"));
      onOpenChange(false);
      await navigate({ to: "/billing/$id", params: { id: r.id } });
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });

  const parsed = creditLinesFromBoxes(boxes);
  const set = (i: number, patch: Partial<CreditBox>) => setBoxes((p) => p.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const canSave = parsed.lines.length > 0 && parsed.bad.length === 0;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("bill.credit.title")}
      description={t("bill.credit.hint")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={make.isPending}
            onClick={() => {
              setTried(true);
              if (!canSave) return;
              make.mutate({ againstInvoiceId: invoiceId, reason, note: note.trim(), lines: parsed.lines });
            }}
          >
            {t("bill.credit.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("bill.credit.reason")}>
          <Select
            value={reason}
            onValueChange={(v) => setReason(v as Reason)}
            options={(["return", "rate_difference", "other"] as const).map((r) => ({ value: r, label: t(`bill.credit.reasons.${r}`) }))}
            placeholder={t("bill.credit.reason")}
          />
        </Field>
        <Field label={t("bill.credit.note")}>
          <TextInput value={note} onChangeText={setNote} maxLength={300} />
        </Field>
        {boxes.map((b, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-2 rounded-card border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <SegmentedControl
                label={t("bill.credit.lineKind")}
                value={b.kind}
                onChange={(k) => set(i, { kind: k })}
                options={[
                  { value: "weight" as const, label: t("bill.credit.byWeight") },
                  { value: "amount" as const, label: t("bill.credit.byAmount") },
                ]}
              />
              {boxes.length > 1 ? (
                <Button variant="ghost" aria-label={t("common.remove")} onClick={() => setBoxes((p) => p.filter((_, j) => j !== i))}>
                  <X aria-hidden="true" strokeWidth={2} />
                </Button>
              ) : null}
            </div>
            <Field label={t("bill.credit.description")} error={tried && parsed.bad.includes(i) ? t("bill.credit.lineBad") : undefined}>
              <TextInput value={b.description} onChangeText={(v) => set(i, { description: v })} maxLength={160} />
            </Field>
            {b.kind === "weight" ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("bill.credit.kg")}>
                  <NumberInput value={b.kgText} onValueChange={(v) => set(i, { kgText: v })} suffix="kg" />
                </Field>
                <Field label={t("bill.credit.rate")}>
                  <NumberInput value={b.rateText} onValueChange={(v) => set(i, { rateText: v })} suffix={t("bill.new.perKg")} />
                </Field>
              </div>
            ) : (
              <Field label={t("bill.credit.amount")}>
                <NumberInput value={b.amountText} onValueChange={(v) => set(i, { amountText: v })} />
              </Field>
            )}
            <Field label={t("bill.new.chargeHsn")}>
              <Select
                value={b.hsnId || "default"}
                onValueChange={(v) => set(i, { hsnId: v === "default" ? "" : v })}
                options={[{ value: "default", label: t("bill.new.hsnDefault") }, ...hsnOptions]}
                placeholder={t("bill.new.hsnDefault")}
              />
            </Field>
          </div>
        ))}
        {boxes.length < 20 ? (
          <div>
            <Button variant="secondary" onClick={() => setBoxes((p) => [...p, BLANK])}>
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("bill.credit.addLine")}
            </Button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
