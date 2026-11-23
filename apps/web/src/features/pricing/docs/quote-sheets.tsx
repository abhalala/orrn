import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { serverRefusalLines } from "@/features/shared/server-refusal";
import { trpcClient } from "@/shared/utils/trpc";

import { FormErrors } from "./form-errors";
import { useInvalidateDocs } from "./use-docs";

/** Cancel a draft or sent quote, with the reason the plant gives. */
export function CancelQuoteSheet({ open, onOpenChange, quoteId, number }: { open: boolean; onOpenChange(open: boolean): void; quoteId: string; number: string }) {
  const { t } = useT();
  const invalidate = useInvalidateDocs();
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setReason("");
      setErrors([]);
    }
  }, [open]);
  const cancel = useMutation({
    mutationFn: () => trpcClient.pricing.quotes.setStatus.mutate({ id: quoteId, status: "cancelled", reason: reason.trim() || null }),
    onSuccess: async () => {
      toast.success(t("price.quotes.detail.cancelled", { number }));
      await Promise.all([invalidate.quotes(), invalidate.today()]);
      onOpenChange(false);
    },
    onError: (e) => setErrors(serverRefusalLines(t, e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!cancel.isPending) cancel.mutate();
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("price.quotes.detail.cancelTitle", { number })}
      description={t("price.quotes.detail.cancelHint")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            {t("price.quotes.detail.keep")}
          </Button>
          <Button type="submit" form="cancel-quote-form" size="lg" loading={cancel.isPending}>
            {t("price.quotes.detail.cancelQuote")}
          </Button>
        </>
      }
    >
      <form id="cancel-quote-form" noValidate onSubmit={submit} className="flex flex-col gap-5 pt-1">
        <Field label={t("price.quotes.detail.reason")}>
          <TextInput value={reason} onChangeText={setReason} maxLength={300} autoComplete="off" />
        </Field>
        <FormErrors lines={errors} />
      </form>
    </Sheet>
  );
}

/** Convert a quote to a booking sales order, with the buyer's PO number when there is one. */
export function ConvertQuoteSheet({ open, onOpenChange, quoteId, number }: { open: boolean; onOpenChange(open: boolean): void; quoteId: string; number: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const invalidate = useInvalidateDocs();
  const [po, setPo] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setPo("");
      setErrors([]);
    }
  }, [open]);
  const convert = useMutation({
    mutationFn: () => trpcClient.pricing.quotes.convert.mutate({ id: quoteId, poNumber: po.trim() || null }),
    onSuccess: async (res) => {
      toast.success(t("price.quotes.detail.converted", { number: res.number }));
      await Promise.all([invalidate.quotes(), invalidate.enquiries(), invalidate.orders(), invalidate.today()]);
      onOpenChange(false);
      void navigate({ to: "/orders/$id", params: { id: res.orderId } });
    },
    onError: (e) => setErrors(serverRefusalLines(t, e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!convert.isPending) convert.mutate();
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("price.quotes.detail.convertTitle", { number })}
      description={t("price.quotes.detail.convertHint")}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="convert-quote-form" size="lg" loading={convert.isPending}>
            {t("price.quotes.detail.convert")}
          </Button>
        </>
      }
    >
      <form id="convert-quote-form" noValidate onSubmit={submit} className="flex flex-col gap-5 pt-1">
        <Field label={t("orders.poNumber")} hint={t("orders.form.poHint")}>
          <TextInput value={po} onChangeText={setPo} maxLength={100} autoComplete="off" />
        </Field>
        <FormErrors lines={errors} />
      </form>
    </Sheet>
  );
}
