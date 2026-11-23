/** Record a payment received: who, how much, how, and which open invoices it settles (the rest stays on account). */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Combobox } from "@orrn/ui/components/combobox";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { Select } from "@orrn/ui/components/select";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { searchCustomers } from "@/features/dispatch/customer-picker";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { autoAllocate, checkAllocation, paiseToBox, rupeesToPaise, type AllocationBox } from "./model";
import { Rupees, errorText, useToday } from "./ui";

const MODES = ["cash", "cheque", "neft", "rtgs", "upi", "card", "other"] as const;
type Mode = (typeof MODES)[number];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Start with this customer and, when given, this invoice's amount due allocated. */
  initial?: { customerId?: string; invoiceId?: string } | null;
};

export function PaymentSheet({ open, onOpenChange, initial }: Props) {
  const { t } = useT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const today = useToday();
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<Mode>("neft");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [boxes, setBoxes] = useState<AllocationBox[]>([]);
  const [tried, setTried] = useState(false);

  const openInv = useQuery({ ...trpc.billing.receivables.openInvoices.queryOptions({ customerId: customer?.id ?? "" }), enabled: open && !!customer });
  const rows = useMemo(() => openInv.data ?? [], [openInv.data]);
  // The customer an invoice link names: read its name from the party card.
  const initialParty = useQuery({ ...trpc.billing.party.get.queryOptions({ customerId: initial?.customerId ?? "" }), enabled: open && !!initial?.customerId });

  useEffect(() => {
    if (!open) return;
    setDate(today);
    setAmount("");
    setMode("neft");
    setReference("");
    setNote("");
    setBoxes([]);
    setTried(false);
    setCustomer(null);
    // today is read once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && initial?.customerId && initialParty.data && !customer) setCustomer({ id: initial.customerId, name: initialParty.data.name });
  }, [open, initial?.customerId, initialParty.data, customer]);

  // Arriving from an invoice: pay that invoice's due in full to start with.
  useEffect(() => {
    if (!open || !initial?.invoiceId || amount || boxes.length > 0) return;
    const inv = rows.find((r) => r.id === initial.invoiceId);
    if (inv) {
      setAmount(paiseToBox(inv.duePaise));
      setBoxes([{ invoiceId: inv.id, text: paiseToBox(inv.duePaise) }]);
    }
  }, [open, initial?.invoiceId, rows, amount, boxes.length]);

  const check = checkAllocation(amount, rows, boxes);
  const boxOf = (id: string) => boxes.find((b) => b.invoiceId === id)?.text ?? "";
  const setBox = (id: string, text: string) =>
    setBoxes((p) => (p.some((b) => b.invoiceId === id) ? p.map((b) => (b.invoiceId === id ? { ...b, text } : b)) : [...p, { invoiceId: id, text }]));

  const save = useMutation({
    ...trpc.billing.payments.record.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.billing.pathKey() });
      toast.success(t("bill.payments.saved"));
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });

  function submit() {
    setTried(true);
    const amountPaise = check.allocatedPaise + check.onAccountPaise;
    if (!customer || !check.ok || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    save.mutate({ customerId: customer.id, receivedOn: date, amountPaise, mode, reference: reference.trim() || null, note: note.trim() || null, allocations: check.allocations });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("bill.payments.record")}
      description={t("bill.payments.recordHint")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {t("bill.payments.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("bill.payments.customer")} error={tried && !customer ? t("bill.payments.pickCustomer") : undefined}>
          <Combobox<string>
            value={customer?.id ?? null}
            valueLabel={customer?.name || undefined}
            onChange={(id) => {
              setCustomer({ id, name: "" });
              setBoxes([]);
            }}
            search={async (q) => {
              const found = await searchCustomers(q);
              return found;
            }}
            placeholder={t("bill.payments.customerSearch")}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("bill.payments.date")}>
            <TextInput type="date" value={date} onChangeText={setDate} />
          </Field>
          <Field label={t("bill.payments.amount")} error={tried && check.problems.total === "amount" ? t("bill.payments.amountBad") : undefined}>
            <NumberInput value={amount} onValueChange={setAmount} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("bill.payments.mode")}>
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)} options={MODES.map((m) => ({ value: m, label: t(`bill.payments.modes.${m}`) }))} placeholder={t("bill.payments.mode")} />
          </Field>
          <Field label={t("bill.payments.reference")}>
            <TextInput value={reference} onChangeText={setReference} maxLength={60} />
          </Field>
        </div>
        <Field label={t("bill.payments.note")}>
          <TextInput value={note} onChangeText={setNote} maxLength={300} />
        </Field>

        {customer ? (
          <section aria-labelledby="bill-alloc" className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 id="bill-alloc" className="m-0 text-[14px] font-semibold">
                {t("bill.payments.allocate")}
              </h3>
              <Button
                variant="secondary"
                disabled={rows.length === 0}
                onClick={() => {
                  setBoxes(autoAllocate(rupeesToPaise(amount) ?? 0, rows).boxes);
                }}
              >
                {t("bill.payments.oldestFirst")}
              </Button>
            </div>
            {openInv.isPending ? <p className="m-0 text-[13px] text-muted-foreground">{t("common.loading")}</p> : null}
            {rows.length === 0 && !openInv.isPending ? <p className="m-0 text-[13px] text-muted-foreground">{t("bill.payments.noOpen")}</p> : null}
            {rows.map((r) => (
              <div key={r.id} className="grid min-w-0 grid-cols-[1fr_8rem] items-end gap-3 rounded-card border border-border p-2.5">
                <div className="min-w-0">
                  <p className="m-0 font-mono text-[14px] font-semibold">{r.number}</p>
                  <p className="m-0 text-[12px] text-muted-foreground">
                    {bookDateText(fmt, r.invoiceDate)} · {t("bill.payments.due")} <Rupees paise={r.duePaise} />
                  </p>
                </div>
                <Field label={t("bill.payments.pays")} error={check.problems[r.id] ? t(`bill.payments.problems.${check.problems[r.id]!}`) : undefined}>
                  <NumberInput value={boxOf(r.id)} onValueChange={(v) => setBox(r.id, v)} />
                </Field>
              </div>
            ))}
            <p className="m-0 text-[13px]" aria-live="polite">
              {t("bill.payments.allocated")} <Rupees paise={check.allocatedPaise} /> · {t("bill.payments.onAccount")} <Rupees paise={check.onAccountPaise} />
            </p>
            {tried && check.problems.total === "over_amount" ? <p role="alert" className="m-0 text-[13px] text-destructive">{t("bill.payments.problems.over_amount")}</p> : null}
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
