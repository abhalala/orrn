import { lineAmountPaise, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { FieldSelect } from "@/features/orders/components/controls";
import { CustomerField, DieField } from "@/features/orders/components/pickers";
import { todayYmd } from "@/features/orders/die-blocks";
import { useCompanyTimeZone, useDebounced } from "@/features/orders/hooks";
import { cutLengthMm, parseKgG, type Finish } from "@/features/orders/line-model";
import { serverRefusalLines } from "@/features/shared/server-refusal";
import { FeetInchesGroup } from "@/shared/components/feet-inches-group";
import { PlantInput } from "@/shared/components/plant-input";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3, massUnit, rateText, rupeeText } from "@/shared/lib/fmt-text";
import { useLengthUnit } from "@/shared/lib/length";
import { LENGTH_MM, MASS_KG } from "@/shared/lib/plant-input";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { BreakupView } from "./breakup-view";
import {
  defaultValidUntil,
  lineComplete,
  lineProblems,
  lineRatePaise,
  newQuoteLine,
  pricesByDraft,
  previewRequest,
  quoteTotals,
  toQuoteLineInput,
  validityProblem,
  type LinePrice,
  type Picked,
  type QuoteLineDraft,
} from "./quote-model";
import { useComponentOptions, useInvalidateDocs, type ComponentOption } from "./use-docs";

let seq = 0;
export const nextLineKey = () => `ql-${(seq += 1)}`;

export type QuoteFormInitial = {
  quote?: { id: string; serverSeq: number; quoteDate: string; validUntil: string };
  customer: Picked | null;
  note: string;
  lines: QuoteLineDraft[];
  enquiryId?: string | null;
};

/**
 * The quote form (new and edit of a draft). Lines are priced live by `pricing.preview` on the quote date
 * (the answer is shown only for exactly what is typed now); the save sends the whole quote and the server prices it
 * again. A typed rate is kept only when it is above the master's rate.
 */
