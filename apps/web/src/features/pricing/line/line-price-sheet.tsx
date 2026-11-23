import type { PriceBreakup } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { MasterSheet } from "@/features/masters/masters-ui";
import { ratePaiseOf } from "@/features/orders/line-model";
import { serverRefusal } from "@/features/shared/server-refusal";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { dayText, rateText, rupeeScreen } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { askedRate, breakupRows, type BreakupNote, type BreakupRow } from "./breakup-rows";

export type PriceLine = { lineId: string; lineNo: number; orderNumber: string };

/**
 * The price sheet of one order line: base metal (list and date), conversion and where it came from, alloy
 * surcharge, finish, add-ons per kg, discount, a fixed rate, the rate from the master, a rate changed by hand
 * with its reason, and the rate on the line. People with `price.manage` can ask for another rate.
 */
export function LinePriceSheet({ line, breakup }: { line: PriceLine; breakup: PriceBreakup }) {
  const { t } = useT();
  const fmt = useFmt();
  const [open, setOpen] = useState(false);
  const rows = breakupRows(breakup);
  const perKg = (paise: number) => t("price.line.perKg", { rate: rateText(fmt, paise) });
  const noteText = (note: BreakupNote | null): string | null => {
    if (!note) return null;
    switch (note.type) {
      case "metal": {
        const list = t("price.line.notes.metalList", { source: t(`price.master.names.metal.${note.source}`), date: dayText(fmt, note.rateDate) });
        if (!note.lme) return list;
        const lme = t("price.line.notes.lme", {
          usd: rupeeScreen(fmt, note.lme.usdPerTonneCents),
          inr: rupeeScreen(fmt, note.lme.inrPerUsdPaise),
          premium: rupeeScreen(fmt, note.lme.premiumPaisePerKg),
        });
        return `${list}. ${lme}`;
      }
      case "conversion":
        return t(`price.line.notes.conversionFrom.${note.from}`);
      case "name":
        return note.name;
      case "addons":
        return note.labels.join(", ");
      case "reason":
        return note.reason;
      case "approved":
        return t("price.line.notes.approved");
    }
  };
  const sign = (row: BreakupRow) => (row.sign === "minus" ? "-" : row.sign === "plus" ? "+" : "");

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="line-price" data-price-line={line.lineNo}>
      <details className="rounded-card border border-border bg-surface-sunken px-4 py-2">
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2 text-[14px] font-semibold">
          <span>{t("price.line.summary")}</span>
          <span className="font-mono tabular-nums">{perKg(breakup.finalPaisePerKg)}</span>
        </summary>
        <dl className="m-0 flex flex-col divide-y divide-border pb-1">
          {rows.map((row) => {
            const note = noteText(row.note);
            return (
              <div key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2" data-price-row={row.id}>
                <dt className={row.total ? "text-[14px] font-semibold" : "text-[14px]"}>
                  {t(`price.line.rows.${row.id}`)}
                  {note ? <span className="block text-[12px] font-normal leading-5 break-words text-muted-foreground">{note}</span> : null}
                </dt>
                <dd className={`m-0 font-mono text-[14px] tabular-nums ${row.total ? "font-semibold" : ""}`}>
                  {sign(row)}
                  {perKg(row.paise)}
                </dd>
              </div>
            );
          })}
        </dl>
        <Can do="price.manage">
          <Button variant="ghost" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={t("price.line.changeLabel", { n: line.lineNo })} data-testid={`price-change-${line.lineNo}`}>
            {t("price.line.change")}
          </Button>
        </Can>
      </details>
      <ChangeRateSheet open={open} onOpenChange={setOpen} line={line} breakup={breakup} />
    </div>
  );
}

function ChangeRateSheet({ open, onOpenChange, line, breakup }: { open: boolean; onOpenChange(open: boolean): void; line: PriceLine; breakup: PriceBreakup }) {
  const { t } = useT();
  const fmt = useFmt();
  const queryClient = useQueryClient();
  const formId = `line-rate-form-${useId().replace(/:/g, "")}`;
  const [rate, setRate] = useState("");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);

  const request = useMutation(
    trpc.pricing.lines.requestOverride.mutationOptions({
      onSuccess: async (res) => {
        toast.success(res.status === "pending" ? t("price.line.sentApproval") : t("price.line.savedNow"));
        await Promise.all([
          queryClient.invalidateQueries(trpc.orders.pathFilter()),
          queryClient.invalidateQueries(trpc.pricing.pathFilter()),
          queryClient.invalidateQueries(trpc.approval.pathFilter()),
        ]);
        onOpenChange(false);
      },
    }),
  );

  useEffect(() => {
    if (!open) return;
    setRate("");
    setReason("");
    setTried(false);
    request.reset();
    // Only when the sheet opens; the mutation object is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const paise = ratePaiseOf(rate);
  const asked = paise === null ? null : askedRate(breakup, paise);
  const reasonOk = reason.trim().length >= 3;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (request.isPending) return;
    setTried(true);
    if (paise === null || !reasonOk) return;
    request.mutate({ lineId: line.lineId, ratePaise: paise, reason: reason.trim() });
  };

  return (
    <MasterSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("price.line.changeTitle", { n: line.lineNo })}
      description={t("price.line.changeIntro", { order: line.orderNumber, computed: rateText(fmt, breakup.computedPaisePerKg) })}
      formId={formId}
      onSubmit={submit}
      busy={request.isPending}
      error={undefined}
      saveLabel={asked?.needsApproval ? t("price.line.submitApproval") : t("price.line.save")}
      editors="price.manage"
    >
      <Field label={t("price.line.asked")} error={tried && paise === null ? t("price.line.errors.rate") : undefined}>
        <TextInput value={rate} inputMode="decimal" autoComplete="off" aria-required="true" onChangeText={setRate} />
      </Field>
      {asked ? (
        <p
          role="status"
          data-testid="line-rate-hint"
          className={`m-0 rounded-input px-3 py-2 text-[14px] leading-6 ${asked.needsApproval ? "bg-tone-amber-tint text-tone-amber-ink" : "bg-surface-sunken"}`}
        >
          {asked.sameAsNow
            ? t("price.line.same")
            : asked.needsApproval
              ? t("price.line.waits", { now: rateText(fmt, breakup.finalPaisePerKg) })
              : t("price.line.applies")}
        </p>
      ) : null}
      <Field label={t("price.line.reason")} hint={t("price.line.reasonHint")} error={tried && !reasonOk ? t("price.line.errors.reason") : undefined} required>
        <TextInput value={reason} maxLength={300} autoComplete="off" onChangeText={setReason} />
      </Field>
      {request.error ? (
        <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
          {serverRefusal(t, request.error)}
        </p>
      ) : null}
    </MasterSheet>
  );
}
