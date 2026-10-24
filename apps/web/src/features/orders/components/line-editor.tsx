import type { LengthUnit } from "@orrn/domain";
import { formatLength as formatLengthMm } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { trpc } from "@/shared/utils/trpc";

import { kgFieldText, milliText, orderKgText, pcsText } from "../format";
import { useDebounced } from "../hooks";
import { cutLengthMm, lineProblems, quoteArgs, sameQuoteArgs, type Finish, type LineDraft, type LineProblems, type WeightBasis } from "../line-model";
import { QUICK_FEET } from "../view";
import { FieldSelect } from "./controls";
import { DieField, useCopyChoices } from "./pickers";
import { StockSheet } from "./stock-sheet";

/**
 * One line of the new-order form. The person types ONE side (pieces or kg); the other side, the
 * locked kg/12ft and the basis note come from `orders.quote` and are only displayed. The ready-stock
 * prompt (`orders.matchStock`) sits apart from the length buttons and opens the stock sheet.
 */
export function LineEditor({
  line,
  index,
  count,
  unit,
  customerId,
  dieBands,
  showRates,
  problems,
  onChange,
  onRemove,
  stockPrompt = true,
}: {
  line: LineDraft;
  index: number;
  count: number;
  unit: LengthUnit;
  customerId: string | null;
  dieBands: boolean;
  showRates: boolean;
  problems: LineProblems | undefined;
  onChange(patch: Partial<LineDraft>): void;
  onRemove(): void;
  /** The ready-stock prompt (new orders); a saved line takes stock from the order page instead. */
  stockPrompt?: boolean;
}) {
  const { t } = useT();
  const [stockOpen, setStockOpen] = useState(false);
  const { choices } = useCopyChoices(line.die?.id ?? null);
  const mm = cutLengthMm(line, unit);

  const args = quoteArgs(line, unit);
  const asked = useDebounced(args, 300);
  const quote = useQuery({
    ...trpc.orders.quote.queryOptions(asked!),
    enabled: asked != null,
    retry: false,
  });
  // Review I-5: a quote is shown only for exactly what is typed now. While the typing settles or
  // the quote is on its way the derived side is blank and the line says "Working out…".
  const current = args != null && asked != null && sameQuoteArgs(args, asked);
  const q = current && quote.data ? quote.data : undefined;
  const quoting = args != null && !q && !(current && quote.isError);
  const stale = quoting;
  // The die's alloy / temper defaults do not change with the quantity: keep the last ones shown
  // for this die while a new quote is on its way (no flicker in those fields).
  const defaults = useRef<{ sectionId: string; alloy: string | null; temper: string | null } | null>(null);
  if (q && line.die) defaults.current = { sectionId: line.die.id, alloy: q.alloy ?? null, temper: q.temper ?? null };
  const known = defaults.current && line.die && defaults.current.sectionId === line.die.id ? defaults.current : null;

  const stock = useQuery({
    ...trpc.orders.matchStock.queryOptions({
      sectionId: line.die?.id ?? "",
      ...(mm != null ? { cutLengthMm: mm } : {}),
      ...(customerId ? { customerId } : {}),
    }),
    enabled: stockPrompt && line.die != null,
    staleTime: 15_000,
  });

  const label = (mmValue: number) => formatLengthMm(mmValue, unit);
  const ownProblems = problems ?? lineProblems(line, unit);
  const shown = problems != null;

  // The side that was typed shows the text as typed; the other side is the quote.
  const pcsValue = line.basis === "pcs" ? line.pcsText : q && line.basis === "kg" ? String(q.pcs) : "";
  const kgValue = line.basis === "kg" ? line.kgText : q && line.basis === "pcs" ? kgFieldText(q.kgG) : "";
  const bestPcs = q?.pcs ?? null;

  return (
    <Card data-line={index + 1}>
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
        <DieField
          value={line.die}
          onChange={(die) => onChange({ die, copy: "any" })}
          error={shown && ownProblems.die ? t(ownProblems.die) : undefined}
        />
        <Field label={t("orders.line.copy")}>
          <FieldSelect value={line.copy} onChange={(e) => onChange({ copy: e.target.value })} disabled={!line.die}>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </FieldSelect>
        </Field>

        <Field
          label={t("orders.line.cutLength")}
          error={shown && ownProblems.length ? t(ownProblems.length) : undefined}
          hint={unit === "inch" ? t("orders.form.lengthHintInch") : t("orders.form.lengthHintMm")}
        >
          {unit === "inch" ? (
            <div className="flex min-w-0 flex-wrap gap-2">
              <div className="min-w-[7rem] flex-1">
                <NumberInput
                  value={line.feet}
                  onValueChange={(feet) => onChange({ feet })}
                  suffix={t("units.ft")}
                  decimal={false}
                  aria-label={t("orders.form.feet")}
                />
              </div>
              <div className="min-w-[7rem] flex-1">
                <NumberInput
                  value={line.inches}
                  onValueChange={(inches) => onChange({ inches })}
                  suffix={t("units.inch")}
                  aria-label={t("orders.form.inches")}
                />
              </div>
            </div>
          ) : (
            <NumberInput value={line.mm} onValueChange={(v) => onChange({ mm: v })} suffix={t("units.mm")} decimal={false} aria-label={t("orders.line.cutLength")} />
          )}
        </Field>
        {unit === "inch" ? (
          <div role="group" aria-label={t("orders.form.quickLengths")} className="flex flex-wrap items-end gap-2">
            {QUICK_FEET.map((ft) => {
              const on = line.feet === String(ft) && line.inches.trim() === "";
              return (
                <Button
                  key={ft}
                  variant="secondary"
                  aria-pressed={on}
                  className={on ? "ring-2 ring-foreground" : undefined}
                  onClick={() => onChange({ feet: String(ft), inches: "" })}
                >
                  {ft} {t("units.ft")}
                </Button>
              );
            })}
          </div>
        ) : null}

        <Field label={t("orders.line.pcs")} error={shown && ownProblems.qty ? t(ownProblems.qty) : undefined}>
          <NumberInput
            value={pcsValue}
            onValueChange={(text) => onChange({ pcsText: text, basis: text.trim() === "" ? (line.basis === "pcs" ? null : line.basis) : "pcs" })}
            suffix={t("units.pcs")}
            decimal={false}
            aria-label={t("orders.line.pcs")}
          />
        </Field>
        <Field label={t("orders.line.kg")}>
          <NumberInput
            value={kgValue}
            onValueChange={(text) => onChange({ kgText: text, basis: text.trim() === "" ? (line.basis === "kg" ? null : line.basis) : "kg" })}
            suffix={t("units.kg")}
            aria-label={t("orders.line.kg")}
          />
        </Field>

        <Field label={t("orders.line.alloy")}>
          <TextInput value={line.alloy ?? known?.alloy ?? ""} onChangeText={(alloy) => onChange({ alloy })} autoComplete="off" />
        </Field>
        <Field label={t("orders.line.temper")}>
          <TextInput value={line.temper ?? known?.temper ?? ""} onChangeText={(temper) => onChange({ temper })} autoComplete="off" />
        </Field>
        <Field label={t("orders.line.finish")}>
          <FieldSelect value={line.finish} onChange={(e) => onChange({ finish: e.target.value as Finish })}>
            <option value="none">{t("orders.finish.none")}</option>
            <option value="anodise">{t("orders.finish.anodise")}</option>
            <option value="pvd">{t("orders.finish.pvd")}</option>
          </FieldSelect>
        </Field>
        {showRates ? (
          <Field label={t("orders.line.rate")}>
            <NumberInput value={line.rate} onValueChange={(rate) => onChange({ rate })} aria-label={t("orders.line.rate")} />
          </Field>
        ) : null}
      </div>

      <div className="mt-3 flex min-w-0 flex-col gap-3" aria-busy={stale || undefined}>
        {dieBands ? (
          <SegmentedControl<WeightBasis>
            label={t("orders.form.weightBasis")}
            value={line.weightBasis}
            onChange={(weightBasis) => onChange({ weightBasis })}
            options={[
              { value: "copy_current", label: t("orders.form.basisCurrent") },
              { value: "band_start", label: t("orders.form.basisBandStart") },
            ]}
          />
        ) : null}

        {quoting ? (
          <p role="status" data-quote-pending="" className="m-0 text-[14px] leading-5 text-muted-foreground">
            {t("orders.form.quoting")}
          </p>
        ) : q ? (
          <div className="flex min-w-0 flex-col gap-2" data-quote="">
            <p className="m-0 text-[14px] leading-5 text-muted-foreground">
              {q.locked
                ? t("orders.form.basisLocked", { milli: milliText(q.basisMilli) })
                : q.weightBasis === "copy_current"
                  ? t("orders.form.basisUsingCopy", { milli: milliText(q.basisMilli), copy: q.copyCode ?? "" })
                  : t("orders.form.basisUsingBand", { milli: milliText(q.basisMilli) })}
              {!q.locked && q.weightBasis === "band_start" && q.copyMilli == null ? ` ${t("orders.form.noReading")}` : ""}
            </p>
            {line.basis === "kg" ? (
              <>
                <p className="m-0 text-[14px] leading-5">
                  {t("orders.form.impliedLine", { pcs: pcsText(q.pcs), implied: orderKgText(q.impliedG), kg: orderKgText(q.kgG) })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={bestPcs == null || bestPcs <= 1}
                    onClick={() => bestPcs != null && onChange({ basis: "pcs", pcsText: String(bestPcs - 1) })}
                  >
                    {t("orders.form.minusPiece")}
                  </Button>
                  <Button variant="secondary" onClick={() => bestPcs != null && onChange({ basis: "pcs", pcsText: String(bestPcs + 1) })}>
                    {t("orders.form.plusPiece")}
                  </Button>
                </div>
              </>
            ) : (
              <p className="m-0 text-[14px] leading-5">
                {t("orders.form.quoteLine", { pcs: pcsText(q.pcs), kg: orderKgText(q.kgG) })}
              </p>
            )}
          </div>
        ) : args && current && quote.isError ? (
          <p role="alert" className="m-0 text-[14px] leading-5 text-destructive">
            {t("orders.form.quoteFailed")}
          </p>
        ) : null}

        {stockPrompt && line.die ? (
          <div className="flex min-w-0 flex-col items-start gap-2 rounded-card border border-border bg-surface-sunken px-3 py-3">
            <p className="m-0 text-[14px] leading-5" data-stock-prompt="">
              {stock.data && stock.data.readyBundles > 0
                ? t("orders.stock.prompt", { count: stock.data.readyBundles, kg: orderKgText(stock.data.readyG) })
                : t("orders.stock.promptNone")}
            </p>
            <Button variant="secondary" onClick={() => setStockOpen(true)}>
              <Boxes aria-hidden="true" strokeWidth={2} />
              {t("orders.stock.open")}
            </Button>
          </div>
        ) : null}
      </div>

      {stockPrompt ? (
      <StockSheet
        open={stockOpen}
        onOpenChange={setStockOpen}
        items={stock.data?.items}
        loading={stock.isPending && line.die != null}
        failed={stock.isError}
        formatLength={label}
      />
      ) : null}
    </Card>
  );
}