export function QuoteForm({ initial }: { initial: QuoteFormInitial }) {
  const { t } = useT();
  const fmt = useFmt();
  const navigate = useNavigate();
  const { unit } = useLengthUnit();
  const zone = useCompanyTimeZone();
  const invalidate = useInvalidateDocs();
  const settings = useQuery({ ...trpc.pricing.settings.get.queryOptions(), meta: INLINE_ERROR_META });
  const { options } = useComponentOptions();

  const editing = initial.quote != null;
  const quoteDate = initial.quote?.quoteDate ?? todayYmd(zone);
  const [customer, setCustomer] = useState<Picked | null>(initial.customer);
  const [note, setNote] = useState(initial.note);
  // Null = untouched: the date follows the quote date plus the plant's valid days.
  const [validTouched, setValidTouched] = useState<string | null>(editing ? initial.quote!.validUntil : null);
  const [lines, setLines] = useState<QuoteLineDraft[]>(initial.lines.length > 0 ? initial.lines : [newQuoteLine(nextLineKey())]);
  const [tried, setTried] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const validUntil = validTouched ?? defaultValidUntil(quoteDate, settings.data?.quoteValidDays ?? 15);
  const validProblem = validityProblem(quoteDate, validUntil);

  const req = useMemo(() => previewRequest(lines), [lines]);
  const askedLines = useDebounced(req.lines, 400);
  const same = JSON.stringify(askedLines) === JSON.stringify(req.lines);
  const preview = useQuery({
    ...trpc.pricing.preview.queryOptions({ customerId: customer?.id ?? null, onDate: quoteDate, lines: askedLines }),
    enabled: askedLines.length > 0,
    retry: false,
    meta: INLINE_ERROR_META,
  });
  const answers = same ? (preview.data?.lines as LinePrice[] | undefined) : undefined;
  const prices = pricesByDraft(req.slot, answers);
  const pending = req.lines.length > 0 && (!same || preview.isFetching);
  const totals = quoteTotals(lines, prices);

  const problems = lines.map((l, i) => lineProblems(l, unit, prices[i]?.ok ? prices[i]!.breakup.computedPaisePerKg : null));
  const complete = customer != null && lines.length > 0 && lines.every((l) => lineComplete(l, unit)) && problems.every((p) => Object.keys(p).length === 0) && !validProblem && !pending;

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        customerId: customer!.id,
        quoteDate,
        validUntil,
        note: note.trim() || null,
        lines: lines.map((l, i) => toQuoteLineInput(l, unit, prices[i]?.ok ? prices[i]!.breakup.computedPaisePerKg : null)),
      };
      if (initial.quote) return trpcClient.pricing.quotes.update.mutate({ ...body, id: initial.quote.id, serverSeq: initial.quote.serverSeq });
      return trpcClient.pricing.quotes.create.mutate({ ...body, ...(initial.enquiryId ? { enquiryId: initial.enquiryId } : {}) });
    },
    onSuccess: async (res) => {
      toast.success(t("price.quotes.form.saved"));
      await Promise.all([invalidate.quotes(), invalidate.enquiries(), invalidate.today()]);
      void navigate({ to: "/pricing/quotes/$id", params: { id: res.id } });
    },
    onError: (error) => setErrors(serverRefusalLines(t, error)),
  });

  const patch = useCallback((key: string, p: Partial<QuoteLineDraft>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...p } : l))), []);

  return (
    <div className="flex min-w-0 flex-col gap-4" data-quote-form="">
      <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
        <h2 className="m-0 text-[15px] font-semibold">{t("price.quotes.form.party")}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <CustomerField value={customer} onChange={setCustomer} error={tried && !customer ? t("orders.form.errors.customer") : undefined} />
          <Field label={t("price.quotes.form.validUntil")} hint={t("price.quotes.form.validHint", { days: settings.data?.quoteValidDays ?? 15 })} error={tried && validProblem ? t(validProblem) : undefined}>
            <TextInput type="date" value={validUntil} onChangeText={(v) => setValidTouched(v)} />
          </Field>
          <div className="md:col-span-2">
            <Field label={t("common.note")}>
              <FieldTextArea value={note} onChangeText={setNote} rows={2} maxLength={1000} />
            </Field>
          </div>
        </div>
      </section>

      {lines.map((line, i) => (
        <QuoteLineCard
          key={line.key}
          line={line}
          index={i}
          count={lines.length}
          unit={unit}
          options={options}
          price={prices[i]}
          pending={pending}
          problems={tried ? problems[i] : undefined}
          onChange={(p) => patch(line.key, p)}
          onRemove={() => setLines((cur) => cur.filter((l) => l.key !== line.key))}
        />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => setLines((cur) => [...cur, newQuoteLine(nextLineKey())])} data-add-quote-line="">
          <Plus aria-hidden="true" strokeWidth={2} />
          {t("price.quotes.form.addLine")}
        </Button>
        {totals.lines > 0 ? (
          <p data-quote-total="" className="m-0 font-mono text-[15px] font-semibold tabular-nums" aria-live="polite">
            {t("price.quotes.form.total", { massUnit: massUnit(fmt), kg: kgGrouped3(fmt, totals.kgG), amount: rupeeText(fmt, totals.amountPaise) })}
            {pending ? ` ${t("price.quotes.form.pricing")}` : ""}
          </p>
        ) : null}
      </div>
      {preview.data && !preview.data.ready ? (
        <p role="status" className="m-0 text-[14px] leading-5 text-muted-foreground">
          {t("price.quotes.form.masterNotReady")}
        </p>
      ) : null}
      {totals.missing > 0 && !pending ? (
        <p role="status" className="m-0 text-[14px] leading-5 text-destructive">
          {t("price.quotes.form.missingRates", { count: totals.missing })}
        </p>
      ) : null}

      {errors.length > 0 ? (
        <div role="alert" className="flex flex-col gap-1 rounded-card border border-destructive/40 px-3 py-3">
          {errors.map((e) => (
            <p key={e} className="m-0 text-[14px] font-medium leading-5 text-destructive">
              {e}
            </p>
          ))}
        </div>
      ) : null}

      <FormActions>
        <Button
          onClick={() => {
            setTried(true);
            setErrors([]);
            if (complete) save.mutate();
          }}
          disabled={save.isPending}
          data-quote-save=""
        >
          {save.isPending ? t("common.saving") : editing ? t("price.quotes.form.saveChanges") : t("price.quotes.form.save")}
        </Button>
      </FormActions>
    </div>
  );
}

function QuoteLineCard({
  line,
  index,
  count,
  unit,
  options,
  price,
  pending,
  problems,
  onChange,
  onRemove,
}: {
  line: QuoteLineDraft;
  index: number;
  count: number;
  unit: LengthUnit;
  options: ComponentOption[];
  price: LinePrice | undefined;
  pending: boolean;
  problems: ReturnType<typeof lineProblems> | undefined;
  onChange(patch: Partial<QuoteLineDraft>): void;
  onRemove(): void;
}) {
  const { t } = useT();
  const fmt = useFmt();
  const mm = cutLengthMm(line, unit);
  const rate = lineRatePaise(line, price);
  const e = problems ?? {};
  const toggle = (key: string, on: boolean) => onChange({ componentKeys: on ? [...new Set([...line.componentKeys, key])] : line.componentKeys.filter((k) => k !== key) });
  return (
    <Card data-quote-line={index + 1}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("orders.form.lineTitle", { n: index + 1 })}</CardTitle>
        {count > 1 ? (
          <Button variant="ghost" onClick={onRemove} aria-label={t("orders.form.removeLine", { n: index + 1 })}>
            <Trash2 aria-hidden="true" strokeWidth={2} />
            {t("common.remove")}
          </Button>
        ) : null}
      </CardHeader>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <DieField value={line.die} onChange={(die) => onChange({ die })} error={e.die ? t(e.die) : undefined} />
        <Field label={t("orders.line.cutLength")} error={e.length ? t(e.length) : undefined}>
          {unit === "inch" ? (
            <FeetInchesGroup label={t("orders.line.cutLength")}>
              <div className="min-w-[7rem] flex-1">
                <NumberInput value={line.feet} onValueChange={(feet) => onChange({ feet })} suffix={t("units.ft")} decimal={false} aria-label={t("orders.form.feet")} />
              </div>
              <div className="min-w-[7rem] flex-1">
                <NumberInput value={line.inches} onValueChange={(inches) => onChange({ inches })} suffix={t("units.inch")} aria-label={t("orders.form.inches")} />
              </div>
            </FeetInchesGroup>
          ) : (
            <PlantInput spec={LENGTH_MM} value={line.mm} onValueChange={(v) => onChange({ mm: v })} decimal={false} aria-label={t("orders.line.cutLength")} />
          )}
        </Field>
        <Field label={t("orders.line.kg")} error={e.kg ? t(e.kg) : undefined}>
          <PlantInput spec={MASS_KG} value={line.kgText} onValueChange={(kgText) => onChange({ kgText })} aria-label={t("orders.line.kg")} />
        </Field>
        <Field label={t("orders.line.pcs")} hint={t("price.quotes.form.pcsHint")} error={e.pcs ? t(e.pcs) : undefined}>
          <NumberInput value={line.pcsText} onValueChange={(pcsText) => onChange({ pcsText })} suffix={t("units.pcs")} decimal={false} aria-label={t("orders.line.pcs")} />
        </Field>
        <Field label={t("orders.line.alloy")}>
          <TextInput value={line.alloy} onChangeText={(alloy) => onChange({ alloy })} autoComplete="off" maxLength={16} />
        </Field>
        <Field label={t("orders.line.temper")}>
          <TextInput value={line.temper} onChangeText={(temper) => onChange({ temper })} autoComplete="off" maxLength={8} />
        </Field>
        <Field label={t("orders.line.finish")}>
          <FieldSelect value={line.finish} onChange={(ev) => onChange({ finish: ev.target.value as Finish })}>
            <option value="none">{t("orders.finish.none")}</option>
            <option value="anodise">{t("orders.finish.anodise")}</option>
            <option value="pvd">{t("orders.finish.pvd")}</option>
          </FieldSelect>
        </Field>
        <Field label={t("price.quotes.form.rate")} hint={t("price.quotes.form.rateHint")} error={e.rate ? t(e.rate) : undefined}>
          <NumberInput value={line.rate} onValueChange={(r) => onChange({ rate: r })} aria-label={t("price.quotes.form.rate")} />
        </Field>
        <div className="md:col-span-2">
          <Field label={t("common.note")}>
            <TextInput value={line.note} onChangeText={(note) => onChange({ note })} autoComplete="off" maxLength={300} />
          </Field>
        </div>
      </div>

      {options.length > 0 ? (
        <fieldset className="m-0 mt-3 flex min-w-0 flex-col gap-1 border-0 p-0">
          <legend className="mb-1 text-[14px] font-semibold">{t("price.quotes.form.addons")}</legend>
          {options.map((o) => (
            <label key={o.key} className="flex min-h-11 items-center gap-3 text-[15px]">
              <input
                type="checkbox"
                checked={o.always || line.componentKeys.includes(o.key)}
                disabled={o.always}
                onChange={(ev) => toggle(o.key, ev.currentTarget.checked)}
                className="size-5 accent-[var(--color-foreground)]"
              />
              <span>
                {o.label}
                <span className="ml-2 text-[13px] text-muted-foreground">{t(o.always ? "price.quotes.form.addonAlways" : o.basis === "order" ? "price.quotes.form.addonOrder" : "price.quotes.form.addonPiece")}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="mt-3 flex min-w-0 flex-col gap-2" aria-busy={pending || undefined} data-quote-price="">
        {price == null ? (
          <p role="status" className="m-0 text-[14px] leading-5 text-muted-foreground">
            {pending && line.die && mm != null ? t("price.quotes.form.pricing") : t("price.quotes.form.priceHint")}
          </p>
        ) : !price.ok ? (
          <p role="alert" className="m-0 text-[14px] leading-5 text-destructive">
            {t("price.quotes.form.lineMissing")}
          </p>
        ) : (
          <>
            <p className="m-0 font-mono text-[15px] font-semibold tabular-nums">
              {t("price.quotes.form.lineRate", { rate: rateText(fmt, rate ?? 0) })}
              {rate != null && parseKgText(line) != null ? ` · ${rupeeText(fmt, amountOf(line, rate))}` : ""}
            </p>
            <details>
              <summary className="min-h-11 cursor-pointer text-[14px] font-semibold leading-[44px]">{t("price.quotes.form.breakup")}</summary>
              <BreakupView breakup={price.breakup} />
            </details>
          </>
        )}
      </div>
    </Card>
  );
}

const parseKgText = (l: QuoteLineDraft) => parseKgG(l.kgText);
const amountOf = (l: QuoteLineDraft, rate: number) => lineAmountPaise(parseKgG(l.kgText) ?? 0, rate);
